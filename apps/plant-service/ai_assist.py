"""
Assistente de leitura via Ollama (texto).

O parser heurístico continua a ser a fonte principal. A IA só entra quando o
PDF tem texto mas as regras não encontram compartimentos/vãos suficientes —
típico de projectos de outros gabinetes com legendas ou quadros diferentes.

Os modelos no servidor (qwen2.5) são de texto, não de visão: leem o texto
extraído do PDF vectorial, não a imagem da planta. Resultados da IA ficam
sempre marcados para confirmação humana.
"""
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from typing import Any

from parser import Opening, Room

OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")
PLANT_AI_ENABLED = os.environ.get("PLANT_AI_ENABLED", "1").strip().lower() not in {"0", "false", "no", "off"}
PLANT_AI_MODEL = os.environ.get("PLANT_AI_MODEL", "qwen2.5:7b").strip() or "qwen2.5:7b"
PLANT_AI_TIMEOUT = max(5, min(180, int(os.environ.get("PLANT_AI_TIMEOUT", "90"))))
PLANT_AI_MAX_PAGES = max(1, min(20, int(os.environ.get("PLANT_AI_MAX_PAGES", "8"))))
PLANT_AI_MIN_ROOMS = max(0, int(os.environ.get("PLANT_AI_MIN_ROOMS", "1")))


def ai_config() -> dict[str, Any]:
    return {
        "enabled": PLANT_AI_ENABLED,
        "host": OLLAMA_HOST,
        "model": PLANT_AI_MODEL,
        "timeoutSec": PLANT_AI_TIMEOUT,
        "maxPages": PLANT_AI_MAX_PAGES,
        "minRooms": PLANT_AI_MIN_ROOMS,
    }


def ollama_reachable(timeout: float = 2.0) -> bool:
    try:
        with urllib.request.urlopen(f"{OLLAMA_HOST}/api/tags", timeout=timeout) as response:
            return 200 <= response.status < 300
    except Exception:
        return False


def _clip_page_text(text: str, limit: int = 4500) -> str:
    cleaned = re.sub(r"[ \t]+", " ", text or "")
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    if len(cleaned) <= limit:
        return cleaned
    head = cleaned[: int(limit * 0.7)]
    tail = cleaned[-int(limit * 0.25) :]
    return f"{head}\n…\n{tail}"


def _looks_like_plan_text(text: str) -> bool:
    sample = (text or "").lower()
    if len(sample) < 40:
        return False
    signals = (
        "m²",
        "m2",
        "área",
        "area",
        "escala",
        "planta",
        "compartiment",
        "sala",
        "quarto",
        "cozinha",
        "wc",
        "porta",
        "janela",
        "vão",
        "vao",
        "peitoril",
    )
    return sum(1 for token in signals if token in sample) >= 2


def select_ai_pages(
    page_texts: list[str],
    architecture_pages: set[int],
    pages_with_rooms: set[int],
    max_pages: int = PLANT_AI_MAX_PAGES,
) -> list[int]:
    """Páginas 1-based candidatas: arquitectura sem salas, ou texto de planta sem extracção."""
    scored: list[tuple[int, int]] = []
    for index, text in enumerate(page_texts):
        page = index + 1
        if page in pages_with_rooms:
            continue
        if not _looks_like_plan_text(text):
            continue
        score = 0
        if page in architecture_pages:
            score += 5
        lower = text.lower()
        if "planta" in lower:
            score += 2
        if "m²" in lower or "m2" in lower or "área" in lower or "area" in lower:
            score += 2
        if "porta" in lower or "janela" in lower:
            score += 1
        scored.append((score, page))
    scored.sort(key=lambda item: (-item[0], item[1]))
    return [page for _, page in scored[:max_pages]]


def _chat_json(prompt: str) -> dict[str, Any] | None:
    payload = {
        "model": PLANT_AI_MODEL,
        "stream": False,
        "format": "json",
        "options": {"temperature": 0.1, "num_predict": 1400},
        "messages": [
            {
                "role": "system",
                "content": (
                    "És um assistente de medições de construção civil em Moçambique. "
                    "Lês texto extraído de PDFs de plantas. Responde só JSON válido, "
                    "sem markdown. Não inventes valores: se não houver número claro, omite o campo."
                ),
            },
            {"role": "user", "content": prompt},
        ],
    }
    request = urllib.request.Request(
        f"{OLLAMA_HOST}/api/chat",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=PLANT_AI_TIMEOUT) as response:
            body = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError):
        return None

    content = ((body.get("message") or {}).get("content")) if isinstance(body, dict) else None
    if not isinstance(content, str) or not content.strip():
        return None
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", content, re.DOTALL)
        if not match:
            return None
        try:
            parsed = json.loads(match.group(0))
        except json.JSONDecodeError:
            return None
    return parsed if isinstance(parsed, dict) else None


def _to_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        number = float(value)
        return number if number == number else None
    text = str(value).strip().replace(",", ".")
    text = re.sub(r"[^\d.\-]", "", text)
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _to_int(value: Any, default: int = 1) -> int:
    number = _to_float(value)
    if number is None:
        return default
    return max(1, int(round(number)))


def _normalise_kind(value: Any) -> str | None:
    text = str(value or "").strip().lower()
    if text in {"porta", "door", "p"}:
        return "porta"
    if text in {"janela", "window", "j", "w"}:
        return "janela"
    return None


def _normalise_location(value: Any) -> str:
    text = str(value or "").strip().lower()
    if text in {"interior", "interno", "int"}:
        return "interior"
    if text in {"exterior", "externo", "ext"}:
        return "exterior"
    return "desconhecida"


def parse_ai_payload(data: dict[str, Any], page: int) -> tuple[list[Room], list[Opening]]:
    rooms: list[Room] = []
    openings: list[Opening] = []

    for item in data.get("rooms") or []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or item.get("nome") or "").strip()
        area = _to_float(item.get("areaM2"))
        if area is None:
            area = _to_float(item.get("area_m2"))
        if area is None:
            area = _to_float(item.get("area"))
        if not name or area is None or area <= 0 or area > 5000:
            continue
        number = item.get("number") if item.get("number") not in (None, "") else item.get("numero")
        number_text = str(number).strip() if number not in (None, "") else None
        floor = item.get("floor") if item.get("floor") not in (None, "") else item.get("piso")
        floor_text = str(floor).strip() if floor not in (None, "") else None
        perimeter = _to_float(item.get("perimeterM") or item.get("perimeter_m") or item.get("perimetro"))
        rooms.append(
            Room(
                name=name[:120],
                number=number_text[:40] if number_text else None,
                area_m2=round(area, 2),
                page=page,
                floor=floor_text[:80] if floor_text else None,
                perimeter_m=round(perimeter, 2) if perimeter and perimeter > 0 else None,
            )
        )

    for item in data.get("openings") or data.get("vaos") or []:
        if not isinstance(item, dict):
            continue
        kind = _normalise_kind(item.get("kind") or item.get("tipo"))
        if not kind:
            continue
        width = _to_float(item.get("widthM") or item.get("width_m") or item.get("largura"))
        height = _to_float(item.get("heightM") or item.get("height_m") or item.get("altura"))
        if width is not None and (width <= 0 or width > 12):
            width = None
        if height is not None and (height <= 0 or height > 8):
            height = None
        code = item.get("code") or item.get("codigo")
        code_text = str(code).strip()[:40] if code not in (None, "") else None
        floor = item.get("floor") or item.get("piso")
        floor_text = str(floor).strip()[:80] if floor not in (None, "") else None
        material = item.get("material")
        material_text = str(material).strip()[:80] if material not in (None, "") else None
        designation = item.get("designation") or item.get("designacao") or item.get("nome")
        designation_text = str(designation).strip()[:160] if designation not in (None, "") else None
        sill = _to_float(item.get("sillHeightM") or item.get("sill_height_m") or item.get("peitoril"))
        openings.append(
            Opening(
                kind=kind,
                code=code_text,
                width_m=round(width, 3) if width else None,
                height_m=round(height, 3) if height else None,
                sill_height_m=round(sill, 3) if sill is not None and sill >= 0 else None,
                quantity=_to_int(item.get("quantity") or item.get("quantidade"), 1),
                floor=floor_text,
                location=_normalise_location(item.get("location") or item.get("localizacao")),
                material=material_text,
                page=page,
                confidence=0.45,
                source="ia",
                needs_confirmation=True,
                designation=designation_text,
            )
        )

    return rooms, openings


def extract_page_with_ai(page_text: str, page: int) -> tuple[list[Room], list[Opening]]:
    prompt = (
        f"Página {page} de uma planta de arquitectura (texto OCR/vectorial).\n"
        "Extrai compartimentos com área em m² e vãos (portas/janelas) com medidas quando existirem.\n"
        "JSON exacto:\n"
        '{"rooms":[{"name":"Sala","number":null,"areaM2":18.5,"floor":"Piso Térreo","perimeterM":null}],'
        '"openings":[{"kind":"porta","code":"P01","designation":"Porta interior","widthM":0.9,"heightM":2.1,"quantity":1,'
        '"floor":"Piso Térreo","location":"interior"}]}\n'
        "Se não houver dados, devolve {\"rooms\":[],\"openings\":[]}.\n\n"
        f"TEXTO:\n{_clip_page_text(page_text)}"
    )
    data = _chat_json(prompt)
    if not data:
        return [], []
    return parse_ai_payload(data, page)


def should_use_ai(room_count: int, opening_count: int, candidate_pages: list[int]) -> bool:
    if not PLANT_AI_ENABLED or not candidate_pages:
        return False
    if room_count < PLANT_AI_MIN_ROOMS:
        return True
    if opening_count == 0 and room_count > 0:
        # Há arquitectura mas o quadro de vãos falhou — IA só para openings nas páginas candidatas.
        return True
    return False


def assist_with_ai(
    page_texts: list[str],
    rooms: list[Room],
    openings: list[Opening],
    architecture_pages: set[int],
) -> tuple[list[Room], list[Opening], dict[str, Any]]:
    """Completa extracção com Ollama quando o parser clássico ficou curto."""
    meta: dict[str, Any] = {
        "used": False,
        "model": PLANT_AI_MODEL,
        "pages": [],
        "roomsAdded": 0,
        "openingsAdded": 0,
        "error": None,
    }
    if not PLANT_AI_ENABLED:
        meta["error"] = "disabled"
        return rooms, openings, meta

    pages_with_rooms = {room.page for room in rooms}
    candidates = select_ai_pages(page_texts, architecture_pages, pages_with_rooms)
    need_rooms = len(rooms) < PLANT_AI_MIN_ROOMS
    need_openings = len(openings) == 0
    if not should_use_ai(len(rooms), len(openings), candidates):
        return rooms, openings, meta
    if not ollama_reachable():
        meta["error"] = "ollama_unreachable"
        return rooms, openings, meta

    ai_rooms: list[Room] = []
    ai_openings: list[Opening] = []
    meta["used"] = True

    for page in candidates:
        text = page_texts[page - 1]
        try:
            page_rooms, page_openings = extract_page_with_ai(text, page)
        except Exception as exc:  # noqa: BLE001 — nunca derrubar o parse clássico
            meta["error"] = str(exc)[:200]
            break
        meta["pages"].append(page)
        if need_rooms:
            ai_rooms.extend(page_rooms)
        if need_openings:
            ai_openings.extend(page_openings)
        rooms_ok = not need_rooms or len(rooms) + len(ai_rooms) >= PLANT_AI_MIN_ROOMS
        openings_ok = not need_openings or len(ai_openings) > 0
        if rooms_ok and openings_ok and (need_rooms or need_openings):
            # Já cobrimos o que faltava; evita gastar páginas extra no modelo.
            if need_rooms and len(ai_rooms) >= 3:
                break
            if need_openings and not need_rooms:
                break

    meta["roomsAdded"] = len(ai_rooms)
    meta["openingsAdded"] = len(ai_openings)
    return rooms + ai_rooms, openings + ai_openings, meta

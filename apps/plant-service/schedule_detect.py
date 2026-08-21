"""Classificação de quadros/tabelas estruturais por cabeçalhos (stub)."""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass


SCHEDULE_KINDS = (
    "pilares",
    "vigas",
    "lajes",
    "sapatas",
    "aco",
    "portas_janelas",
    "acabamentos",
    "desconhecido",
)


@dataclass(frozen=True)
class ScheduleClassification:
    kind: str
    confidence: float
    matched_headers: tuple[str, ...]


_KIND_PATTERNS: dict[str, tuple[str, ...]] = {
    "pilares": (
        r"quadro\s+de\s+pilares",
        r"\bpilares?\b",
        r"\bcolunas?\b",
        r"column\s+schedule",
    ),
    "vigas": (
        r"desenho\s+de\s+vigas",
        r"\bvigas?\b",
        r"\bporticos?\b",
        r"beam\s+schedule",
    ),
    "lajes": (
        r"\blajes?\b",
        r"\bslabs?\b",
        r"armadura\s+(?:de\s+)?laje",
        r"cobertura",
    ),
    "sapatas": (
        r"\bsapatas?\b",
        r"funda[cç][oõ]es?",
        r"footing",
    ),
    "aco": (
        r"mapa\s+de\s+a[cç]o",
        r"resumo\s+a[cç]o",
        r"total\+10%",
        r"peso\+10%",
        r"rebar",
    ),
    "portas_janelas": (
        r"mapa\s+de\s+v[aã]os",
        r"portas?\s+e\s+janelas?",
        r"nomeclatura",
        r"door\s+schedule",
        r"window\s+schedule",
    ),
    "acabamentos": (
        r"acabamentos?",
        r"revestimentos?",
        r"finish\s+schedule",
        r"pavimentos?",
    ),
}


def _normalise_header(value: str) -> str:
    folded = unicodedata.normalize("NFKD", value)
    ascii_text = "".join(ch for ch in folded if not unicodedata.combining(ch))
    return re.sub(r"\s+", " ", ascii_text).strip().lower()


def classify_table_headers(headers: list[str]) -> ScheduleClassification:
    """Classifica uma tabela pelos cabeçalhos visíveis."""
    if not headers:
        return ScheduleClassification("desconhecido", 0.0, ())

    normalised = [_normalise_header(header) for header in headers if header.strip()]
    if not normalised:
        return ScheduleClassification("desconhecido", 0.0, ())

    joined = " | ".join(normalised)
    scores: dict[str, float] = {}
    matched: dict[str, list[str]] = {}

    for kind, patterns in _KIND_PATTERNS.items():
        hits = 0
        found: list[str] = []
        for header in normalised:
            for pattern in patterns:
                if re.search(pattern, header, re.IGNORECASE):
                    hits += 1
                    found.append(header)
                    break
        if hits:
            scores[kind] = hits / max(len(normalised), 1)
            matched[kind] = found

    if not scores:
        return ScheduleClassification("desconhecido", 0.15, tuple(normalised[:3]))

    kind = max(scores, key=scores.get)
    confidence = min(0.98, round(0.45 + scores[kind] * 0.55, 2))
    return ScheduleClassification(kind, confidence, tuple(matched.get(kind, normalised[:2])))


def classify_page_tables(page_text: str) -> list[ScheduleClassification]:
    """Detecta blocos tabulares simples (linhas com várias colunas) e classifica-os."""
    lines = [line.strip() for line in page_text.splitlines() if line.strip()]
    headers: list[str] = []
    for line in lines[:40]:
        if re.search(r"\t|;\s|\s{2,}", line):
            parts = re.split(r"\t|;\s|\s{2,}", line)
            if len(parts) >= 3:
                headers = [part.strip() for part in parts if part.strip()]
                break
        lower = line.lower()
        if any(token in lower for token in ("quantidade", "largura", "altura", "diâmetro", "peso", "elemento")):
            headers.append(line)
    if headers:
        return [classify_table_headers(headers)]
    return []

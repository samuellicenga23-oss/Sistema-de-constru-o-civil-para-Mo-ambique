"""
Estimativa de aço quando o PDF não traz o resumo «Total+10% / Ød: kg».

Ordem (alinhada com o pedido do produto):
1. Quadros em kg (Total+10%, Peso+10%) — feitos noutro sítio
2. Chamadas com comprimento C= (Ø10a/15 C=530) → kg = L × peso linear
3. Geometria: malha Ø+espaçamento × área de laje / sapatas / vigas
"""
from __future__ import annotations

import math
import re
import unicodedata
from collections import Counter, defaultdict
from typing import TYPE_CHECKING, Iterable

if TYPE_CHECKING:
    from parser import BeamSpan, Footing, RebarLine, Room, Slab

STEEL_DENSITY_KG_M3 = 7850.0
DEFAULT_LAP_FACTOR = 1.10

# Ø10a/15 C=530  |  12P1Ø8a/10 C=222  |  Ø8a/15 C=520-570
CALLOUT_LENGTH_PATTERN = re.compile(
    r"(?P<count>\d{1,3})?(?:[A-Za-z]?\d{0,3})?"
    r"[Øø]\s*(?P<diameter>\d{1,2})\s*a\s*/\s*(?P<spacing>\d+(?:[.,]\d+)?)"
    r"\s*C\s*=\s*(?P<length>\d+(?:[.,]\d+)?)(?:\s*-\s*(?P<length2>\d+(?:[.,]\d+)?))?",
    re.IGNORECASE,
)

# 7Ø12a/19  |  4Ø12  |  #8@15  |  Ø6@20  |  malhassol Ø6mm@15cm
MESH_SPEC_PATTERN = re.compile(
    r"(?:(?P<count>\d{1,2})\s*[x×]?\s*)?[Øø#]\s*(?P<diameter>\d{1,2})\s*(?:mm)?"
    r"(?:\s*a\s*/\s*|\s*@\s*)(?P<spacing>\d+(?:[.,]\d+)?)",
    re.IGNORECASE,
)
BARS_ONLY_PATTERN = re.compile(r"(?P<count>\d{1,2})\s*[Øø]\s*(?P<diameter>\d{1,2})\b", re.IGNORECASE)

# Comp. total (m) / Peso+10% (kg) … Ø12 / 857.2 / 837
PESO_TABLE_MARKER = re.compile(r"Peso\s*\+?\s*10%\s*(?:\n|\s)*\(kg\)", re.IGNORECASE)
PESO_DIAMETER_LINE = re.compile(r"^[Øø]\s*(\d{1,2})$")
PESO_NUMBER_LINE = re.compile(r"^(\d+(?:[.,]\d+)?)$")
RESUMO_ACO_LINE = re.compile(r"^resumo\s+a[cç]o$", re.IGNORECASE)


def _fold_ascii(value: str) -> str:
    plain = unicodedata.normalize("NFKD", value or "")
    return "".join(ch for ch in plain if not unicodedata.combining(ch)).lower()


def steel_family_of(element: str) -> str:
    """Família estrutural a partir do rótulo da linha de aço."""
    e = _fold_ascii(element)
    if re.search(r"sapata|funda[cç]|maci[cç]o|radier", e):
        return "footings"
    if re.search(r"pilar|coluna|column|pilarete", e) or re.search(
        r"(?:^|[\s,;])p\d+(?:\s*=\s*p\d+)*(?=$|[\s,;/])", e
    ):
        return "columns"
    if re.search(r"escada|staircase|\bstair\b", e):
        return "stairs"
    if re.search(r"viga|p[oó]rtico|beam|lintel", e):
        return "beams"
    if re.search(r"laje|cobertura|armadura longitudinal|slab|malha", e):
        return "slabs"
    return "other"


def label_from_resumo_title(title_lines: list[str], page_text: str = "") -> str:
    """Classifica o Resumo Aço pelo título imediatamente abaixo de «Resumo Aço»."""
    title = " ".join(title_lines).strip()
    n = _fold_ascii(title)
    page_n = _fold_ascii(page_text[:1200])
    if re.search(r"quadro\s+de\s+pilares|\bpilares?\b", n):
        return "Pilares"
    if re.search(r"funda[cç]", n):
        return "Fundação"
    if re.search(r"viga|pormenoriza", n):
        return "Vigas"
    if re.search(r"escada", n):
        return "Escada"
    if re.search(r"longitudinal\s+inferior", n):
        return "Armadura longitudinal inferior"
    if re.search(r"longitudinal\s+superior", n):
        return "Armadura longitudinal superior"
    if re.search(r"laje|armadur", n):
        return title or "Laje"
    # Contingência: cabeçalho Conteúdo da folha (nunca «Fundação» como piso do quadro de pilares).
    if re.search(r"conteudo:\s*quadro\s+de\s+pilares", page_n):
        return "Pilares"
    if re.search(r"conteudo:\s*pormenor\s+de\s+funda", page_n):
        return "Fundação"
    if re.search(r"conteudo:\s*pormenor\s+de\s+vigas", page_n):
        return "Vigas"
    if re.search(r"conteudo:\s*escada", page_n):
        return "Escada"
    return title or "Peso+10%"


def rebar_weight_per_meter(diameter_mm: float) -> float:
    diameter_m = diameter_mm / 1000.0
    return (math.pi / 4.0) * diameter_m * diameter_m * STEEL_DENSITY_KG_M3


def mesh_weight_kg_per_m2(diameter_mm: float, spacing_cm: float) -> float:
    if diameter_mm <= 0 or spacing_cm <= 0:
        return 0.0
    return rebar_weight_per_meter(diameter_mm) / (spacing_cm / 100.0)


def _to_float(value: str) -> float:
    return float(value.replace(",", "."))


def _rebar_line(element: str, diameter_mm: float, weight_kg: float, page: int, group_id: int | None = None):
    from parser import RebarLine

    return RebarLine(
        element=element,
        diameter_mm=diameter_mm,
        weight_kg=weight_kg,
        page=page,
        group_id=group_id,
    )


def extract_rebar_peso_plus10_table(text: str, page_number: int) -> list:
    """Extrai quadros «Resumo Aço → Peso+10% (kg)» com a família do título do resumo.

    O mesmo resumo pode repetir-se em várias folhas (ex. Fundação 906 kg) — usa-se um
    fingerprint da tabela como «page» para a fusão não multiplicar. Resumos distintos
    da mesma família (ex. três resumos de vigas) mantêm fingerprints diferentes e somam.
    """
    if not PESO_TABLE_MARKER.search(text) and not re.search(r"resumo\s+a[cç]o", text, re.I):
        return []

    lines = [line.strip() for line in text.splitlines()]
    result = []

    for i, line in enumerate(lines):
        if not re.match(r"^resumo\s+a[cç]o$", _fold_ascii(line)):
            continue

        title_lines: list[str] = []
        j = i + 1
        while j < len(lines) and j < i + 8:
            folded = _fold_ascii(lines[j])
            if re.search(r"comp\.?\s*total|peso\s*\+?\s*10%|^\(m\)$|^\(kg\)$|^s-?400$", folded):
                break
            if lines[j]:
                title_lines.append(lines[j])
            j += 1

        start = next(
            (
                k
                for k in range(i, min(i + 24, len(lines)))
                if re.search(r"peso\s*\+?\s*10%", _fold_ascii(lines[k]))
            ),
            -1,
        )
        if start < 0:
            continue

        family = label_from_resumo_title(title_lines, text)
        rows: list[tuple[float, float]] = []
        k = start + 1
        while k < len(lines):
            diam_match = PESO_DIAMETER_LINE.match(lines[k])
            if diam_match:
                diameter = float(diam_match.group(1))
                numbers: list[float] = []
                m = k + 1
                while m < len(lines) and len(numbers) < 2:
                    number_match = PESO_NUMBER_LINE.match(lines[m])
                    if not number_match:
                        if PESO_DIAMETER_LINE.match(lines[m]) or _fold_ascii(lines[m]) in {"total", "s-400", "s400"}:
                            break
                        m += 1
                        continue
                    numbers.append(_to_float(number_match.group(1)))
                    m += 1
                weight = None
                if len(numbers) >= 2:
                    weight = numbers[1]
                elif len(numbers) == 1 and numbers[0] >= 5:
                    weight = numbers[0]
                if weight and weight > 0:
                    rows.append((diameter, round(weight, 2)))
                k = m if m > k + 1 else k + 1
                continue

            folded = _fold_ascii(lines[k])
            if folded == "total" or (PESO_NUMBER_LINE.match(lines[k]) and k + 1 < len(lines) and _fold_ascii(lines[k + 1]) == "total"):
                break
            if re.match(r"^resumo\s+a[cç]o$", folded):
                break
            k += 1

        if not rows:
            continue
        fingerprint = hash((family, tuple(rows))) & 0x7FFFFFFF
        for diameter, weight in rows:
            result.append(_rebar_line(family, diameter, weight, page_number, group_id=fingerprint))

    # Fallback: páginas com Peso+10% sem cabeçalho «Resumo Aço» (quadro solto).
    if result:
        return result
    if not PESO_TABLE_MARKER.search(text):
        return []
    start = next((i for i, line in enumerate(lines) if "peso" in line.lower() and "10%" in line.lower()), -1)
    if start < 0:
        return []
    family = label_from_resumo_title([], text)
    rows = []
    i = start
    while i < len(lines):
        diam_match = PESO_DIAMETER_LINE.match(lines[i])
        if not diam_match:
            i += 1
            continue
        diameter = float(diam_match.group(1))
        numbers = []
        j = i + 1
        while j < len(lines) and len(numbers) < 2:
            number_match = PESO_NUMBER_LINE.match(lines[j])
            if not number_match:
                if PESO_DIAMETER_LINE.match(lines[j]) or lines[j].lower() in {"total", "s-400", "s400"}:
                    break
                j += 1
                continue
            numbers.append(_to_float(number_match.group(1)))
            j += 1
        weight = numbers[1] if len(numbers) >= 2 else (numbers[0] if len(numbers) == 1 and numbers[0] >= 5 else None)
        if weight and weight > 0:
            rows.append((diameter, round(weight, 2)))
        i = j if j > i + 1 else i + 1
    if not rows:
        return []
    fingerprint = hash((family, tuple(rows))) & 0x7FFFFFFF
    return [_rebar_line(family, d, w, page_number, group_id=fingerprint) for d, w in rows]


def extract_rebar_from_length_callouts(text: str, page_number: int) -> list:
    """Chamadas Øda/espaçamento C=comprimento(cm) → peso por varão × quantidade."""
    if not re.search(r"C\s*=", text, re.IGNORECASE):
        return []

    by_diameter: dict[float, float] = defaultdict(float)
    for match in CALLOUT_LENGTH_PATTERN.finditer(text):
        diameter = float(match.group("diameter"))
        length_cm = _to_float(match.group("length"))
        length2 = match.group("length2")
        if length2:
            length_cm = (length_cm + _to_float(length2)) / 2.0
        if length_cm <= 0 or length_cm > 5000:
            continue
        count = int(match.group("count") or "1")
        if count < 1 or count > 500:
            count = 1
        length_m = length_cm / 100.0
        by_diameter[diameter] += count * length_m * rebar_weight_per_meter(diameter)

    floor_hint = "laje"
    if re.search(r"escada", text, re.IGNORECASE):
        floor_hint = "escada"
    elif re.search(r"viga|p[óo]rtico", text, re.IGNORECASE):
        floor_hint = "viga"
    elif re.search(r"funda", text, re.IGNORECASE):
        floor_hint = "fundacao"

    return [
        _rebar_line(f"Cálculo {floor_hint} Ø{int(diameter)}", diameter, round(weight, 2), page_number)
        for diameter, weight in sorted(by_diameter.items())
        if weight > 0.05
    ]


def _dominant_mesh(specs: list[tuple[float, float]]) -> tuple[float, float] | None:
    if not specs:
        return None
    counted = Counter((round(d), round(s, 2)) for d, s in specs)
    (diameter, spacing), _ = counted.most_common(1)[0]
    return float(diameter), float(spacing)


def extract_mesh_specs(text: str) -> list[tuple[float, float]]:
    specs: list[tuple[float, float]] = []
    for match in MESH_SPEC_PATTERN.finditer(text):
        diameter = float(match.group("diameter"))
        spacing = _to_float(match.group("spacing"))
        if 4 <= diameter <= 40 and 5 <= spacing <= 40:
            specs.append((diameter, spacing))
    return specs


def estimate_footing_rebar(footings: list, page_texts: dict[int, str]) -> list:
    """Estimativa a partir do quadro de fundação: malha por sapata (X/Y inf/sup) × nº de refs."""
    by_diameter: dict[float, float] = defaultdict(float)

    def weight_for_face(spec, span_cm: float) -> float:
        if not spec or span_cm <= 0:
            return 0.0
        # Preferir a quantidade declarada no quadro («9Ø12a/15») em relação a span/espaçamento.
        bars = max(1, int(spec.bar_count or 0))
        if bars < 1:
            bars = max(1, int(round(span_cm / max(spec.spacing_cm, 1))))
        return bars * (span_cm / 100.0) * rebar_weight_per_meter(spec.diameter_mm)

    for footing in footings:
        faces = []
        if getattr(footing, "bottom_x", None) or getattr(footing, "bottom_y", None) or getattr(footing, "top_x", None):
            faces = [
                (footing.bottom_x, footing.length_cm),
                (footing.bottom_y, footing.width_cm),
                (footing.top_x, footing.length_cm),
                (footing.top_y, footing.width_cm),
            ]
        else:
            # Contingência: malha dominante na página do quadro, X+Y (e topsuperior se referida).
            text = page_texts.get(footing.page, "")
            specs = extract_mesh_specs(text)
            mesh = _dominant_mesh(specs)
            if not mesh:
                continue
            diameter, spacing_cm = mesh
            from parser import FootingRebarSpec

            fake = FootingRebarSpec(
                bar_count=max(1, int(round(footing.width_cm / spacing_cm))),
                diameter_mm=diameter,
                spacing_cm=spacing_cm,
            )
            faces = [
                (fake, footing.length_cm),
                (fake, footing.width_cm),
            ]
            if re.search(r"armadura\s+sup", text, re.IGNORECASE):
                faces.extend([(fake, footing.length_cm), (fake, footing.width_cm)])

        group_weight = 0.0
        for spec, span_cm in faces:
            if not spec:
                continue
            w = weight_for_face(spec, span_cm)
            group_weight += w
            by_diameter[float(spec.diameter_mm)] += w * max(1, len(footing.refs)) * DEFAULT_LAP_FACTOR

        if group_weight <= 0:
            continue

    return [
        _rebar_line(f"Cálculo sapata Ø{int(d)}", d, round(w, 2), 0)
        for d, w in sorted(by_diameter.items())
        if w > 0.05
    ]


def _estimate_slab_rebar_legacy(rooms: list, slabs: list, structure_page_texts: dict[int, str]) -> list:
    """Malha de laje: área dos compartimentos × Ø/espaçamento dominante nas folhas de armadura."""
    if not rooms:
        return []
    total_area = sum(room.area_m2 for room in rooms)
    if total_area <= 0:
        return []

    layer_specs: dict[str, list[tuple[float, float]]] = defaultdict(list)
    for text in structure_page_texts.values():
        if not re.search(r"armadur", text, re.IGNORECASE):
            continue
        layer = "geral"
        if re.search(r"inferior", text, re.IGNORECASE):
            layer = "inferior"
        elif re.search(r"superior", text, re.IGNORECASE):
            layer = "superior"
        layer_specs[layer].extend(extract_mesh_specs(text))

    if not any(layer_specs.values()):
        for text in structure_page_texts.values():
            layer_specs["geral"].extend(extract_mesh_specs(text))

    layers_to_apply: list[tuple[str, tuple[float, float]]] = []
    for layer_name in ("inferior", "superior"):
        mesh = _dominant_mesh(layer_specs.get(layer_name, []))
        if mesh:
            layers_to_apply.append((layer_name, mesh))
    if not layers_to_apply:
        mesh = _dominant_mesh(layer_specs.get("geral", []))
        if mesh:
            layers_to_apply = [("inferior", mesh), ("superior", mesh)]
    if not layers_to_apply:
        return []

    by_diameter: dict[float, float] = defaultdict(float)
    for _layer_name, (diameter, spacing) in layers_to_apply:
        kg = total_area * mesh_weight_kg_per_m2(diameter, spacing) * 2 * DEFAULT_LAP_FACTOR
        by_diameter[diameter] += kg

    page = slabs[0].page if slabs else 0
    return [_rebar_line(f"Cálculo laje Ø{int(d)}", d, round(w, 2), page) for d, w in sorted(by_diameter.items()) if w > 0.05]


def estimate_slab_rebar_from_area(rooms: list, slabs: list, structure_page_texts: dict[int, str]) -> list:
    """Calcula cada laje física separadamente antes de agregar por diâmetro.

    A armadura explicitamente ligada à folha da laje prevalece. A leitura
    dominante do documento fica apenas como contingência quando nenhuma folha
    trouxe uma malha utilizável.
    """
    if not rooms:
        return []
    total_area = sum(room.area_m2 for room in rooms)
    if total_area <= 0:
        return []

    def normalized(value: str | None) -> str:
        plain = unicodedata.normalize("NFKD", value or "")
        ascii_text = "".join(char for char in plain if not unicodedata.combining(char))
        return re.sub(r"[^a-z0-9]+", " ", ascii_text.lower()).strip()

    room_area_by_floor: dict[str, float] = defaultdict(float)
    floor_order: list[str] = []
    for room in rooms:
        floor_key = normalized(getattr(room, "floor", None))
        if floor_key not in floor_order:
            floor_order.append(floor_key)
        room_area_by_floor[floor_key] += room.area_m2

    known_thickness_by_floor = {
        normalized(slab.floor): round(slab.thickness_cm, 2)
        for slab in slabs
        if slab.thickness_cm > 0
    }
    slab_groups: dict[tuple[str, float], list] = defaultdict(list)
    for slab in slabs:
        floor_key = normalized(slab.floor)
        effective_thickness = round(slab.thickness_cm, 2) if slab.thickness_cm > 0 else known_thickness_by_floor.get(floor_key, 0)
        slab_groups[(floor_key, effective_thickness)].append(slab)

    def slab_area(floor_key: str) -> float:
        if room_area_by_floor.get(floor_key, 0) > 0:
            return room_area_by_floor[floor_key]
        for room_floor, area in room_area_by_floor.items():
            if floor_key and room_floor and (floor_key in room_floor or room_floor in floor_key):
                return area
        if "cobertura" in floor_key and floor_order:
            return room_area_by_floor[floor_order[-1]]
        # Não repetir a área global inteira em todas as lajes quando o piso não
        # pôde ser associado com segurança.
        return total_area / max(1, len(slab_groups))

    explicit_lines = []
    for (floor_key, _thickness), physical_slabs in slab_groups.items():
        area_m2 = slab_area(floor_key)
        floor_label = physical_slabs[0].floor or "não identificada"
        for slab in physical_slabs:
            layer = getattr(slab, "rebar", None)
            if layer is None:
                continue
            for direction, diameter, spacing in (
                ("X", layer.x_diameter_mm, layer.x_spacing_cm),
                ("Y", layer.y_diameter_mm, layer.y_spacing_cm),
            ):
                weight = area_m2 * mesh_weight_kg_per_m2(diameter, spacing) * DEFAULT_LAP_FACTOR
                explicit_lines.append(_rebar_line(
                    f"Laje {floor_label} - {slab.layer} {direction}",
                    diameter,
                    round(weight, 2),
                    slab.page,
                ))

    if explicit_lines:
        return merge_rebar_lines(explicit_lines)

    return _estimate_slab_rebar_legacy(rooms, slabs, structure_page_texts)


def estimate_beam_rebar(beam_spans: list, page_texts: dict[int, str]) -> list:
    """Vigas: barras longitudinais NØD × comprimento + estribos aproximados."""
    if not beam_spans:
        return []
    by_diameter: dict[float, float] = defaultdict(float)
    for beam in beam_spans:
        text = page_texts.get(beam.page, "")
        long_bars = [(int(m.group("count")), float(m.group("diameter"))) for m in BARS_ONLY_PATTERN.finditer(text)]
        long_bars = [(c, d) for c, d in long_bars if 1 <= c <= 12 and 8 <= d <= 25]
        if long_bars:
            count, diameter = Counter(long_bars).most_common(1)[0]
            by_diameter[diameter] += count * beam.length_m * rebar_weight_per_meter(diameter) * DEFAULT_LAP_FACTOR
        meshes = extract_mesh_specs(text)
        stirrup = _dominant_mesh([(d, s) for d, s in meshes if d <= 10])
        if stirrup:
            diameter, spacing_cm = stirrup
            peri_m = 2 * ((beam.width_cm + beam.height_cm) / 100.0)
            n_stirrups = max(1, int(round((beam.length_m * 100) / spacing_cm)))
            by_diameter[diameter] += n_stirrups * peri_m * rebar_weight_per_meter(diameter)

    return [_rebar_line(f"Cálculo viga Ø{int(d)}", d, round(w, 2), 0) for d, w in sorted(by_diameter.items()) if w > 0.05]


def merge_rebar_lines(lines: Iterable) -> list:
    """Fundir pesos do mesmo diâmetro/elemento/(group_id ou página).

    Extracções idênticas do mesmo Resumo (mesmo group_id) não somam; resumos
    distintos (ex. três folhas de vigas) mantêm group_ids diferentes e somam.
    """
    clean: dict[tuple[str, float, int], float] = {}
    meta: dict[tuple[str, float, int], tuple[int, int | None]] = {}
    for line in lines:
        weight = float(line.weight_kg or 0)
        if weight <= 0:
            continue
        group = getattr(line, "group_id", None)
        merge_page = int(group) if group is not None else int(line.page)
        key = (line.element, round(line.diameter_mm, 1), merge_page)
        prev = clean.get(key)
        if prev is None or abs(prev - weight) < 0.05:
            clean[key] = weight
        else:
            clean[key] = prev + weight
        meta[key] = (int(line.page), group)
    merged = []
    for key, weight in sorted(clean.items(), key=lambda item: (item[0][2], item[0][1])):
        if weight <= 0:
            continue
        element, diameter, _merge = key
        page, group_id = meta[key]
        merged.append(_rebar_line(element, diameter, round(weight, 2), page, group_id=group_id))
    return merged


def combine_resumo_with_total(peso_plus10_lines: list, total_plus10_lines: list) -> list:
    """Prefere a família do Resumo Aço e conserva a maior precisão disponível.

    Alguns programas imprimem o resumo arredondado ao quilograma, enquanto a tabela
    ``Total+10%`` da mesma página mantém casas decimais. Nesse caso, usa-se o valor detalhado
    da mesma família/página/diâmetro sem duplicar a família.
    """
    resumos = merge_rebar_lines(peso_plus10_lines)
    detailed = merge_rebar_lines(total_plus10_lines)

    def precision_key(line):
        element = re.sub(r"[^a-z0-9]+", " ", _fold_ascii(line.element or "")).strip()
        return (element, int(line.page), round(float(line.diameter_mm), 2))

    detailed_by_key = {
        precision_key(line): line
        for line in detailed
    }
    refined_resumos = []
    for line in resumos:
        key = precision_key(line)
        refined_resumos.append(detailed_by_key.get(key, line))
    covered = {steel_family_of(line.element) for line in resumos}
    covered.discard("other")
    extras = [
        line
        for line in detailed
        if steel_family_of(line.element) not in covered
    ]
    return merge_rebar_lines([*refined_resumos, *extras])


def complete_rebar_schedules(
    *,
    table_lines: list,
    page_texts: dict[int, str],
    structure_pages: set[int],
    rooms: list,
    footings: list,
    beam_spans: list,
    slabs: list,
) -> list:
    """
    1) Mantém quadros em kg se existirem.
    2) Acrescenta pesos derivados de C= (comprimentos nas armaduras).
    3) Se ainda não houver nada, estima por Ø+espaçamento+geometria.
    """
    structure_texts = {page: text for page, text in page_texts.items() if page in structure_pages}
    pages_with_kg_table = {line.page for line in table_lines}

    callout_lines = []
    for page, text in structure_texts.items():
        # Evita duplicar páginas que já têm quadro Peso+10% / Total em kg.
        if page in pages_with_kg_table:
            continue
        callout_lines.extend(extract_rebar_from_length_callouts(text, page))

    combined = merge_rebar_lines([*table_lines, *callout_lines])
    if combined:
        return combined

    estimated = []
    estimated.extend(estimate_footing_rebar(footings, structure_texts))
    estimated.extend(estimate_slab_rebar_from_area(rooms, slabs, structure_texts))
    estimated.extend(estimate_beam_rebar(beam_spans, structure_texts))
    return merge_rebar_lines(estimated)

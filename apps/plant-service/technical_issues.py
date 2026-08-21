"""Cross-check estrutural — gera technicalIssues sem corrigir automaticamente."""
from __future__ import annotations

import re
from collections import Counter, defaultdict

from parser import BeamSpan, RebarLine, Room, StructuralSummary, TechnicalQualityIssue


def _issue(
    code: str,
    severity: str,
    scope: str,
    message: str,
    pages: list[int] | None = None,
    confirm: bool = True,
) -> TechnicalQualityIssue:
    return TechnicalQualityIssue(code, severity, scope, message, pages or [], confirm)


def _tolerance(reported: float, computed: float, pct: float = 0.02, abs_min: float = 1.0) -> bool:
    if reported <= 0 and computed <= 0:
        return True
    delta = abs(reported - computed)
    return delta <= max(abs_min, abs(reported) * pct)


def _column_codes_from_rebar(rebar_schedules: list[RebarLine]) -> Counter[str]:
    counts: Counter[str] = Counter()
    for line in rebar_schedules:
        element = line.element or ""
        for code in re.findall(r"\bP\d+\b", element, flags=re.IGNORECASE):
            counts[code.upper()] += 1
    return counts


def extract_floor_area_totals_from_schedule(text: str) -> dict[str, float]:
    """Extrai subtotais «Total» por piso de tabelas ArchiCAD (área em m²)."""
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    totals: dict[str, float] = {}
    current_floor = "global"
    area_pattern = re.compile(r"^([\d.,]+)\s*m²?$", re.IGNORECASE)

    for index, line in enumerate(lines):
        lower = line.lower()
        if lower.startswith("total"):
            values: list[float] = []
            cursor = index + 1
            while cursor < len(lines):
                match = area_pattern.match(lines[cursor])
                if not match:
                    break
                values.append(float(match.group(1).replace(",", ".")))
                cursor += 1
            if values:
                totals[current_floor] = values[-1]
            continue
        if not area_pattern.match(lines[index + 1] if index + 1 < len(lines) else ""):
            floor_match = re.search(r"(piso| rés|térreo|cave| cobertura)", lower)
            if floor_match:
                current_floor = line
    return totals


def cross_check_structural(
    structural_summary: StructuralSummary | None,
    rebar_schedules: list[RebarLine],
    rooms: list[Room],
    beam_spans: list[BeamSpan],
    page_texts: list[str] | None = None,
) -> list[TechnicalQualityIssue]:
    """Compara totais estruturais vs somas parciais; não altera dados."""
    issues: list[TechnicalQualityIssue] = []
    if not structural_summary:
        return issues

    pages = sorted({line.page for line in rebar_schedules})

    line_total = round(sum(float(line.weight_kg or 0) for line in rebar_schedules), 2)
    if line_total > 0 and structural_summary.total_steel_weight_kg > 0:
        if not _tolerance(structural_summary.total_steel_weight_kg, line_total):
            issues.append(
                _issue(
                    "structure.steel_map_total_mismatch",
                    "warning",
                    "estrutura",
                    (
                        f"Peso total do mapa ({structural_summary.total_steel_weight_kg:.2f} kg) "
                        f"diferente da soma das linhas ({line_total:.2f} kg)."
                    ),
                    pages,
                )
            )

    family_sum = round(
        structural_summary.footings_steel_weight_kg
        + structural_summary.columns_steel_weight_kg
        + structural_summary.beams_steel_weight_kg
        + structural_summary.slabs_steel_weight_kg
        + structural_summary.stairs_steel_weight_kg,
        2,
    )
    if family_sum > 0 and line_total > 0 and not _tolerance(line_total, family_sum, pct=0.05):
        issues.append(
            _issue(
                "structure.steel_family_sum_mismatch",
                "warning",
                "estrutura",
                (
                    f"Soma por família ({family_sum:.2f} kg) não coincide com o mapa de aço "
                    f"({line_total:.2f} kg); verifique classificação ou linhas não atribuídas."
                ),
                pages,
            )
        )

    quadro_columns = sum(group.quantity for group in structural_summary.column_groups)
    if quadro_columns > 0 and structural_summary.columns_count > 0:
        if quadro_columns != structural_summary.columns_count:
            column_pages = sorted({group.source_page for group in structural_summary.column_groups if group.source_page})
            issues.append(
                _issue(
                    "structure.column_quadro_vs_count",
                    "warning",
                    "estrutura",
                    (
                        f"Quadro de pilares lista {quadro_columns} ocorrência(s), "
                        f"mas o resumo indica {structural_summary.columns_count} pilar(es)."
                    ),
                    column_pages,
                )
            )

    rebar_column_codes = _column_codes_from_rebar(rebar_schedules)
    for group in structural_summary.column_groups:
        refs = [part.strip().upper() for part in re.split(r"[=\s]+", group.code) if part.strip()]
        for ref in refs:
            if not re.fullmatch(r"P\d+", ref):
                continue
            if ref not in rebar_column_codes:
                issues.append(
                    _issue(
                        "structure.column_quadro_vs_rebar",
                        "info",
                        "estrutura",
                        f"{ref} aparece no quadro de pilares mas não no mapa de aço.",
                        [group.source_page] if group.source_page else [],
                    )
                )

    sections_by_portico: dict[str, set[tuple[float, float]]] = defaultdict(set)
    for span in beam_spans:
        sections_by_portico[span.portico].add((round(span.width_cm, 1), round(span.height_cm, 1)))
    for portico, sections in sections_by_portico.items():
        if len(sections) > 1:
            issues.append(
                _issue(
                    "structure.beam_section_vs_label",
                    "warning",
                    "estrutura",
                    (
                        f"{portico} tem secções diferentes ({', '.join(f'{w}×{h} cm' for w, h in sorted(sections))}); "
                        "confirme rótulos e tabela de vigas."
                    ),
                    sorted({span.page for span in beam_spans if span.portico == portico}),
                )
            )

    rooms_by_floor: dict[str, float] = defaultdict(float)
    for room in rooms:
        key = (room.floor or "global").strip()
        rooms_by_floor[key] += float(room.area_m2 or 0)

    for slab in structural_summary.slabs:
        if not slab.floor:
            continue
        slab_area = getattr(slab, "area_m2", None)
        if slab_area is None or slab_area <= 0:
            continue
        room_sum = rooms_by_floor.get(slab.floor.strip(), 0)
        if room_sum > 0 and not _tolerance(slab_area, room_sum, pct=0.08, abs_min=2.0):
            issues.append(
                _issue(
                    "structure.slab_area_vs_rooms",
                    "warning",
                    "arquitectura",
                    (
                        f"Área da laje «{slab.floor}» ({slab_area:.2f} m²) difere da soma dos "
                        f"compartimentos ({room_sum:.2f} m²)."
                    ),
                    slab.pages,
                )
            )

    if page_texts and rooms:
        declared_totals: dict[str, float] = {}
        for text in page_texts:
            declared_totals.update(extract_floor_area_totals_from_schedule(text))
        if declared_totals:
            computed_total = round(sum(room.area_m2 for room in rooms), 2)
            for label, declared in declared_totals.items():
                reference = computed_total if label == "global" else rooms_by_floor.get(label, 0)
                if reference > 0 and not _tolerance(declared, reference, pct=0.08, abs_min=2.0):
                    issues.append(
                        _issue(
                            "structure.global_area_vs_compartments",
                            "warning",
                            "arquitectura",
                            (
                                f"Área global declarada ({declared:.2f} m²) difere da soma dos "
                                f"compartimentos ({reference:.2f} m²)."
                            ),
                            sorted({room.page for room in rooms}),
                        )
                    )
                    break

    return issues

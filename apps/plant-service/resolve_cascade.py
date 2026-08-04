"""
Resolução em cascata dos três domínios críticos da planta.

Níveis (só avança se o anterior NÃO passar):

Compartimentos
  L1 Quadro «Rooms by stories»
  L2 Etiquetas A:/área em planta cotada/geral
  L3 Etiquetas A: em planta mobilada
  L4 Lista / memória descritiva
  L5 Assistente IA (Ollama)

Vãos
  L1 Quadro / mapa (P, J, WD, DOO)
  L2 Geometria espacial
  L3 Assistente IA (Ollama)

Aço
  L1 Resumo Total+10% (kg por Ø)
  L2 Dados explícitos: Peso+10% e/ou comprimentos C=
  L3 Estimativa Ø + espaçamento × geometria
"""
from __future__ import annotations

import re
from typing import Any

from cascade import CascadeResult, run_cascade


def _dedupe_rooms(rooms: list, priorities: dict[int, int] | None = None) -> list:
    from parser import dedupe_rooms

    return dedupe_rooms(rooms, priorities)


def resolve_rooms_cascade(
    *,
    schedule_rooms: list,
    labeled_cotada_rooms: list,
    mobiliada_rooms: list,
    fallback_rooms: list,
    page_priorities: dict[int, int],
    page_texts: list[str],
    architecture_pages: set[int],
    default_floor: str | None,
) -> tuple[list, CascadeResult]:
    def with_floor(items: list) -> list:
        if not default_floor:
            return items
        for room in items:
            if room.floor is None:
                room.floor = default_floor
        return items

    def level_schedule():
        items = with_floor(_dedupe_rooms(schedule_rooms, page_priorities))
        return items, f"{len(items)} compartimento(s)"

    def level_cotada():
        items = with_floor(_dedupe_rooms(labeled_cotada_rooms, page_priorities))
        return items, f"{len(items)} compartimento(s)"

    def level_mobiliada():
        items = with_floor(_dedupe_rooms(mobiliada_rooms, page_priorities))
        return items, f"{len(items)} compartimento(s)"

    def level_fallback():
        items = with_floor(_dedupe_rooms(fallback_rooms, page_priorities))
        return items, f"{len(items)} compartimento(s)"

    def level_ai():
        try:
            from ai_assist import assist_with_ai

            rooms, _openings, meta = assist_with_ai(page_texts, [], [], architecture_pages)
            rooms = with_floor(_dedupe_rooms(rooms, page_priorities))
            detail = f"{len(rooms)} via IA"
            if meta.get("error"):
                detail += f" ({meta['error']})"
            return rooms, detail
        except Exception as exc:  # noqa: BLE001
            return [], str(exc)[:120]

    return run_cascade(
        "compartimentos",
        [
            (1, "quadro Rooms by stories", level_schedule),
            (2, "etiquetas A:/área na cotada", level_cotada),
            (3, "etiquetas A: na mobilada", level_mobiliada),
            (4, "lista / memória descritiva", level_fallback),
            (5, "assistente IA (Ollama)", level_ai),
        ],
        min_count=1,
    )


def resolve_openings_cascade(
    *,
    quadro_openings: list,
    spatial_openings: list,
    page_texts: list[str],
    architecture_pages: set[int],
    document_text: str,
) -> tuple[list, CascadeResult]:
    from parser import merge_openings

    def level_quadro():
        items = merge_openings(quadro_openings, document_text)
        return items, f"{len(items)} vão(s)"

    def level_spatial():
        items = merge_openings(spatial_openings, document_text)
        return items, f"{len(items)} vão(s)"

    def level_ai():
        try:
            from ai_assist import assist_with_ai
            from parser import Room

            # Seed com sala sentinela para a IA só procurar vãos (não recomputar áreas).
            seed_rooms = [Room(name="_cascade", number=None, area_m2=1.0, page=1, floor=None)]
            _rooms, openings, meta = assist_with_ai(
                page_texts,
                seed_rooms,
                [],
                architecture_pages,
            )
            items = merge_openings(openings, document_text)
            detail = f"{len(items)} via IA"
            if meta.get("error"):
                detail += f" ({meta['error']})"
            return items, detail
        except Exception as exc:  # noqa: BLE001
            return [], str(exc)[:120]

    return run_cascade(
        "vaos",
        [
            (1, "quadro / mapa de vãos", level_quadro),
            (2, "geometria espacial", level_spatial),
            (3, "assistente IA (Ollama)", level_ai),
        ],
        min_count=1,
    )


def resolve_rebar_cascade(
    *,
    total_plus10_lines: list,
    peso_plus10_lines: list,
    page_texts: dict[int, str],
    structure_pages: set[int],
    rooms: list,
    footings: list,
    beam_spans: list,
    slabs: list,
) -> tuple[list, CascadeResult]:
    from rebar_estimate import (
        estimate_beam_rebar,
        estimate_footing_rebar,
        estimate_slab_rebar_from_area,
        extract_rebar_from_length_callouts,
        merge_rebar_lines,
    )

    structure_texts = {page: text for page, text in page_texts.items() if page in structure_pages}

    def level_total_plus10():
        items = merge_rebar_lines(total_plus10_lines)
        total = sum(line.weight_kg for line in items)
        return items, f"{len(items)} linha(s), {total:.0f} kg"

    def level_explicit_lengths_and_peso():
        # Peso+10% (kg) e chamadas C= são ambos dados do projecto — não estimativa.
        callouts = []
        pages_with_peso = {line.page for line in peso_plus10_lines}
        for page, text in structure_texts.items():
            if page in pages_with_peso:
                continue
            callouts.extend(extract_rebar_from_length_callouts(text, page))
        items = merge_rebar_lines([*peso_plus10_lines, *callouts])
        total = sum(line.weight_kg for line in items)
        return items, f"{len(items)} linha(s), {total:.0f} kg"

    def level_geometry():
        estimated = []
        estimated.extend(estimate_footing_rebar(footings, structure_texts))
        estimated.extend(estimate_slab_rebar_from_area(rooms, slabs, structure_texts))
        estimated.extend(estimate_beam_rebar(beam_spans, structure_texts))
        items = merge_rebar_lines(estimated)
        total = sum(line.weight_kg for line in items)
        return items, f"{len(items)} linha(s), {total:.0f} kg (estimativa)"

    return run_cascade(
        "aco",
        [
            (1, "resumo Total+10% (kg)", level_total_plus10),
            (2, "Peso+10% e/ou comprimentos C=", level_explicit_lengths_and_peso),
            (3, "Ø + espaçamento × geometria", level_geometry),
        ],
        min_count=1,
    )


def cascade_log_lines(results: list[CascadeResult]) -> list[str]:
    return [result.summary for result in results]

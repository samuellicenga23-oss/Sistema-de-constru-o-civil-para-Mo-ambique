"""Normalização de unidades usadas em plantas estruturais e arquitectónicas (pt-MZ)."""
from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class ParsedQuantity:
    value: float
    unit: str
    normalized_m: float | None
    ambiguous: bool
    raw: str


@dataclass(frozen=True)
class ParsedSpacing:
    spacing_cm: float
    ambiguous: bool
    raw: str


@dataclass(frozen=True)
class ParsedSection:
    width_cm: float
    depth_cm: float
    raw: str


@dataclass(frozen=True)
class ParsedConcreteGrade:
    label: str
    family: str | None
    ambiguous_equivalence: bool
    raw: str


def _to_float(raw: str) -> float:
    cleaned = raw.strip().replace(",", ".")
    return float(cleaned)


def parse_length_to_m(raw: str, *, context: str = "dimension") -> ParsedQuantity:
    """Converte mm/cm/m para metros quando seguro; assinala ambiguidade."""
    text = raw.strip()
    lowered = text.lower()

    explicit_mm = re.search(r"([\d.,]+)\s*mm\b", lowered)
    explicit_cm = re.search(r"([\d.,]+)\s*cm\b", lowered)
    explicit_m = re.search(r"([\d.,]+)\s*m(?:\b|$)", lowered)

    if explicit_mm:
        value = _to_float(explicit_mm.group(1))
        return ParsedQuantity(value, "mm", round(value / 1000, 4), False, text)
    if explicit_cm:
        value = _to_float(explicit_cm.group(1))
        return ParsedQuantity(value, "cm", round(value / 100, 4), False, text)
    if explicit_m:
        value = _to_float(explicit_m.group(1))
        return ParsedQuantity(value, "m", round(value, 4), False, text)

    numeric = re.fullmatch(r"[\d.,]+", text)
    if not numeric:
        raise ValueError(f"Valor numérico não reconhecido: {raw!r}")

    value = _to_float(text)
    ambiguous = False
    if context == "diameter" and value <= 50:
        unit = "mm"
        normalized = round(value / 1000, 4)
    elif value >= 300:
        unit = "mm"
        normalized = round(value / 1000, 4)
    elif value > 20:
        unit = "cm"
        normalized = round(value / 100, 4)
        ambiguous = 15 < value <= 20
    else:
        unit = "m"
        normalized = round(value, 4)
        ambiguous = value > 3

    return ParsedQuantity(value, unit, normalized, ambiguous, text)


def parse_diameter_mm(raw: str) -> ParsedQuantity:
    """Reconhece Ø12, Φ10, 12mm, etc."""
    text = raw.strip()
    match = re.search(r"(?:Ø|Φ|φ|fi|#)\s*([\d.,]+)", text, re.IGNORECASE)
    if match:
        value = _to_float(match.group(1))
        return ParsedQuantity(value, "mm", round(value / 1000, 4), False, text)
    bare = re.fullmatch(r"[\d.,]+", text)
    if bare:
        value = _to_float(text)
        return ParsedQuantity(value, "mm", round(value / 1000, 4), value <= 3, text)
    return parse_length_to_m(text, context="diameter")


def parse_section_cm(raw: str) -> ParsedSection | None:
    """Secções rectangulares 20x30 ou 20×30 (cm)."""
    text = raw.strip()
    match = re.search(r"(\d{2,3})\s*[x×]\s*(\d{2,3})", text, re.IGNORECASE)
    if not match:
        return None
    return ParsedSection(float(match.group(1)), float(match.group(2)), text)


def parse_spacing_cm(raw: str) -> ParsedSpacing | None:
    """Espaçamentos c/15, @15, e/15 — devolve cm."""
    text = raw.strip()
    match = re.search(r"(?:c/|@|e/|a/)\s*([\d.,]+)", text, re.IGNORECASE)
    if match:
        return ParsedSpacing(_to_float(match.group(1)), False, text)
    bare = re.fullmatch(r"[\d.,]+", text)
    if bare:
        value = _to_float(text)
        ambiguous = 8 <= value <= 30
        return ParsedSpacing(value, ambiguous, text)
    return None


def parse_concrete_grade(raw: str) -> ParsedConcreteGrade | None:
    """B20/B25/C20/25 — não assume equivalência silenciosa entre famílias."""
    text = raw.strip().upper()
    match = re.search(r"\b([BC])(\d{2})(?:/(\d{2}))?\b", text)
    if not match:
        return None
    family = match.group(1)
    first = match.group(2)
    second = match.group(3)
    label = f"{family}{first}/{second}" if second else f"{family}{first}"
    ambiguous = family == "C" and second is not None and first != second
    return ParsedConcreteGrade(label, family, ambiguous, raw.strip())

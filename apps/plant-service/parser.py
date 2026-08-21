"""
Extracção de dados de plantas ArchiCAD exportadas em PDF vectorial.

Abordagem: extracção de texto posicionado (não visão computacional) — o ArchiCAD já escreve
como texto vectorial as áreas de compartimentos e os pesos de aço por elemento estrutural,
confirmado por análise real de um projecto de exemplo (Projecto Completo Gil.pdf, 91 páginas).
Reconstrução geométrica de paredes a partir de cotas/linhas fica fora de âmbito (ver plano).
"""
import re
import math
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from difflib import SequenceMatcher

import fitz  # PyMuPDF


@dataclass
class Room:
    name: str
    number: str | None
    area_m2: float
    page: int
    floor: str | None = None
    # Perímetro real (quando a planta o dá directamente, ex: tabela "Rooms by stories" do
    # ArchiCAD) — mais exacto do que aproximar o compartimento como um quadrado de área
    # equivalente, que é o que se faz quando este campo fica a None.
    perimeter_m: float | None = None


@dataclass
class Opening:
    kind: str
    code: str | None
    width_m: float | None
    height_m: float | None
    sill_height_m: float | None
    quantity: int
    floor: str | None
    location: str
    material: str | None
    page: int
    confidence: float
    source: str
    needs_confirmation: bool
    designation: str | None = None


@dataclass
class RebarLine:
    element: str
    diameter_mm: float
    weight_kg: float
    page: int
    # Agrupa linhas do mesmo quadro «Resumo Aço» (fingerprint) sem alterar a página real —
    # necessário para _on_struct filtrar por page ∈ structure_pages.
    group_id: int | None = None


@dataclass
class FootingRebarSpec:
    """Uma face da malha de sapata no quadro (ex: «4Ø10a/15»)."""
    bar_count: int
    diameter_mm: float
    spacing_cm: float


@dataclass
class Footing:
    refs: list[str]
    width_cm: float
    length_cm: float
    height_cm: float
    page: int
    bottom_x: FootingRebarSpec | None = None
    bottom_y: FootingRebarSpec | None = None
    top_x: FootingRebarSpec | None = None
    top_y: FootingRebarSpec | None = None


@dataclass
class ColumnGroup:
    refs: list[str]
    page: int
    shape: str = "rectangular"
    width_cm: float | None = None
    depth_cm: float | None = None
    diameter_cm: float | None = None
    from_floor: str | None = None
    to_floor: str | None = None
    explicit_height_m: float | None = None
    longitudinal_bar_count: int | None = None
    longitudinal_diameter_mm: float | None = None
    stirrup_diameter_mm: float | None = None
    stirrup_spacing_cm: float | None = None
    steel_weight_kg: float = 0.0
    steel_source: str = "calculated"
    confidence: float = 0.4


@dataclass
class StructuralFloor:
    label: str
    sort_order: int
    elevation_m: float | None = None
    floor_to_floor_height_m: float | None = None
    slab_thickness_m: float | None = None
    source: str = "plant"


@dataclass
class BeamSpan:
    portico: str
    width_cm: float
    height_cm: float
    length_m: float
    page: int
    floor: str | None = None


@dataclass
class Staircase:
    element: str
    width_m: float
    thickness_m: float
    steps_count: int
    rise_m: float
    page: int


@dataclass
class SlabRebarLayer:
    x_diameter_mm: float
    x_spacing_cm: float
    y_diameter_mm: float
    y_spacing_cm: float


@dataclass
class Slab:
    floor: str | None
    layer: str  # "inferior" | "superior"
    thickness_cm: float
    page: int
    rebar: SlabRebarLayer | None = None
    concrete_class: str | None = None
    steel_grade: str | None = None
    cover_cm: float | None = None


@dataclass
class SlabSummary:
    floor: str | None
    thickness_cm: float
    layers: list[str]
    pages: list[int]
    top_rebar: SlabRebarLayer | None = None
    bottom_rebar: SlabRebarLayer | None = None
    top_steel_weight_kg: float = 0.0
    bottom_steel_weight_kg: float = 0.0
    steel_by_diameter: dict[str, float] = field(default_factory=dict)
    concrete_class: str | None = None
    steel_grade: str | None = None
    cover_cm: float | None = None


@dataclass
class StructuralSummary:
    footings_count: int
    footings_avg_width_cm: float
    footings_avg_length_cm: float
    footings_avg_depth_cm: float
    columns_count: int
    beams_count: int
    beams_total_length_m: float
    beams_avg_width_cm: float
    beams_avg_height_cm: float
    beams_concrete_volume_m3: float
    staircases_count: int
    slabs_count: int
    slabs_avg_thickness_cm: float
    slabs: list[SlabSummary]
    total_steel_weight_kg: float
    footings_steel_weight_kg: float = 0.0
    columns_steel_weight_kg: float = 0.0
    beams_steel_weight_kg: float = 0.0
    slabs_steel_weight_kg: float = 0.0
    stairs_steel_weight_kg: float = 0.0
    columns_concrete_volume_m3: float = 0.0
    beam_groups: list["BeamGroupSummary"] = field(default_factory=list)
    column_groups: list["ColumnGroupSummary"] = field(default_factory=list)
    floors: list["StructuralFloor"] = field(default_factory=list)


@dataclass
class BeamGroupSummary:
    """Vigas agregadas por laje/piso — orçamento liga cada grupo ao respectivo nível."""

    label: str
    slab_index: int | None
    floor: str | None
    beams_count: int
    total_length_m: float
    avg_width_cm: float
    avg_height_cm: float
    steel_weight_kg: float


@dataclass
class ColumnGroupSummary:
    code: str
    shape: str
    width_cm: float | None
    depth_cm: float | None
    diameter_cm: float | None
    quantity: int
    from_floor: str | None
    to_floor: str | None
    explicit_height_m: float | None
    longitudinal_bar_count: int | None
    longitudinal_diameter_mm: float | None
    stirrup_diameter_mm: float | None
    stirrup_spacing_cm: float | None
    concrete_volume_m3: float
    steel_weight_kg: float
    steel_source: str
    source_page: int
    confidence: float
    needs_confirmation: bool


def _classify_steel_weights(
    rebar_schedules: list[RebarLine],
) -> tuple[float, float, float, float, float, float]:
    """Devolve (sapatas, pilares, vigas, lajes, escadas, total) com 2 casas decimais."""
    footings = columns = beams = slabs = stairs = 0.0
    for line in rebar_schedules:
        weight = float(line.weight_kg or 0)
        if weight <= 0:
            continue
        element = (line.element or "").lower()
        if re.search(r"sapata|footing|funda[cç]|maci[cç]o|radier", element):
            footings += weight
        elif re.search(r"pilar|coluna|column|pilarete", element) or re.search(
            r"(?:^|[\s,;])p\d+(?:\s*=\s*p\d+)*(?=$|[\s,;/])", element
        ):
            columns += weight
        elif re.search(r"escada|staircase|\bstair\b", element):
            stairs += weight
        elif re.search(r"viga|p[oó]rtico|beam|lintel", element):
            beams += weight
        elif re.search(r"laje|cobertura|armadura longitudinal|slab|malha", element):
            slabs += weight
        else:
            # Elementos não classificados entram no total mas não nas famílias editáveis.
            pass
    total = sum(float(line.weight_kg or 0) for line in rebar_schedules)
    return (
        round(footings, 2),
        round(columns, 2),
        round(beams, 2),
        round(slabs, 2),
        round(stairs, 2),
        round(total, 2),
    )


def _build_beam_groups(
    beam_spans: list[BeamSpan],
    slab_summaries: list[SlabSummary],
    beams_steel: float,
    rebar_schedules: list[RebarLine] | None = None,
) -> list[BeamGroupSummary]:
    """Agrupa vãos de vigas pela laje/piso mais próxima em página (medições por nível)."""
    if not beam_spans and not slab_summaries:
        return []

    if not slab_summaries:
        lengths = [b.length_m for b in beam_spans]
        widths = [b.width_cm for b in beam_spans]
        heights = [b.height_cm for b in beam_spans]
        porticos = {(b.portico, b.page) for b in beam_spans}
        return [
            BeamGroupSummary(
                label="Vigas gerais",
                slab_index=None,
                floor=None,
                beams_count=len(porticos),
                total_length_m=round(sum(lengths), 2),
                avg_width_cm=round(_avg(widths), 2),
                avg_height_cm=round(_avg(heights), 2),
                steel_weight_kg=round(beams_steel, 2),
            )
        ]

    buckets: list[list[BeamSpan]] = [[] for _ in slab_summaries]
    for span in beam_spans:
        best_idx = next(
            (
                idx
                for idx, slab in enumerate(slab_summaries)
                if span.floor and slab.floor and _normalise_key(span.floor) == _normalise_key(slab.floor)
            ),
            None,
        )
        if best_idx is None:
            best_idx = 0
            # A planta geral e a primeira pÃ¡gina do grupo sÃ£o Ã¢ncoras melhores do que as
            # folhas de armadura, que podem surgir dezenas de pÃ¡ginas mais tarde.
            best_dist = abs(span.page - (slab_summaries[0].pages[0] if slab_summaries[0].pages else span.page))
            for idx, slab in enumerate(slab_summaries):
                anchor = slab.pages[0] if slab.pages else span.page
                dist = abs(span.page - anchor)
                if dist < best_dist:
                    best_dist = dist
                    best_idx = idx
        buckets[best_idx].append(span)

    beam_rebar = [
        line
        for line in (rebar_schedules or [])
        if re.search(r"viga|p[oÃ³]rtico|beam|lintel", (line.element or ""), re.IGNORECASE)
    ]
    floor_starts = sorted(
        (
            (min(span.page for span in beam_spans if span.floor == floor), floor)
            for floor in {span.floor for span in beam_spans if span.floor}
        ),
        key=lambda item: item[0],
    )

    def floor_for_rebar_page(page: int) -> str | None:
        if not floor_starts:
            return None
        eligible = [item for item in floor_starts if item[0] <= page]
        if eligible:
            return eligible[-1][1]
        return floor_starts[0][1]

    def steel_for_floor(floor: str | None) -> float:
        if not floor or not beam_rebar:
            return 0.0
        assigned = 0.0
        for line in beam_rebar:
            if floor_for_rebar_page(line.page) == floor:
                assigned += float(line.weight_kg or 0)
        return round(assigned, 2)

    groups: list[BeamGroupSummary] = []
    steel_remaining = beams_steel
    nonempty = sum(1 for bucket in buckets if bucket) or 1
    for idx, (slab, spans) in enumerate(zip(slab_summaries, buckets)):
        slab_label = (slab.floor or f"Laje {idx + 1}").strip()
        lengths = [b.length_m for b in spans]
        widths = [b.width_cm for b in spans]
        heights = [b.height_cm for b in spans]
        porticos = {(b.portico, b.page) for b in spans}
        share = steel_for_floor(slab.floor)
        if not beam_rebar:
            share = round(beams_steel / nonempty, 2) if spans else 0.0
            if idx == len(slab_summaries) - 1 and spans:
                share = round(steel_remaining, 2)
            elif spans:
                steel_remaining = round(steel_remaining - share, 2)
        groups.append(
            BeamGroupSummary(
                label=f"Vigas da {slab_label}",
                slab_index=idx,
                floor=slab.floor,
                beams_count=len(porticos),
                total_length_m=round(sum(lengths), 2),
                avg_width_cm=round(_avg(widths), 2) if widths else 0.0,
                avg_height_cm=round(_avg(heights), 2) if heights else 0.0,
                steel_weight_kg=share,
            )
        )
    return groups


@dataclass
class PlantMetadata:
    proprietario: str | None = None
    fase: str | None = None
    bairro: str | None = None
    talhao: str | None = None
    distrito: str | None = None
    especialidade: str | None = None
    conteudo: str | None = None
    numero: str | None = None
    escala: str | None = None


@dataclass
class DocumentIdentity:
    owner: str | None = None
    location: str | None = None
    project_title: str | None = None
    pages: list[int] = field(default_factory=list)


@dataclass
class DocumentIdentityConflict:
    field: str
    severity: str
    values: list[dict] = field(default_factory=list)


@dataclass
class DocumentSection:
    discipline: str
    label: str
    start_page: int
    end_page: int
    page_count: int
    confidence: float
    evidence: list[str] = field(default_factory=list)
    identity: DocumentIdentity | None = None


@dataclass
class TechnicalQualityIssue:
    code: str
    severity: str
    scope: str
    message: str
    pages: list[int] = field(default_factory=list)
    requires_confirmation: bool = False


@dataclass
class HydroPipeEvidence:
    system: str
    material: str | None
    diameter_mm: float | None
    diameter_inch: str | None
    page: int
    occurrences: int
    evidence_kind: str
    measured_length_m: float | None = None
    confidence: float = 0.0
    floor: str | None = None
    measurement_basis: str | None = None
    trace_colour: str | None = None


@dataclass
class HydroEquipmentEvidence:
    kind: str
    page: int
    occurrences: int
    evidence_kind: str
    capacity_l: float | None = None
    confidence: float = 0.0
    quantity: int | None = None
    code: str | None = None
    floor: str | None = None
    source: str = "text_evidence"
    requires_confirmation: bool = True


@dataclass
class HydrosanitarySummary:
    systems: list[str] = field(default_factory=list)
    pipes: list[HydroPipeEvidence] = field(default_factory=list)
    equipment: list[HydroEquipmentEvidence] = field(default_factory=list)
    septic_tank_detected: bool = False
    pool_detected: bool = False
    quantitative_coverage: str = "evidence_only"
    requires_confirmation: bool = True


@dataclass
class DocumentAnalysis:
    page_count: int
    is_multi_discipline: bool
    sections: list[DocumentSection] = field(default_factory=list)
    matched_tags: list[str] = field(default_factory=list)
    identity_conflicts: list[DocumentIdentityConflict] = field(default_factory=list)
    requires_identity_confirmation: bool = False
    identity_confirmed: bool = False
    quality_issues: list[TechnicalQualityIssue] = field(default_factory=list)
    requires_technical_confirmation: bool = False
    hydrosanitary_summary: HydrosanitarySummary | None = None


@dataclass
class PageClassification:
    page: int
    discipline: str
    confidence: float
    evidence: list[str] = field(default_factory=list)


@dataclass
class ParseResult:
    metadata: PlantMetadata
    rooms: list[Room] = field(default_factory=list)
    openings: list[Opening] = field(default_factory=list)
    rebar_schedules: list[RebarLine] = field(default_factory=list)
    staircases: list[Staircase] = field(default_factory=list)
    structural_summary: StructuralSummary | None = None
    document_analysis: DocumentAnalysis | None = None


DOCUMENT_DISCIPLINE_LABELS = {
    "arquitectura": "Arquitectura",
    "estrutura": "Estrutura",
    "hidrossanitario": "Hidrossanitário",
    "electricidade": "Electricidade",
    "outro": "Documentação geral",
}

# A classificação não confia num único campo do carimbo. Em projectos reais, as pranchas de
# água/drenagem podem conservar por engano "Especialidade: ARQUITECTURA". Sinais do conteúdo
# técnico têm por isso peso superior ao carimbo genérico.
DOCUMENT_DISCIPLINE_PATTERNS: dict[str, list[tuple[int, re.Pattern, str]]] = {
    "arquitectura": [
        (5, re.compile(r"planta\s+(?:cotada|dimensionada|mobil(?:i)?ada|baixa|de\s+piso)", re.IGNORECASE), "tipo de planta arquitectónica"),
        (4, re.compile(r"projecto\s+arquit(?:et[oô]nico|ect[oó]nico)", re.IGNORECASE), "título de projecto arquitectónico"),
        (3, re.compile(r"especialidade\s*:?\s*arquitectura", re.IGNORECASE), "carimbo de arquitectura"),
        (2, re.compile(r"\bal[çc]ados?\b|\bplanta\s+de\s+implanta[çc][ãa]o\b", re.IGNORECASE), "conteúdo arquitectónico"),
    ],
    "estrutura": [
        (12, re.compile(r"especialidade\s*:?\s*estrutura", re.IGNORECASE), "carimbo de estrutura"),
        (10, re.compile(r"projecto\s+estrutural", re.IGNORECASE), "título de projecto estrutural"),
        (8, re.compile(r"quadro\s+de\s+(?:pilares|elementos\s+de\s+funda[çc][ãa]o)|pormenor\s+de\s+vigas", re.IGNORECASE), "quadro estrutural"),
        (7, re.compile(r"planta\s+de\s+(?:funda[çc][ãa]o|elementos\s+estruturais)|armadura\s+(?:inferior|superior|longitudinal)", re.IGNORECASE), "prancha estrutural"),
    ],
    "hidrossanitario": [
        (14, re.compile(r"projecto\s+hidrossanit[áa]rio", re.IGNORECASE), "título de projecto hidrossanitário"),
        (12, re.compile(r"projecto\s+de\s+abastecimento\s+de\s+[áa]gua\s+e\s+saneamento", re.IGNORECASE), "título de água e saneamento"),
        (12, re.compile(r"\bHID\s*[.\-]?\s*\d+\b", re.IGNORECASE), "código de prancha HID"),
        (10, re.compile(r"abastecimento\s+de\s+[áa]gua|drenagem\s+de\s+[áa]guas?|saneamento\s*[–—-]?\s*[áa]guas", re.IGNORECASE), "rede de água/drenagem"),
        (7, re.compile(r"rede\s+de\s+(?:abastecimento|drenagem)|fossa\s+s[ée]ptica|[áa]guas?\s+(?:residuais|pluviais)|contador\s+de\s+[áa]gua|termoaquecedor", re.IGNORECASE), "elementos hidrossanitários"),
    ],
    "electricidade": [
        (14, re.compile(r"projecto\s+el[ée]ctrico", re.IGNORECASE), "título de projecto eléctrico"),
        (12, re.compile(r"\bEL(?:EC|E|T)\s*[.\-]?\s*\d+\b", re.IGNORECASE), "código de prancha eléctrica"),
        (11, re.compile(r"instala[çc][ãa]o\s+el[ée]ctrica|planta\s+de\s+(?:ilumina[çc][ãa]o|tomadas)", re.IGNORECASE), "planta eléctrica"),
        (7, re.compile(r"quadro\s+el[ée]ctrico|circuitos?\s+el[ée]ctricos?|pontos?\s+de\s+(?:luz|tomada)", re.IGNORECASE), "elementos eléctricos"),
    ],
}


def _page_discipline_scores(text: str) -> tuple[dict[str, int], dict[str, list[str]]]:
    scores = {discipline: 0 for discipline in DOCUMENT_DISCIPLINE_PATTERNS}
    evidence: dict[str, list[str]] = {discipline: [] for discipline in DOCUMENT_DISCIPLINE_PATTERNS}
    for discipline, patterns in DOCUMENT_DISCIPLINE_PATTERNS.items():
        for weight, pattern, label in patterns:
            if pattern.search(text):
                scores[discipline] += weight
                if label not in evidence[discipline]:
                    evidence[discipline].append(label)
    return scores, evidence


def classify_document_pages(
    page_texts: list[str],
    page_hints: dict[int, list[tuple[str, int, str]]] | None = None,
) -> list[PageClassification]:
    """Classifica o documento inteiro, favorecendo continuidade sem esconder mudanças reais."""
    if not page_texts:
        return []
    disciplines = list(DOCUMENT_DISCIPLINE_PATTERNS)
    observations = [_page_discipline_scores(text) for text in page_texts]
    for page, hints in (page_hints or {}).items():
        if page < 1 or page > len(observations):
            continue
        scores, evidence = observations[page - 1]
        for discipline, weight, label in hints:
            if discipline not in scores:
                continue
            scores[discipline] += weight
            if label not in evidence[discipline]:
                evidence[discipline].append(label)
    if not any(max(scores.values(), default=0) > 0 for scores, _ in observations):
        return [PageClassification(page=index + 1, discipline="outro", confidence=0.4) for index in range(len(page_texts))]

    # Viterbi simples: mudar de especialidade tem um custo. Duas páginas com um carimbo antigo
    # não partem uma secção; uma capa/título técnico forte ultrapassa imediatamente esse custo.
    transition_penalty = 8
    paths: list[dict[str, tuple[float, str | None]]] = []
    first_scores, _ = observations[0]
    paths.append({discipline: (float(first_scores[discipline]), None) for discipline in disciplines})
    for page_index in range(1, len(page_texts)):
        scores, _ = observations[page_index]
        current: dict[str, tuple[float, str | None]] = {}
        previous = paths[-1]
        for discipline in disciplines:
            candidates = [
                (previous[previous_discipline][0] - (0 if previous_discipline == discipline else transition_penalty), previous_discipline)
                for previous_discipline in disciplines
            ]
            best_score, best_previous = max(candidates, key=lambda candidate: candidate[0])
            current[discipline] = (best_score + scores[discipline], best_previous)
        paths.append(current)

    last_discipline = max(paths[-1], key=lambda discipline: paths[-1][discipline][0])
    selected = [last_discipline]
    for page_index in range(len(page_texts) - 1, 0, -1):
        previous = paths[page_index][selected[-1]][1]
        selected.append(previous or selected[-1])
    selected.reverse()

    classifications: list[PageClassification] = []
    for page_index, discipline in enumerate(selected):
        scores, evidence_by_discipline = observations[page_index]
        ordered_scores = sorted(scores.values(), reverse=True)
        selected_score = scores[discipline]
        second_score = next((score for score in ordered_scores if score < selected_score), 0)
        if selected_score == 0:
            confidence = 0.68
            evidence = ["continuidade com as páginas adjacentes"]
        else:
            margin = max(selected_score - second_score, 0)
            confidence = min(0.99, 0.7 + selected_score / 60 + margin / 80)
            evidence = evidence_by_discipline[discipline][:3]
        classifications.append(
            PageClassification(
                page=page_index + 1,
                discipline=discipline,
                confidence=round(confidence, 2),
                evidence=evidence,
            )
        )
    return classifications


IDENTITY_FALLBACK_PATTERNS = {
    "owner": [
        re.compile(r"(?im)^[ \t]*(?:propriet[áa]rio|dono[ \t]+da[ \t]+obra|cliente)[ \t]*[:\-][ \t]*([^\n\r:]{3,100})"),
    ],
    "location": [
        re.compile(r"(?im)^[ \t]*(?:localiza[çc][ãa]o|local|distrito)[ \t]*[:\-][ \t]*([^\n\r:]{2,120})"),
        re.compile(
            r"(?i)\ba\s+ser\s+constru[íi]d[ao]\s+em\s+([^\n\r.,;]{2,100})"
        ),
        re.compile(
            r"(?i)\blocalizad[ao]\s+n[ao]\s+(?:prov[íi]ncia\s+de\s+|cidade\s+de\s+|bairro\s+)?"
            r"([^\n\r.,;]{2,100})"
        ),
    ],
    "project_title": [
        re.compile(r"(?im)^[ \t]*(?:projecto|projeto|obra|empreendimento)[ \t]*[:\-][ \t]*(?!arquitect|arquitet|estrutur|hidr|el[ée]ct)([^\n\r:]{3,140})"),
    ],
}

IDENTITY_INVALID_VALUES = {
    "FASE",
    "LEGENDA",
    "LEGENDA OBSERVACOES",
    "OBSERVACOES",
    "PROJECTOU",
    "PROJETOU",
    "DESENHOU",
    "VERIFICOU",
}


def _clean_identity_value(value: str | None) -> str | None:
    if not value:
        return None
    cleaned = re.sub(r"\s+", " ", value).strip(" .,:;|-/")
    if len(cleaned) < 2 or len(cleaned) > 160:
        return None
    if _normalise_key(cleaned) in IDENTITY_INVALID_VALUES:
        return None
    return cleaned


def _fallback_identity_value(text: str, field_name: str) -> str | None:
    for pattern in IDENTITY_FALLBACK_PATTERNS[field_name]:
        match = pattern.search(text)
        if match:
            value = _clean_identity_value(match.group(1))
            if value:
                return value
    return None


def _section_identity(page_texts: list[str], start_page: int, end_page: int) -> DocumentIdentity | None:
    candidates: dict[str, list[tuple[str, int]]] = defaultdict(list)
    for page_number in range(start_page, end_page + 1):
        if page_number < 1 or page_number > len(page_texts):
            continue
        text = page_texts[page_number - 1]
        metadata = extract_metadata(text)
        owner = _clean_identity_value(metadata.proprietario) or _fallback_identity_value(text, "owner")
        location = _clean_identity_value(metadata.distrito) or _fallback_identity_value(text, "location")
        project_title = _fallback_identity_value(text, "project_title")
        for field_name, value in (("owner", owner), ("location", location), ("project_title", project_title)):
            if value:
                candidates[field_name].append((value, page_number))

    selected: dict[str, str | None] = {"owner": None, "location": None, "project_title": None}
    pages: set[int] = set()
    for field_name, values in candidates.items():
        grouped: list[list[tuple[str, int]]] = []
        for value, page in values:
            equivalent_group = next(
                (group for group in grouped if _identity_equivalent(group[0][0], value)),
                None,
            )
            if equivalent_group is None:
                grouped.append([(value, page)])
            else:
                equivalent_group.append((value, page))
        if not grouped:
            continue
        occurrences = max(grouped, key=lambda group: (len(group), -group[0][1]))
        spelling_counts = Counter(value for value, _ in occurrences)
        selected[field_name] = max(spelling_counts, key=lambda value: (spelling_counts[value], -len(value)))
        pages.update(page for _, page in occurrences)
    if not any(selected.values()):
        return None
    return DocumentIdentity(
        owner=selected["owner"],
        location=selected["location"],
        project_title=selected["project_title"],
        pages=sorted(pages),
    )


def _identity_equivalent(left: str, right: str) -> bool:
    a, b = _normalise_key(left), _normalise_key(right)
    if not a or not b:
        return True
    if a == b or (min(len(a), len(b)) >= 6 and (a in b or b in a)):
        return True
    return SequenceMatcher(None, a, b).ratio() >= 0.84


def _identity_conflicts(
    sections: list[DocumentSection],
    page_texts: list[str] | None = None,
) -> list[DocumentIdentityConflict]:
    conflicts: list[DocumentIdentityConflict] = []
    for field_name in ("owner", "location", "project_title"):
        values: list[dict] = []

        def add_value(value: str, discipline: str, pages: list[int]) -> None:
            def equivalent(left: str, right: str) -> bool:
                if _identity_equivalent(left, right):
                    return True
                if field_name != "location":
                    return False
                ignored = {"BAIRRO", "CIDADE", "PROVINCIA", "DISTRITO", "MOCAMBIQUE", "DE", "DA", "DO"}
                left_tokens = set(_normalise_key(left).split()) - ignored
                right_tokens = set(_normalise_key(right).split()) - ignored
                return bool(left_tokens and right_tokens and left_tokens == right_tokens)

            existing = next((item for item in values if equivalent(item["value"], value)), None)
            if existing:
                if discipline not in existing["disciplines"]:
                    existing["disciplines"].append(discipline)
                existing["pages"] = sorted(set(existing["pages"] + pages))
            else:
                values.append({"value": value, "disciplines": [discipline], "pages": pages[:]})

        for section in sections:
            if section.discipline == "outro" or not section.identity:
                continue
            value = getattr(section.identity, field_name)
            if not value:
                continue
            add_value(value, section.discipline, section.identity.pages)

            # MemÃ³rias copiadas de outro projecto podem contradizer o carimbo dentro da mesma
            # especialidade. Para localizaÃ§Ã£o, recolhe tambÃ©m declaraÃ§Ãµes inequÃ­vocas do corpo
            # do documento e nÃ£o apenas o valor maioritÃ¡rio escolhido para a secÃ§Ã£o.
            if field_name == "location" and page_texts:
                for page_number in range(section.start_page, section.end_page + 1):
                    if not 1 <= page_number <= len(page_texts):
                        continue
                    candidate = _fallback_identity_value(page_texts[page_number - 1], "location")
                    if candidate:
                        add_value(candidate, section.discipline, [page_number])
        represented_disciplines = {discipline for item in values for discipline in item["disciplines"]}
        if len(values) > 1 and (len(represented_disciplines) > 1 or field_name == "location"):
            conflicts.append(DocumentIdentityConflict(field=field_name, severity="critical", values=values))
    return conflicts


def build_document_analysis(classifications: list[PageClassification], page_texts: list[str] | None = None) -> DocumentAnalysis:
    if not classifications:
        return DocumentAnalysis(page_count=0, is_multi_discipline=False)
    sections: list[DocumentSection] = []
    start = 0
    while start < len(classifications):
        discipline = classifications[start].discipline
        end = start
        while end + 1 < len(classifications) and classifications[end + 1].discipline == discipline:
            end += 1
        section_pages = classifications[start : end + 1]
        evidence_counts = Counter(item for page in section_pages for item in page.evidence)
        evidence = [item for item, _ in evidence_counts.most_common(3)]
        sections.append(
            DocumentSection(
                discipline=discipline,
                label=DOCUMENT_DISCIPLINE_LABELS[discipline],
                start_page=section_pages[0].page,
                end_page=section_pages[-1].page,
                page_count=len(section_pages),
                confidence=round(sum(page.confidence for page in section_pages) / len(section_pages), 2),
                evidence=evidence,
                identity=_section_identity(page_texts, section_pages[0].page, section_pages[-1].page) if page_texts else None,
            )
        )
        start = end + 1
    recognized = {section.discipline for section in sections if section.discipline != "outro"}
    conflicts = _identity_conflicts(sections, page_texts)
    return DocumentAnalysis(
        page_count=len(classifications),
        is_multi_discipline=len(recognized) > 1,
        sections=sections,
        identity_conflicts=conflicts,
        requires_identity_confirmation=any(conflict.severity == "critical" for conflict in conflicts),
    )


# Etiquetas de área usadas por diferentes programas/gabinetes: ArchiCAD costuma exportar
# "A:" ou "CA:", Revit/AutoCAD aparecem frequentemente como "Área", "Area", "S" ou
# "Superfície". O formato anterior exigia NOME EM MAIÚSCULAS + "A:" e, por isso, ignorava
# plantas perfeitamente legíveis como "Suite 2 / CA: 22,400 m2".
AREA_UNIT_PATTERN = r"(?:m\s*[²2]|sqm|sq\.?\s*m)"
AREA_LABEL_PATTERN = (
    r"(?:C\s*\.?\s*A|ÁREA(?:\s+(?:ÚTIL|BRUTA))?|AREA(?:\s+(?:UTIL|BRUTA))?|"
    r"SUP(?:ERF[ÍI]CIE)?|S|A)"
)
ROOM_PATTERN = re.compile(
    rf"(?im)^[ \t•·\-–—]*"
    rf"(?P<name>[^\n\r:;]{{2,80}}?)[ \t]*(?:\r?\n[ \t]*)?"
    rf"(?<!\w)(?P<label>{AREA_LABEL_PATTERN})(?!\w)[ \t]*[:=\.\-]?[ \t]*"
    rf"(?P<area>\d{{1,4}}(?:[.,]\d{{1,4}})?)[ \t]*{AREA_UNIT_PATTERN}[ \t]*$"
)

# Uma etiqueta de ambiente pode estar separada da área em blocos diferentes, ou a área pode
# vir sem prefixo (ex: Revit: "12.45 m²"). Esta expressão é propositadamente estrita e só
# aceita uma linha composta pela área; a associação ao nome é depois feita pelas coordenadas
# reais da página em ``extract_rooms_spatial``.
AREA_ONLY_PATTERN = re.compile(
    rf"(?i)^\s*(?:(?:{AREA_LABEL_PATTERN})(?!\w)\s*[:=\.\-]?\s*)?"
    rf"(?P<area>\d{{1,4}}(?:[.,]\d{{1,4}})?)\s*{AREA_UNIT_PATTERN}\s*$"
)
PERIMETER_ONLY_PATTERN = re.compile(
    r"(?i)^\s*(?:P(?:ER[IÍ]METRO)?|PERIMETER)\s*[:=]\s*"
    r"(?P<perimeter>\d{1,4}(?:[.,]\d{1,3})?)\s*m\s*$"
)

# Último recurso para PDFs que não colocam etiquetas de área na planta, mas incluem um quadro
# ou uma memória descritiva com uma lista explícita de ambientes. Só é usado quando nenhuma
# área etiquetada/tabela foi encontrada no documento inteiro, evitando misturar a área da
# memória com uma revisão mais recente desenhada na planta.
ROOM_VOCABULARY = (
    r"sala(?:\s+de\s+(?:estar|jantar))?|quarto|suite|suíte|cozinha|copa|corredor|hall|"
    r"w\.?\s*c\.?|wc|casa\s+de\s+banho|banho|lavabo|despensa|arrumo|arrecada[çc][ãa]o|"
    r"lavandaria|área\s+de\s+servi[çc]o|area\s+de\s+servico|varanda|terra[çc]o|garagem|"
    r"escritório|escritorio|biblioteca|closet|vestíbulo|vestibulo|escada|floreira|"
    r"living|bedroom|kitchen|bathroom|toilet|corridor|lobby|laundry|pantry|garage|balcony"
)
ROOM_LIST_PATTERN = re.compile(
    rf"(?im)^[ \t•·\-–—]*(?P<name>(?:{ROOM_VOCABULARY})[^\n;:]{{0,60}}?)\s+"
    rf"(?P<area>\d{{1,4}}(?:[.,]\d{{1,4}})?)\s*{AREA_UNIT_PATTERN}\s*[;.]?\s*$"
)

ROOM_NAME_REJECT_PATTERN = re.compile(
    r"^(?:"
    r"fase|especialidade|propriet[aá]ri[oa]|projectou|conte[uú]do|nome\s+do\s+desenho|"
    r"layout\s+id|revision|revis[aã]o|escala|n[uú]mero|legenda|observa[çc][õo]es|"
    r"planta|projecto|projeto|al[çc]ado|corte|pormenor|detalhe|gspublisherversion|"
    r"nomeclatura|quantidade|largura|altura"
    r")\b|"
    r"^(?:area|área|measured|perimeter|wall\s*surf\.?|r\.?\s*height|story|room|total)$",
    re.IGNORECASE,
)

# Variações e gralhas recorrentes dos próprios desenhos. A forma normalizada também melhora a
# deduplicação entre uma planta geral e a respectiva planta cotada.
ROOM_NAME_CANONICAL = {
    "GARRAGEM": "Garagem",
    "Q BANHIO": "Q. Banho",
    "Q BANHO": "Q. Banho",
}

# Formato alternativo (tabela nativa do ArchiCAD "Rooms by stories" exportada a PDF): uma
# tabela com colunas Story/Room/R. Height/Perimeter/Wall surf./Measured Area, um compartimento
# por linha, cada valor de coluna na sua própria linha (algumas em branco/omissas). Dá o
# perímetro real de cada compartimento — melhor do que a aproximação por área.
ROOM_SCHEDULE_MARKER = re.compile(r"Rooms by stories", re.IGNORECASE)
AREA_VALUE_LINE = re.compile(r"^([\d.,]+)\s*m[²2]$")
LENGTH_VALUE_LINE = re.compile(r"^([\d.,]+)\s*m$")

# Quadros de vãos variam muito entre gabinetes, mas normalmente conservam três sinais fortes:
# código P/D/J/W/WD/DOO, designação e dimensão largura x altura. A quantidade no fim é opcional.
OPENING_SCHEDULE_PATTERN = re.compile(
    r"(?im)^\s*(?P<code>(?:WD|DOO|P|D|J|W)\s*[-.]?\s*\d{1,3})\s+"
    r"(?P<label>[^\n]{0,90}?)\s+"
    r"(?P<width>\d{1,4}(?:[.,]\d{1,3})?)\s*(?:mm|cm|m)?\s*[x×]\s*"
    r"(?P<height>\d{1,4}(?:[.,]\d{1,3})?)\s*(?:mm|cm|m)?"
    r"(?:\s+(?P<quantity>\d{1,3}))?\s*$"
)
OPENING_CODE_PATTERN = re.compile(
    r"^(?P<prefix>WD|DOO|[PDJW])\s*[-.]?\s*(?P<number>\d{1,3})$",
    re.IGNORECASE,
)
OPENING_MAP_DIM_PATTERN = re.compile(
    r"^(?P<width>\d{1,4}(?:[.,]\d{1,3})?)\s*(?:mm|cm|m)?\s*[x×]\s*(?P<height>\d{1,4}(?:[.,]\d{1,3})?)\s*(?:mm|cm|m)?$",
    re.IGNORECASE,
)
DECIMAL_DIMENSION_PATTERN = re.compile(r"^\d[,.]\d{1,3}$")

# "Ø10: 3.2" — peso de aço por diâmetro, tipicamente dentro de um bloco "Total+10%: ... Total: x"
REBAR_DIAMETER_PATTERN = re.compile(r"Ø(\d+)\s*:\s*([\d.,]+)")

# Rótulos de elementos estruturais que precedem um bloco de aço (pilares, pórticos, vigas,
# escadas, lajes — "Escada" e "Armadura longitudinal inferior/superior" (lajes) tinham ficado
# de fora e o seu aço não entrava no total: ver Ronda 13, onde isto só foi descoberto porque o
# utilizador apontou directamente para as páginas de armadura de cobertura/lajes que faltavam
# — o peso em falta era ~11.258 kg neste ficheiro, mais do que o total já contabilizado.
ELEMENT_LABEL_PATTERN = re.compile(
    r"\b((?:P\d+|PP\d+|Pórtico\s*\d+|Viga\s*\d+|Escada\s*\d+(?:-L[aã]n[çc]o\s*\d+)?|"
    r"Armadura\s+longitudinal\s+(?:inferior|superior))(?:\s*=\s*(?:P\d+|PP\d+))*)\b"
)

# Linha de referências de sapatas/pilares no "QUADRO DE ELEMENTOS DE FUNDAÇÃO"/"QUADRO DE
# PILARES" do CYPE CAD — ex: "P01", "P05 e P18", "P07, P09, P15 e P16", "(P23-P22)",
# "P01=P02=P10=P11" (pilares agrupados por "=").
FOOTING_REF_LINE = re.compile(r"^\(?P\d+(?:\s*(?:,|e|-|=)\s*P\d+)*\)?$", re.IGNORECASE)
COLUMN_LONG_ARM = re.compile(r"Arm\.\s*Long\.?:\s*(.+)$", re.IGNORECASE)
COLUMN_TRANS_ARM = re.compile(r"Armaduras\s+transversais:\s*[ØøΦO]\s*(\d+)", re.IGNORECASE)
COLUMN_HEIGHT_INTERVAL = re.compile(r"0\s*a\s*(\d+)", re.IGNORECASE)
COLUMN_SECTION_DIM = re.compile(r"^(\d{2,3})\s*[x×]\s*(\d{2,3})$", re.IGNORECASE)
COLUMN_DIAMETER = re.compile(r"^[ØøΦ]\s*(\d{2,3})$")
COLUMN_BAR_SPEC = re.compile(r"(\d+)\s*[ØøΦO]\s*(\d{1,2})", re.IGNORECASE)
# Malha do quadro de fundação — ex: "4Ø10a/15", "9Ø12a/12.5", "15Ø12a/15"
FOOTING_MESH_SPEC_LINE = re.compile(
    r"^(?P<count>\d{1,2})\s*[ØøΦ]\s*(?P<diameter>\d{1,2})\s*a\s*/\s*(?P<spacing>\d+(?:[.,]\d+)?)$",
    re.IGNORECASE,
)
DIMENSION_LINE = re.compile(r"^(\d+)\s*x\s*(\d+)$")
NUMBER_LINE = re.compile(r"^\d+(?:[.,]\d+)?$")
DECIMAL_METER_LINE = re.compile(r"^\d+[.,]\d+$")
PORTICO_LABEL_LINE = re.compile(r"^Pórtico\s*(\d+)$")
STAIRCASE_LABEL_LINE = re.compile(r"^Escada\s*(\d+)$")
METER_VALUE = re.compile(r"^([\d.,]+)\s*m$")
INTEGER_VALUE = re.compile(r"^(\d+)$")

# Páginas de pormenor/quadro de fundação: os blocos Total+10% usam rótulos P1/P4=…
# partilhados com pilares, mas o aço é de sapata (ver Fernando pág. 35 — Resumo Aço Fundação).
FOUNDATION_REBAR_PAGE_PATTERN = re.compile(
    r"pormenor\s+de\s+funda[cç][aã]o|"
    r"quadro\s+de\s+elementos\s+de\s+funda[cç][aã]o|"
    r"resumo\s+a[cç]o\s+funda[cç][aã]o|"
    r"resumo\s+a[cç]o\s*\n\s*funda[cç][aã]o|"
    r"a[cç]o\s+funda[cç][aã]o",
    re.IGNORECASE,
)
PILLAR_LIKE_ELEMENT_PATTERN = re.compile(
    r"^(?:P\d+(?:\s*=\s*P\d+)*|PP\d+(?:\s*=\s*PP\d+)*)$",
    re.IGNORECASE,
)

# Folhas de armadura de lajes (piso térreo/intermédio/cobertura): título "ARMADURA
# INFERIOR"/"ARMADURA SUPERIOR" na legenda, e a espessura da laje repetida várias vezes na
# planta como "h=20" (cm) — mesmo valor em toda a folha, uma ocorrência chega.
SLAB_PAGE_TITLE_PATTERN = re.compile(r"ARMADURA\s+(INFERIOR|SUPERIOR)", re.IGNORECASE)
SLAB_THICKNESS_LINE = re.compile(r"^h\s*=\s*(\d+(?:[.,]\d+)?)$", re.IGNORECASE)
SLAB_MESH_SPEC_PATTERN = re.compile(
    r"[ØøΦ]\s*(?P<diameter>\d{1,2})\s*(?:a\s*/\s*|@\s*)(?P<spacing>\d+(?:[.,]\d+)?)",
    re.IGNORECASE,
)
CONCRETE_EUROCODE_PATTERN = re.compile(r"\bC\s*(\d{2})\s*/\s*(\d{2})\b", re.IGNORECASE)
CONCRETE_B_PATTERN = re.compile(
    r"\bBET(?:ÃO|AO)\s*(?:DE\s+CLASSE\s+DE\s+RESISTÊNCIA\s+)?[:=]?\s*"
    r"(B\s*[-/]?\s*(?:15|20|25|30|35|40))\b",
    re.IGNORECASE,
)
STEEL_GRADE_PATTERN = re.compile(r"\b([AS]\s*[-/]?\s*(?:235|240|400|500))\b", re.IGNORECASE)
COVER_PATTERN = re.compile(
    r"\b(?:recobrimento|rec\.?|cobrimento|lajes?)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*(mm|cm)?",
    re.IGNORECASE,
)
# Formato alternativo (planta geral de elementos estruturais, sem folha de armadura própria
# por laje): referência "L1" seguida imediatamente da espessura "h=15".
SLAB_REF_LINE = re.compile(r"^L\d+$")

# Identificação do piso a que uma folha se refere — procurada primeiro no campo "Conteúdo"
# da legenda da folha (ex: "PLANTA COTADA PISO TÉRREO") e, em último recurso, no texto da
# página inteira. A prioridade resolve conflitos quando o mesmo compartimento aparece em mais
# do que uma folha com etiquetas diferentes (ex: um "Anexo" que também aparece na legenda
# combinada da planta do piso térreo) — a etiqueta mais específica vence.
FLOOR_LABEL_PATTERNS: list[tuple[re.Pattern, str | None, int]] = [
    (re.compile(r"anexo", re.IGNORECASE), "Anexo", 3),
    (re.compile(r"cobertura", re.IGNORECASE), "Cobertura", 2),
    (re.compile(r"t[ée]rreo|r[ée]s\s*-?\s*do\s*-?\s*ch[ãa]o|ground\s+floor|piso\s*(?:zero|0)", re.IGNORECASE), "Piso Térreo", 1),
    (re.compile(r"piso\s*superior", re.IGNORECASE), "Piso Superior", 1),
    # Ordinais por extenso (ex: "Segundo Piso" nas folhas de armadura de lajes) — mapeados
    # para o mesmo formato "Nº Piso" usado pelo padrão numérico, para ordenarem em conjunto.
    (re.compile(r"primeiro\s*(?:piso|andar)", re.IGNORECASE), "1º Piso", 1),
    (re.compile(r"segundo\s*(?:piso|andar)", re.IGNORECASE), "2º Piso", 1),
    (re.compile(r"terceiro\s*(?:piso|andar)", re.IGNORECASE), "3º Piso", 1),
    (re.compile(r"(\d+)\s*[ºªo]\s*(?:piso|andar)", re.IGNORECASE), None, 1),  # capturado dinamicamente
]


def detect_floor_label(text: str) -> tuple[str | None, int]:
    for pattern, label, priority in FLOOR_LABEL_PATTERNS:
        match = pattern.search(text)
        if not match:
            continue
        if label is None:
            return f"{match.group(1)}º Piso", priority
        return label, priority
    return None, 0


def detect_document_default_floor(text: str) -> str | None:
    """Infere piso apenas quando o documento declara inequivocamente que a obra tem um só."""
    if re.search(
        r"\b(?:piso\s+[úu]nico|moradia\s+t[ée]rrea|edif[ií]cio\s+t[ée]rreo|"
        r"single[\s-]+stor(?:e)?y|single[\s-]+floor)\b",
        text,
        re.IGNORECASE,
    ):
        return "Piso Térreo"
    return None


def _opening_material(label: str) -> str | None:
    value = _normalise_key(label).lower()
    if "aluminio" in value:
        return "Alumínio"
    if "madeira" in value:
        return "Madeira"
    if "pvc" in value:
        return "PVC"
    if "aco" in value or "metal" in value:
        return "Metálico"
    if "vidro" in value:
        return "Vidro"
    return None


def _opening_location(label: str) -> str:
    value = _normalise_key(label).lower()
    if "exterior" in value or "entrada" in value:
        return "exterior"
    if "interior" in value:
        return "interior"
    return "desconhecida"


def _opening_kind_from_code(code: str, label: str = "") -> str:
    prefix = re.match(r"^([A-Z]+)", code.upper())
    token = prefix.group(1) if prefix else ""
    if token in ("J", "W", "WD") or re.search(r"janela|window", label, re.IGNORECASE):
        return "janela"
    return "porta"


def _normalise_opening_code(raw_code: str) -> str:
    cleaned = re.sub(r"\s+", "", raw_code).replace(".", "-").upper()
    match = re.match(r"^(WD|DOO|[PDJW])-?(\d{1,3})$", cleaned)
    if not match:
        return cleaned
    return f"{match.group(1)}-{match.group(2)}"


def _opening_dimension_to_m(raw_value: str) -> float:
    """Aceita metros, centímetros ou milímetros usados em mapas de vãos."""
    from unit_normalize import parse_length_to_m

    parsed = parse_length_to_m(raw_value)
    if parsed.normalized_m is None:
        return _to_float(raw_value)
    return parsed.normalized_m


def extract_opening_schedule(text: str, page_number: int) -> list[Opening]:
    floor, _ = detect_floor_label(text)
    openings: list[Opening] = []
    for match in OPENING_SCHEDULE_PATTERN.finditer(text):
        raw_code = _normalise_opening_code(match.group("code"))
        label = match.group("label").strip()
        kind = _opening_kind_from_code(raw_code, label)
        width = _opening_dimension_to_m(match.group("width"))
        height = _opening_dimension_to_m(match.group("height"))
        if not (0.3 <= width <= 8 and 0.3 <= height <= 5):
            continue
        openings.append(
            Opening(
                kind=kind,
                code=raw_code,
                width_m=width,
                height_m=height,
                sill_height_m=None,
                quantity=int(match.group("quantity") or 1),
                floor=floor,
                location=_opening_location(label),
                material=_opening_material(label),
                page=page_number,
                confidence=0.96,
                source="quadro",
                needs_confirmation=False,
                designation=label or None,
            )
        )
    openings.extend(extract_opening_map_table(text, page_number, floor))
    return openings


def extract_opening_map_table(text: str, page_number: int, floor: str | None = None) -> list[Opening]:
    """Mapas ArchiCAD/IMOLAR em colunas: Nomeclatura / Quantidade / Largura×Altura."""
    if not re.search(r"nomeclatura|mapa\s+de\s+(?:v[ãa]os|janelas|portas)", text, re.IGNORECASE):
        return []
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    codes: list[str] = []
    quantities: list[int] = []
    dims: list[tuple[float, float]] = []
    mode: str | None = None
    for line in lines:
        lower = line.lower()
        if "nomeclatura" in lower:
            mode = "code"
            continue
        if lower.startswith("quantidade"):
            mode = "qty"
            continue
        if "largura" in lower and "altura" in lower:
            mode = "dim"
            continue
        if lower.startswith("altura da") or lower.startswith("altura do") or lower.startswith("planta") or lower.startswith("al"):
            mode = None
            continue
        if mode == "code":
            code_match = OPENING_CODE_PATTERN.fullmatch(line.replace(" ", "")) or OPENING_CODE_PATTERN.fullmatch(line)
            if not code_match:
                # "WD - 010" with spaces
                spaced = re.fullmatch(r"(WD|DOO|[PDJW])\s*[-.]?\s*(\d{1,3})", line, re.IGNORECASE)
                if not spaced:
                    mode = None
                    continue
                codes.append(_normalise_opening_code(f"{spaced.group(1)}-{spaced.group(2)}"))
            else:
                codes.append(_normalise_opening_code(f"{code_match.group('prefix')}-{code_match.group('number')}"))
        elif mode == "qty":
            if re.fullmatch(r"\d{1,3}", line):
                quantities.append(int(line))
            else:
                mode = None
        elif mode == "dim":
            dim_match = OPENING_MAP_DIM_PATTERN.fullmatch(line)
            if dim_match:
                dims.append((_opening_dimension_to_m(dim_match.group("width")), _opening_dimension_to_m(dim_match.group("height"))))
            else:
                mode = None

    count = min(len(codes), len(dims))
    if count == 0:
        return []
    while len(quantities) < count:
        quantities.append(1)
    openings: list[Opening] = []
    for index in range(count):
        width, height = dims[index]
        if not (0.3 <= width <= 8 and 0.3 <= height <= 8):
            continue
        code = codes[index]
        openings.append(
            Opening(
                kind=_opening_kind_from_code(code),
                code=code,
                width_m=width,
                height_m=height,
                sill_height_m=None,
                quantity=max(1, quantities[index]),
                floor=floor,
                location="desconhecida",
                material=None,
                page=page_number,
                confidence=0.9,
                source="quadro",
                needs_confirmation=True,
            )
        )
    return openings


def extract_openings_spatial(page, page_number: int, text: str) -> list[Opening]:
    """Lê portas por arco de abertura e vãos codificados próximos das dimensões.

    Sem código/quadro, janelas não são inventadas: a geometria de linhas de uma janela é
    indistinguível de vários pormenores CAD. Portas são mais seguras porque o arco de abertura
    é um sinal geométrico específico; mesmo assim ficam para confirmação do utilizador.
    """
    plan_type = detect_plan_type(text)
    if plan_type not in ("cotada", "geral"):
        return []
    floor, _ = detect_floor_label(text)
    words = page.get_text("words")
    scale_values = [
        int(value)
        for value in re.findall(r"\b1\s*:\s*(25|50|75|100|125|150|200)\b", text)
    ]
    drawing_scale = Counter(scale_values).most_common(1)[0][0] if scale_values else None
    metres_per_point = drawing_scale * 25.4 / 72 / 1000 if drawing_scale else None
    dimensions = []
    codes = []
    for word in words:
        value = str(word[4]).strip()
        centre = ((word[0] + word[2]) / 2, (word[1] + word[3]) / 2)
        if DECIMAL_DIMENSION_PATTERN.fullmatch(value):
            dimensions.append((centre, _to_float(value), value))
        code_match = OPENING_CODE_PATTERN.fullmatch(value)
        if code_match:
            codes.append((centre, _normalise_opening_code(f"{code_match.group('prefix')}-{code_match.group('number')}")))

    positioned_lines = _positioned_text_lines(page)
    room_labels: list[tuple[float, float, str]] = []
    for nx0, ny0, nx1, ny1, name_text in positioned_lines:
        identity = _room_identity(name_text)
        if not identity:
            continue
        name_centre = ((nx0 + nx1) / 2, (ny0 + ny1) / 2)
        has_nearby_area = any(
            AREA_ONLY_PATTERN.match(area_text)
            and -2 <= ay0 - ny1 <= 42
            and abs(((ax0 + ax1) / 2) - name_centre[0]) <= max(120.0, (ax1 - ax0) * 1.75)
            for ax0, ay0, ax1, _ay1, area_text in positioned_lines
        )
        if not has_nearby_area:
            continue
        name, number = identity
        room_labels.append((name_centre[0], name_centre[1], f"{name} {number}".strip() if number else name))

    def nearby_code(cx: float, cy: float, kind: str) -> str | None:
        allowed = ("J", "W", "WD") if kind == "janela" else ("P", "D", "DOO")
        candidates = [
            ((x - cx) ** 2 + (y - cy) ** 2, code)
            for (x, y), code in codes
            if any(code.startswith(prefix) for prefix in allowed) and abs(x - cx) <= 55 and abs(y - cy) <= 55
        ]
        return min(candidates)[1] if candidates else None

    def nearby_room_context(cx: float, cy: float) -> tuple[str, str | None]:
        """`location` é só o enum; a sala próxima fica em `designation`."""
        candidates = [
            (((x - cx) ** 2 + (y - cy) ** 2) ** 0.5, label)
            for x, y, label in room_labels
            if abs(x - cx) <= 150 and abs(y - cy) <= 150
        ]
        if not candidates:
            return "desconhecida", None
        distance, label = min(candidates)
        if distance <= 160:
            # Sala próxima ⇒ vão interior; a etiqueta fica em designation para o utilizador.
            return "interior", f"Próximo de {label}"
        return "desconhecida", None

    drawings = page.get_drawings()
    candidates: list[tuple[Opening, tuple[float, float]]] = []
    door_centres: list[tuple[float, float]] = []
    for drawing in drawings:
        for item in drawing["items"]:
            if item[0] != "c":
                continue
            points = item[1:]
            xs = [point.x for point in points]
            ys = [point.y for point in points]
            width_points, height_points = max(xs) - min(xs), max(ys) - min(ys)
            if not (12 <= width_points <= 55 and 12 <= height_points <= 55):
                continue
            cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
            if not (
                page.rect.width * 0.05 < cx < page.rect.width * 0.85
                and page.rect.height * 0.05 < cy < page.rect.height * 0.93
            ):
                continue
            if any((cx - x) ** 2 + (cy - y) ** 2 < 49 for x, y in door_centres):
                continue
            nearby = [
                (value, x, y)
                for (x, y), value, _raw in dimensions
                if min(xs) - 30 <= x <= max(xs) + 30 and min(ys) - 30 <= y <= max(ys) + 30
            ]
            pairs = [
                (abs(x1 - x2) + abs(y1 - y2), w, h)
                for w, x1, y1 in nearby
                for h, x2, y2 in nearby
                if w != h and 0.55 <= w <= 2.2 and 1.8 <= h <= 2.5
            ]
            if pairs:
                _distance, opening_width, opening_height = min(pairs)
                confidence = 0.84
                if metres_per_point:
                    arc_width = max(width_points, height_points) * metres_per_point
                    if 0.55 <= arc_width <= 1.8 and abs(opening_width - arc_width) > max(0.2, arc_width * 0.35):
                        # A cota prÃ³xima pertence provavelmente Ã  parede/compartimento. O arco
                        # mede directamente a folha e Ã© uma evidÃªncia mais local para a largura.
                        opening_width = round(arc_width, 2)
                        confidence = 0.72
            elif metres_per_point:
                # Em muitas plantas ArchiCAD a porta nÃ£o tem largura/altura escrita junto ao
                # arco. O raio do arco, convertido pela escala declarada da folha, fornece a
                # largura aproximada; a altura fica vazia para confirmaÃ§Ã£o em vez de ser
                # inventada a partir de uma cota de parede prÃ³xima.
                opening_width = max(width_points, height_points) * metres_per_point
                if not 0.55 <= opening_width <= 1.8:
                    continue
                opening_width = round(opening_width, 2)
                opening_height = None
                confidence = 0.66
            else:
                continue
            door_centres.append((cx, cy))
            location, designation = nearby_room_context(cx, cy)
            candidates.append((Opening(
                kind="porta",
                code=nearby_code(cx, cy, "porta"),
                width_m=opening_width,
                height_m=opening_height,
                sill_height_m=0,
                quantity=1,
                floor=floor,
                location=location,
                material=None,
                page=page_number,
                confidence=confidence,
                source="geometria",
                needs_confirmation=True,
                designation=designation,
            ), (cx, cy)))

    # Janelas (e portas sem arco) só entram automaticamente quando existe um código inequívoco.
    # Janelas sem código: em muitas plantas ArchiCAD, cada folha de janela é desenhada como
    # 5-9 linhas paralelas, próximas e com os mesmos extremos, inseridas na parede. O detector
    # converte somente a largura demonstrada pela escala; altura e localização ficam pendentes.
    if metres_per_point:
        axis_segments: list[tuple[str, float, float, float]] = []
        for drawing in drawings:
            for item in drawing["items"]:
                if item[0] != "l":
                    continue
                p1, p2 = item[1], item[2]
                dx, dy = abs(p2.x - p1.x), abs(p2.y - p1.y)
                if dy <= 0.35 and 10 <= dx <= 90:
                    axis_segments.append(("h", min(p1.x, p2.x), max(p1.x, p2.x), (p1.y + p2.y) / 2))
                elif dx <= 0.35 and 10 <= dy <= 90:
                    axis_segments.append(("v", min(p1.y, p2.y), max(p1.y, p2.y), (p1.x + p2.x) / 2))

        frame_parts: list[tuple[str, float, float, float]] = []
        consumed: set[int] = set()
        for index, base in enumerate(axis_segments):
            if index in consumed:
                continue
            orientation, start, end, cross = base
            group = [
                (candidate_index, candidate)
                for candidate_index, candidate in enumerate(axis_segments)
                if candidate[0] == orientation
                and abs(candidate[1] - start) <= 2.5
                and abs(candidate[2] - end) <= 2.5
                and abs(candidate[3] - cross) <= 3.5
            ]
            cross_values = [candidate[3] for _, candidate in group]
            if len(group) < 5 or len({round(value, 1) for value in cross_values}) < 3:
                continue
            cross_span = max(cross_values) - min(cross_values)
            if not 0.6 <= cross_span <= 3.5:
                continue
            consumed.update(candidate_index for candidate_index, _candidate in group)
            frame_parts.append((orientation, start, end, sum(cross_values) / len(cross_values)))

        # Uma caixilharia com duas folhas aparece como partes contíguas. Junta-as antes de
        # converter para metros para representar uma janela, não cada folha individual.
        merged_parts: list[tuple[str, float, float, float]] = []
        for part in sorted(frame_parts, key=lambda value: (value[0], value[3], value[1])):
            orientation, start, end, cross = part
            for merged_index, current in enumerate(merged_parts):
                c_orientation, c_start, c_end, c_cross = current
                gap = max(start - c_end, c_start - end, 0)
                if orientation == c_orientation and abs(cross - c_cross) <= 3.5 and gap <= 4:
                    merged_parts[merged_index] = (orientation, min(start, c_start), max(end, c_end), (cross + c_cross) / 2)
                    break
            else:
                merged_parts.append(part)

        for orientation, start, end, cross in merged_parts:
            width_m = round((end - start) * metres_per_point, 2)
            if not 0.45 <= width_m <= 4.5:
                continue
            cx, cy = ((start + end) / 2, cross) if orientation == "h" else (cross, (start + end) / 2)
            if not (
                page.rect.width * 0.08 < cx < page.rect.width * 0.85
                and page.rect.height * 0.12 < cy < page.rect.height * 0.85
            ):
                continue
            if any((cx - x) ** 2 + (cy - y) ** 2 <= 45 ** 2 for x, y in door_centres):
                continue
            location, designation = nearby_room_context(cx, cy)
            candidates.append((Opening(
                kind="janela",
                code=nearby_code(cx, cy, "janela"),
                width_m=width_m,
                height_m=None,
                sill_height_m=None,
                quantity=1,
                floor=floor,
                location=location,
                material=None,
                page=page_number,
                confidence=0.58,
                source="geometria",
                needs_confirmation=True,
                designation=designation,
            ), (cx, cy)))

    for (cx, cy), code in codes:
        kind = "janela" if code.startswith(("J", "W")) else "porta"
        if kind == "porta" and any((cx - x) ** 2 + (cy - y) ** 2 <= 55 ** 2 for x, y in door_centres):
            continue
        nearby = [(value, x, y) for (x, y), value, _raw in dimensions if abs(x - cx) <= 55 and abs(y - cy) <= 55]
        pairs = [
            (abs(x1 - x2) + abs(y1 - y2), w, h)
            for w, x1, y1 in nearby
            for h, x2, y2 in nearby
            if w != h and 0.4 <= w <= 4.5 and 0.4 <= h <= 2.6 and abs(w - 0.2) > 0.01 and abs(h - 0.2) > 0.01
        ]
        if not pairs:
            continue
        _distance, opening_width, opening_height = min(pairs)
        location, designation = nearby_room_context(cx, cy)
        candidates.append((Opening(
            kind=kind,
            code=code,
            width_m=opening_width,
            height_m=opening_height,
            sill_height_m=None if kind == "janela" else 0,
            quantity=1,
            floor=floor,
            location=location,
            material=None,
            page=page_number,
            confidence=0.76,
            source="geometria",
            needs_confirmation=True,
            designation=designation,
        ), (cx, cy)))

    # Alguns gabinetes não usam códigos J01/P01: deixam apenas dois valores juntos do símbolo.
    # Depois de retirar os pares associados a arcos de porta, conservamos os restantes como
    # candidatos de janela/portão. Quando o segundo valor parece uma cota de topo (ex. 2,80),
    # a altura fica deliberadamente vazia para ser confirmada, em vez de assumir 2,80 m.
    for index, ((x1, y1), first, _raw) in enumerate(dimensions):
        for (x2, y2), second, _raw2 in dimensions[index + 1:]:
            gap = ((x1 - x2) ** 2 + (y1 - y2) ** 2) ** 0.5
            if not ((abs(x1 - x2) <= 2.5 or abs(y1 - y2) <= 2.5) and 4 <= gap <= 10):
                continue
            if not (0.45 <= first <= 3.5 and 0.45 <= second <= 3.5):
                continue
            cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
            if not (page.rect.width * 0.08 < cx < page.rect.width * 0.85 and page.rect.height * 0.12 < cy < page.rect.height * 0.85):
                continue
            if any((cx - x) ** 2 + (cy - y) ** 2 <= 45 ** 2 for x, y in door_centres):
                continue
            smaller, larger = sorted((first, second))
            if smaller >= 2.4 and larger >= 3:
                kind, opening_width, opening_height = "porta", larger, smaller
            elif larger >= 2.4:
                kind, opening_width, opening_height = "janela", smaller, None
            else:
                kind, opening_width, opening_height = "janela", larger, smaller
            location, designation = nearby_room_context(cx, cy)
            candidates.append((Opening(
                kind=kind,
                code=None,
                width_m=opening_width,
                height_m=opening_height,
                sill_height_m=None,
                quantity=1,
                floor=floor,
                location=location,
                material=None,
                page=page_number,
                confidence=0.48,
                source="geometria",
                needs_confirmation=True,
                designation=designation,
            ), (cx, cy)))

    # Agrupa ocorrências iguais na mesma prancha sem apagar portas realmente repetidas.
    grouped: dict[tuple, Opening] = {}
    for opening, _centre in candidates:
        key = (
            opening.kind,
            opening.code,
            opening.width_m,
            opening.height_m,
            opening.floor,
            opening.location,
            opening.designation,
            opening.page,
        )
        if key in grouped:
            grouped[key].quantity += 1
        else:
            grouped[key] = opening
    return list(grouped.values())


def merge_openings(openings: list[Opening], document_text: str) -> list[Opening]:
    defaults = {
        "janela": "Alumínio" if re.search(r"janelas?.{0,80}alum[ií]nio", document_text, re.IGNORECASE | re.DOTALL) else None,
        "porta": "Madeira" if re.search(r"portas?.{0,100}madeira", document_text, re.IGNORECASE | re.DOTALL) else None,
    }
    schedule_codes = {opening.code for opening in openings if opening.source == "quadro" and opening.code}
    result: list[Opening] = []
    seen: set[tuple] = set()
    for opening in sorted(openings, key=lambda item: (item.source != "quadro", item.page, item.kind, item.code or "")):
        if opening.source != "quadro" and opening.code in schedule_codes:
            continue
        if opening.material is None:
            opening.material = defaults[opening.kind]
        key = (
            opening.source,
            opening.page,
            opening.kind,
            opening.code,
            opening.width_m,
            opening.height_m,
            opening.floor,
            opening.location,
            opening.designation,
        )
        if key in seen:
            continue
        seen.add(key)
        result.append(opening)
    return result


# Tipo de folha de arquitectura, lido do campo "Conteúdo" da legenda (ex: "PLANTA COTADA PISO
# TÉRREO", "PLANTA MOBILADA PISO SUPERIOR") — um projecto tipicamente tem as duas variantes por
# piso (cotada = com cotas/dimensões; mobilada/mobiliada = com mobiliário desenhado), mostrando a
# MESMA área de compartimento nas duas. Só a "planta cotada" deve entrar na extracção de áreas:
# usar as duas ao mesmo tempo faz o sistema ler a área do mesmo compartimento duas vezes (uma por
# folha), e se a folha mobilada não repetir o número do compartimento (frequente — esse número é
# tipicamente um apontamento da cotagem, não do mobiliário), a de-duplicação por número falha
# silenciosamente a apanhar o duplicado, inflacionando a área total do piso.
PLAN_TYPE_PATTERNS: list[tuple[re.Pattern, str]] = [
    # Folhas de contexto podem conservar no PDF objectos CAD de outras plantas, embora estejam
    # cobertos por uma máscara branca. O conteúdo declarado da folha prevalece sobre o título
    # genérico "Planta de Piso" do carimbo.
    (re.compile(r"imagem\s+(?:de\s+)?sat[eé]lite|ortofoto|google\s+maps?", re.IGNORECASE), "imagem_satelite"),
    (re.compile(r"planta\s+(?:cotada|dimensionada)|dimensioned\s+floor\s+plan", re.IGNORECASE), "cotada"),
    (re.compile(r"planta\s+(?:de\s+)?mob[ií]l(?:ia|iada|ada)|furniture\s+plan", re.IGNORECASE), "mobiliada"),
    # Inclui o erro ortográfico frequente "implatação", encontrado em pranchas reais.
    (re.compile(r"planta\s+(?:de\s+)?implan?ta[çc][ãa]o", re.IGNORECASE), "implantacao"),
    (re.compile(r"planta\s+de\s+localiza[çc][ãa]o", re.IGNORECASE), "localizacao"),
    (re.compile(r"planta\s+(?:de\s+)?funda[çc][ãa]o|foundation\s+plan", re.IGNORECASE), "fundacao"),
    (re.compile(r"planta\s+(?:de\s+)?cobertura|roof\s+plan", re.IGNORECASE), "cobertura"),
    (re.compile(r"\bal[çc]ados?\b|\belevations?\b", re.IGNORECASE), "alcados"),
    (re.compile(r"\bcortes?\b|\bsections?\b", re.IGNORECASE), "cortes"),
    (re.compile(r"planta\s+(?:de\s+)?piso|planta\s+baixa|floor\s+plan", re.IGNORECASE), "geral"),
]


def detect_plan_type(text: str) -> str | None:
    for pattern, label in PLAN_TYPE_PATTERNS:
        if pattern.search(text):
            return label
    return None


# Só se exclui uma folha da extracção de áreas quando o tipo é identificado POSITIVAMENTE como
# não sendo útil para áreas (implantação, cobertura, alçados…). A planta MOBILADA passou a
# ser aceite com prioridade baixa: em muitos gabinetes a cotada só tem medidas lineares e as
# áreas "A: … m²" estão só na mobilada (ex.: projecto Celso Acácio / IMOLAR).
ROOM_EXCLUDED_PLAN_TYPES = {
    "imagem_satelite",
    "implantacao",
    "localizacao",
    "fundacao",
    "cobertura",
    "alcados",
    "cortes",
}

ROOM_PAGE_PRIORITY = {"cotada": 4, "geral": 3, None: 2, "mobiliada": 1}

# Achado real (projecto "Fernando Gore Chaera", Chimoio): folhas de OUTRA especialidade
# (hidráulica, eléctrica, drenagem, estrutura) redesenham as mesmas paredes/compartimentos como
# fundo de contexto para a respectiva instalação (ex: "Conteúdo: ABASTECIMENTO DE ÁGUA", folha
# "HID.1") — o texto da área do compartimento continua lá, igual ao da planta de arquitectura, e
# como esta folha não é "mobilada" nem menciona nenhum piso, escapava ao filtro anterior e
# duplicava a área de todo o piso térreo (confirmado: 12 compartimentos repetidos em 4 folhas
# deste tipo). Estas folhas nunca mencionam o piso a que pertencem (isso só está nas folhas de
# arquitectura) — por isso, quando o tipo não é "cotada" e nenhum piso foi identificado no texto
# da própria folha, uma destas palavras-chave de outra especialidade é suficiente para excluir.
OTHER_SPECIALTY_KEYWORDS = re.compile(
    r"ABASTECIMENTO\s+DE\s+[ÁA]GUA|REDE\s+DE\s+DRENAGEM|DRENAGEM\s+DE\s+[ÁA]GUAS|"
    r"INSTALA[ÇC][ÃA]O\s+EL[ÉE]CTRICA|REDE\s+EL[ÉE]CTRICA|"
    r"ESTRUTURA\s+(?:DE\s+)?(?:FUNDA[ÇC][ÕO]ES?|LAJES?|COBERTURA)|QUADRO\s+DE\s+PILARES|"
    r"REDE\s+DE\s+[ÁA]GUAS?\s+PLUVIAIS|SANEAMENTO",
    re.IGNORECASE,
)


def is_room_area_page(text: str) -> bool:
    plan_type = detect_plan_type(text)
    if plan_type in ROOM_EXCLUDED_PLAN_TYPES:
        return False
    if plan_type == "cotada":
        return True
    floor_label, _ = detect_floor_label(text)
    if floor_label is not None:
        return True
    # Nem "cotada" nem piso identificado: só se exclui se houver um sinal claro de outra
    # especialidade — sem esse sinal, mantém-se o comportamento permissivo de sempre (legendas
    # de outros formatos, projectos de um só piso sem a palavra "cotada").
    return not OTHER_SPECIALTY_KEYWORDS.search(text)


METADATA_LABELS = {
    "proprietario": r"(?im)^\s*Propriet[áa]rio\s*:\s*([^\r\n:]{3,100})\s*$",
    "fase": r"(?im)^\s*Fase\s*:\s*([^\r\n:]{2,80})\s*$",
    "bairro": r"(?im)^\s*Bairro\s*:\s*([^\r\n:]{2,100})\s*$",
    "talhao": r"(?im)^\s*Talh[ãa]o\s*:\s*([^\r\n:]{1,80})\s*$",
    "distrito": r"(?im)^\s*Distrito\s*:\s*([^\r\n:]{2,100})\s*$",
    "especialidade": r"(?im)^\s*Especialidade\s*:\s*([^\r\n:]{2,80})\s*$",
    "conteudo": r"(?im)^\s*Conte[úu]do\s*:\s*([^\r\n:]{2,140})\s*$",
    "numero": r"(?im)^\s*N[uú]mero\s*:\s*([^\r\n:]{1,80})\s*$",
    "escala": r"(?im)^\s*Escala\s*:?\s*([\d:.,/ ]{2,40})\s*$",
}


def _to_float(value: str) -> float:
    return float(value.replace(",", "."))


def _normalise_key(value: str) -> str:
    # Alguns extractores/PDFs devolvem texto UTF-8 interpretado como Latin-1
    # (por exemplo, "alumÃ­nio"). Repara apenas quando há sinais claros de
    # mojibake; se a conversão não for válida, conserva o texto original.
    if "Ã" in value or "Â" in value:
        try:
            value = value.encode("latin-1").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            pass
    decomposed = unicodedata.normalize("NFKD", value)
    ascii_value = "".join(char for char in decomposed if not unicodedata.combining(char))
    return re.sub(r"[^A-Z0-9]+", " ", ascii_value.upper()).strip()


def _room_identity(raw_name: str) -> tuple[str, str | None] | None:
    name = re.sub(r"^[\s•·\-–—]+|[\s:;,.\-–—]+$", "", raw_name)
    name = re.sub(r"\s+", " ", name).strip()
    if not name or len(name) < 2 or len(name) > 80 or not re.search(r"[A-Za-zÀ-ÿ]", name):
        return None
    if ROOM_NAME_REJECT_PATTERN.search(name):
        return None
    if AREA_ONLY_PATTERN.match(name):
        return None
    # Linhas de eixos, cotas, níveis, portas/janelas e referências técnicas não são nomes de
    # compartimento. A lista é estrutural (forma), não uma lista fechada de nomes possíveis.
    if re.fullmatch(r"[A-Z]{0,3}\d+(?:\s*[=\-/]\s*[A-Z]{0,3}\d+)*", name, re.IGNORECASE):
        return None
    if re.search(r"(?:^|\s)[+±-]?\d+[.,]\d+(?:\s*m)?$", name):
        return None

    # "Quarto 2" / "Suite 01": preserva o tipo como nome e o identificador em coluna própria.
    # Não separa anos/números embebidos em nomes longos sem um espaço final inequívoco.
    numbered = re.match(r"^(?P<name>.+?)[\s#-]+(?P<number>\d{1,3})$", name)
    if numbered and re.search(r"[A-Za-zÀ-ÿ]", numbered.group("name")):
        base_name = numbered.group("name").strip()
        return ROOM_NAME_CANONICAL.get(_normalise_key(base_name), base_name), numbered.group("number")
    return ROOM_NAME_CANONICAL.get(_normalise_key(name), name), None


def extract_metadata(text: str) -> PlantMetadata:
    values: dict[str, str | None] = {}
    for field_name, pattern in METADATA_LABELS.items():
        match = re.search(pattern, text)
        values[field_name] = match.group(1).strip() if match else None
    return PlantMetadata(**values)


def extract_rooms(text: str, page_number: int) -> list[Room]:
    # O piso é identificado pelo texto da própria página (tipicamente o campo "Conteúdo" da
    # legenda, ex: "PLANTA COTADA PISO TÉRREO") — procurado no texto inteiro em vez de só no
    # campo isolado, porque o layout exacto da legenda varia por escritório de arquitectura.
    floor_label, _ = detect_floor_label(text)
    rooms = []
    for match in ROOM_PATTERN.finditer(text):
        identity = _room_identity(match.group("name"))
        if not identity:
            continue
        name, number = identity
        area = _to_float(match.group("area"))
        if not 0.1 <= area <= 10_000:
            continue
        rooms.append(Room(name=name, number=number, area_m2=area, page=page_number, floor=floor_label))
    return rooms


def _positioned_text_lines(page, page_dict=None) -> list[tuple[float, float, float, float, str]]:
    lines: list[tuple[float, float, float, float, str]] = []
    page_dict = page_dict if page_dict is not None else page.get_text("dict")
    for block in page_dict.get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            text = "".join(span.get("text", "") for span in line.get("spans", []))
            text = re.sub(r"\s+", " ", text).strip()
            if not text:
                continue
            x0, y0, x1, y1 = line.get("bbox", (0.0, 0.0, 0.0, 0.0))
            lines.append((float(x0), float(y0), float(x1), float(y1), text))
    return lines


def _bbox_has_visible_ink(pixmap, page_rect, bbox: tuple[float, float, float, float], scale: float) -> bool:
    """Confirma que o texto extraído também está visível na página renderizada.

    Alguns ficheiros ArchiCAD conservam etiquetas de compartimentos por baixo de rectângulos
    brancos ou fora da vista publicada. ``get_text`` devolve essas etiquetas, mas o utilizador
    não as vê. A comparação com os pixels elimina esses objectos CAD ocultos.
    """
    x0, y0, x1, y1 = bbox
    left = max(0, int((x0 - page_rect.x0) * scale) - 2)
    top = max(0, int((y0 - page_rect.y0) * scale) - 2)
    right = min(pixmap.width, int((x1 - page_rect.x0) * scale) + 3)
    bottom = min(pixmap.height, int((y1 - page_rect.y0) * scale) + 3)
    if left >= right or top >= bottom:
        return False

    samples = pixmap.samples
    darkest = 255
    lightest = 0
    for row in range(top, bottom):
        start = row * pixmap.stride + left * pixmap.n
        end = row * pixmap.stride + right * pixmap.n
        values = samples[start:end:pixmap.n]
        if values:
            darkest = min(darkest, min(values))
            lightest = max(lightest, max(values))
    return darkest < 253 and lightest - darkest >= 4


def _prefer_dimensioned_view(
    positioned_rooms: list[tuple[Room, float]],
    lines: list[tuple[float, float, float, float, str]],
    page_rect,
) -> list[tuple[Room, float]]:
    """Numa folha com planta geral e cotada lado a lado, usa apenas a vista cotada.

    A decisão usa as legendas visíveis sob cada desenho e a proximidade horizontal. Assim não
    remove duas casas de banho iguais dentro da mesma planta, mas evita contar duas vezes o
    mesmo anexo apresentado em duas vistas na mesma prancha.
    """
    content_right = page_rect.x0 + page_rect.width * 0.90
    general_centres: list[float] = []
    dimensioned_centres: list[float] = []
    for x0, _y0, x1, _y1, text in lines:
        if x1 > content_right:
            continue
        label = _normalise_key(text)
        centre = (x0 + x1) / 2
        if label == "PLANTA DE PISO":
            general_centres.append(centre)
        elif label == "PLANTA COTADA":
            dimensioned_centres.append(centre)

    if not general_centres or not dimensioned_centres:
        return positioned_rooms

    selected: list[tuple[Room, float]] = []
    for room, centre in positioned_rooms:
        distance_to_general = min(abs(centre - item) for item in general_centres)
        distance_to_dimensioned = min(abs(centre - item) for item in dimensioned_centres)
        if distance_to_dimensioned <= distance_to_general:
            selected.append((room, centre))
    return selected


def extract_rooms_spatial(page, page_number: int, text: str | None = None, page_dict=None) -> list[Room]:
    """Associa área e ambiente pela sua posição, independentemente da ordem interna do PDF."""
    floor_label, _ = detect_floor_label(text if text is not None else page.get_text())
    lines = _positioned_text_lines(page, page_dict)
    area_lines = [line for line in lines if AREA_ONLY_PATTERN.match(line[4])]
    if not area_lines:
        return []
    # Uma prancha A1/A0 a 2× produz dezenas de milhões de pixels e era o principal custo do
    # leitor online. A visibilidade das etiquetas precisa de contraste, não de resolução de
    # impressão: limita-se o maior lado a ~2400 px, preservando detalhe nas folhas pequenas.
    longest_side = max(float(page.rect.width), float(page.rect.height), 1.0)
    render_scale = min(1.25, max(0.75, 2400.0 / longest_side))
    rendered_page = page.get_pixmap(
        matrix=fitz.Matrix(render_scale, render_scale),
        colorspace=fitz.csGRAY,
        alpha=False,
    )
    positioned_rooms: list[tuple[Room, float]] = []

    for area_index, (ax0, ay0, ax1, ay1, area_text) in enumerate(lines):
        area_match = AREA_ONLY_PATTERN.match(area_text)
        if not area_match:
            continue
        if not _bbox_has_visible_ink(rendered_page, page.rect, (ax0, ay0, ax1, ay1), render_scale):
            continue
        area = _to_float(area_match.group("area"))
        if not 0.1 <= area <= 10_000:
            continue

        area_centre = (ax0 + ax1) / 2
        candidates: list[tuple[float, tuple[str, str | None], tuple[float, float, float, float]]] = []
        for name_index, (nx0, ny0, nx1, ny1, name_text) in enumerate(lines):
            if name_index == area_index or AREA_ONLY_PATTERN.match(name_text):
                continue
            # Os tags de compartimento habituais colocam o nome imediatamente acima da área.
            vertical_gap = ay0 - ny1
            if vertical_gap < -2 or vertical_gap > 42:
                continue
            name_centre = (nx0 + nx1) / 2
            horizontal_gap = abs(area_centre - name_centre)
            if horizontal_gap > max(120.0, (ax1 - ax0) * 1.75):
                continue
            identity = _room_identity(name_text)
            if not identity:
                continue
            # A distância vertical domina; o alinhamento horizontal desempata. Uma pequena
            # penalização por largura evita escolher uma frase comprida da legenda.
            score = max(vertical_gap, 0) + horizontal_gap * 0.18 + max(len(name_text) - 45, 0)
            candidates.append((score, identity, (nx0, ny0, nx1, ny1)))

        if candidates:
            _, (name, number), name_bbox = min(candidates, key=lambda candidate: candidate[0])
            if not _bbox_has_visible_ink(rendered_page, page.rect, name_bbox, render_scale):
                continue
            tag_centre_y = (name_bbox[1] + ay1) / 2
            perimeter_candidates: list[tuple[float, float]] = []
            for px0, py0, px1, py1, perimeter_text in lines:
                perimeter_match = PERIMETER_ONLY_PATTERN.match(perimeter_text)
                if not perimeter_match:
                    continue
                perimeter = _to_float(perimeter_match.group("perimeter"))
                if not 1 <= perimeter <= 10_000:
                    continue
                px, py = (px0 + px1) / 2, (py0 + py1) / 2
                distance = ((px - area_centre) ** 2 + (py - tag_centre_y) ** 2) ** 0.5
                if distance <= 100:
                    perimeter_candidates.append((distance, perimeter))
            perimeter_m = min(perimeter_candidates)[1] if perimeter_candidates else None
            room = Room(
                name=name,
                number=number,
                area_m2=area,
                page=page_number,
                floor=floor_label,
                perimeter_m=perimeter_m,
            )
            positioned_rooms.append((room, area_centre))

    positioned_rooms = _prefer_dimensioned_view(positioned_rooms, lines, page.rect)
    return [room for room, _centre in positioned_rooms]


def extract_room_list_fallback(text: str, page_number: int) -> list[Room]:
    floor_label, _ = detect_floor_label(text)
    rooms: list[Room] = []
    for match in ROOM_LIST_PATTERN.finditer(text):
        identity = _room_identity(match.group("name"))
        if not identity:
            continue
        name, number = identity
        area = _to_float(match.group("area"))
        if 0.1 <= area <= 10_000:
            rooms.append(Room(name=name, number=number, area_m2=area, page=page_number, floor=floor_label))
    return rooms


def extract_room_schedule(text: str, page_number: int) -> list[Room]:
    if not ROOM_SCHEDULE_MARKER.search(text):
        return []
    lines = [l.strip() for l in text.split("\n")]

    def is_value_line(line: str) -> bool:
        return line == "" or bool(AREA_VALUE_LINE.match(line)) or bool(LENGTH_VALUE_LINE.match(line))

    rooms: list[Room] = []
    current_floor: str | None = None
    i = 0
    while i < len(lines):
        line = lines[i]
        lower = line.lower()
        if not line or lower.startswith("for all stories") or lower.startswith("page"):
            i += 1
            continue
        if lower.startswith("total"):
            # Uma linha de subtotal por piso ("total") vem seguida dos seus próprios valores
            # agregados (perímetro/área) — têm de ser descartados também, senão a próxima
            # iteração lê-os como se fossem o nome e a área de um "compartimento" novo.
            j = i + 1
            while j < len(lines) and is_value_line(lines[j]):
                j += 1
            i = j
            continue

        # Uma linha de texto seguida de OUTRA linha de texto (não um valor) é um cabeçalho de
        # piso ("RÉS - DO CHÃO"); uma linha de texto seguida de um valor é um nome de
        # compartimento — a tabela intercala estes dois tipos de linha sem marcação explícita.
        next_line = lines[i + 1] if i + 1 < len(lines) else ""
        if not is_value_line(next_line):
            floor_label, _ = detect_floor_label(line)
            if floor_label:
                current_floor = floor_label
            i += 1
            continue

        room_name = line
        j = i + 1
        values: list[str] = []
        while j < len(lines) and is_value_line(lines[j]):
            values.append(lines[j])
            j += 1

        area_matches = [AREA_VALUE_LINE.match(v) for v in values]
        area_matches = [m for m in area_matches if m]
        length_matches = [LENGTH_VALUE_LINE.match(v) for v in values]
        length_matches = [m for m in length_matches if m]
        if area_matches:
            # A área medida do compartimento é sempre o último valor "m²" do grupo (a
            # tabela tem "Measured Area" como última coluna); o perímetro é o único valor
            # "m" (sem "²") do grupo, quando presente.
            identity = _room_identity(room_name)
            if not identity:
                i = j
                continue
            name, number = identity
            area = _to_float(area_matches[-1].group(1))
            perimeter = _to_float(length_matches[0].group(1)) if length_matches else None
            if area > 0:
                rooms.append(Room(name=name, number=number, area_m2=area, page=page_number, floor=current_floor, perimeter_m=perimeter))
        i = j
    return rooms


def _room_signature(room: Room) -> tuple[str, str, float]:
    return (_normalise_key(room.name), room.number or "", round(room.area_m2, 2))


def _duplicate_page_map(rooms: list[Room], page_priorities: dict[int, int]) -> dict[int, int]:
    """Agrupa representações equivalentes da mesma planta sem confundir folhas parciais."""
    by_page: dict[int, Counter] = defaultdict(Counter)
    for room in rooms:
        by_page[room.page][_room_signature(room)] += 1

    pages = sorted(by_page)
    parent = {page: page for page in pages}

    def find(page: int) -> int:
        while parent[page] != page:
            parent[page] = parent[parent[page]]
            page = parent[page]
        return page

    def union(left: int, right: int) -> None:
        left_root, right_root = find(left), find(right)
        if left_root != right_root:
            parent[right_root] = left_root

    for index, left in enumerate(pages):
        for right in pages[index + 1 :]:
            left_count, right_count = by_page[left], by_page[right]
            smaller_size = min(sum(left_count.values()), sum(right_count.values()))
            if smaller_size < 3:
                continue
            overlap = sum((left_count & right_count).values())
            # Duas pranchas são equivalentes quando pelo menos 80% da mais pequena coincide.
            # Isso apanha "Planta de Piso" + "Planta Cotada", mas não funde duas zonas parciais
            # do mesmo piso que só partilham ocasionalmente um corredor ou instalação sanitária.
            if overlap / smaller_size >= 0.8:
                union(left, right)

    clusters: dict[int, list[int]] = defaultdict(list)
    for page in pages:
        clusters[find(page)].append(page)

    canonical: dict[int, int] = {}
    for cluster_pages in clusters.values():
        best = max(cluster_pages, key=lambda page: (page_priorities.get(page, 1), len(by_page[page]), page))
        for page in cluster_pages:
            canonical[page] = best
    return canonical


def dedupe_rooms(rooms: list[Room], page_priorities: dict[int, int] | None = None) -> list[Room]:
    if not rooms:
        return []
    priorities = page_priorities or {}
    canonical_page = _duplicate_page_map(rooms, priorities)

    # Se duas páginas equivalentes repetem o mesmo compartimento e apenas a prancha cotada traz
    # o piso, propaga-se essa informação para a cópia de apresentação antes de agrupar. Sem isto,
    # "Sala / piso desconhecido" e "Sala / Piso Térreo" apareciam como dois ambientes distintos.
    known_floors: dict[tuple[int, tuple[str, str, float]], Counter] = defaultdict(Counter)
    for room in rooms:
        if room.floor:
            known_floors[(canonical_page.get(room.page, room.page), _room_signature(room))][room.floor] += 1
    for room in rooms:
        if room.floor is None:
            floor_counts = known_floors.get((canonical_page.get(room.page, room.page), _room_signature(room)))
            if floor_counts:
                room.floor = floor_counts.most_common(1)[0][0]

    # Compartimentos numerados são únicos dentro do piso. Sem número, a área também faz parte da
    # identidade e só se cruza entre páginas que foram reconhecidas como duas representações da
    # mesma planta. Assim, três "W.C" com áreas diferentes continuam a ser três; e até dois W.C
    # realmente iguais na mesma planta são preservados pela contagem máxima por página original.
    groups: dict[tuple, list[Room]] = defaultdict(list)
    for room in rooms:
        floor_key = _normalise_key(room.floor or "")
        if room.number and floor_key:
            # O número não é global nem sequer único por piso em todos os gabinetes: a planta
            # Cyntia contém simultaneamente "Quarto 1" e "Suite 1". Nome/tipo + número é a
            # identidade segura; usar só "1" fundia dois compartimentos reais.
            key = ("numbered", floor_key, _normalise_key(room.name), room.number)
        else:
            key = (
                "positioned",
                canonical_page.get(room.page, room.page),
                floor_key,
                _normalise_key(room.name),
                room.number or "",
                round(room.area_m2, 2),
            )
        groups[key].append(room)

    deduped: list[Room] = []
    for group in groups.values():
        occurrences_by_page: dict[int, list[Room]] = defaultdict(list)
        for room in group:
            occurrences_by_page[room.page].append(room)
        selected_page, selected = max(
            occurrences_by_page.items(),
            key=lambda item: (len(item[1]), priorities.get(item[0], 1), item[0]),
        )
        for occurrence in selected:
            cleanest = min(group, key=lambda room: len(room.name.strip()))
            best_floor = max(group, key=lambda room: detect_floor_label(room.floor or "")[1])
            perimeter = next((room.perimeter_m for room in group if room.perimeter_m is not None), None)
            deduped.append(
                Room(
                    name=re.sub(r"\s+", " ", cleanest.name).strip(),
                    number=occurrence.number,
                    area_m2=occurrence.area_m2,
                    page=selected_page,
                    floor=best_floor.floor or occurrence.floor,
                    perimeter_m=perimeter,
                )
            )
    return sorted(deduped, key=lambda room: ((room.floor or ""), room.page, room.name, room.number or "", room.area_m2))


def merge_page_room_sources(*sources: list[Room]) -> list[Room]:
    """Combina métodos sem duplicar o mesmo tag lido por texto e por coordenadas."""
    merged: list[Room] = []
    known_signatures: set[tuple[str, str, float]] = set()
    for source in sources:
        source_by_signature: dict[tuple[str, str, float], list[Room]] = defaultdict(list)
        for room in source:
            source_by_signature[_room_signature(room)].append(room)
        for signature, candidates in source_by_signature.items():
            if signature in known_signatures:
                continue
            # Mantém todas as ocorrências deste método: duas casas de banho iguais na mesma
            # página são dois compartimentos legítimos, não dois resultados repetidos.
            merged.extend(candidates)
            known_signatures.add(signature)
    return merged


def is_foundation_rebar_page(text: str) -> bool:
    """True nas folhas de pormenor/quadro/resumo de aço de fundação (não planta de implantação)."""
    return bool(FOUNDATION_REBAR_PAGE_PATTERN.search(text or ""))


def _foundation_element_label(label: str | None) -> str | None:
    """Em páginas de fundação, P1/P4=P9 são sapatas — não pilares."""
    if not label:
        return label
    cleaned = label.strip()
    if PILLAR_LIKE_ELEMENT_PATTERN.match(cleaned):
        return f"Sapata {cleaned}"
    return cleaned


def extract_rebar_total_plus10(text: str, page_number: int) -> list[RebarLine]:
    """Nível 1 do aço: blocos clássicos «Total+10%: Ød: kg … Total:»."""
    lines = []
    foundation_page = is_foundation_rebar_page(text)
    element_positions = [(m.start(), m.group(1)) for m in ELEMENT_LABEL_PATTERN.finditer(text)]
    for block_match in re.finditer(r"Total\+10%:.{0,200}?Total:\s*[\d.,]+", text, re.DOTALL):
        block_start = block_match.start()
        current_element = None
        for pos, label in element_positions:
            if pos <= block_start:
                current_element = label
            else:
                break
        if foundation_page:
            current_element = _foundation_element_label(current_element)
        if not current_element:
            continue
        block_text = block_match.group(0)
        for diam_match in REBAR_DIAMETER_PATTERN.finditer(block_text):
            diameter_mm = float(diam_match.group(1))
            weight_kg = _to_float(diam_match.group(2))
            lines.append(RebarLine(element=current_element, diameter_mm=diameter_mm, weight_kg=weight_kg, page=page_number))
    return lines


def extract_rebar_schedules(text: str, page_number: int) -> list[RebarLine]:
    """Compat: Total+10% + Peso+10%. A cascata em parse_pdf separa os níveis."""
    lines = extract_rebar_total_plus10(text, page_number)
    try:
        from rebar_estimate import extract_rebar_peso_plus10_table

        lines.extend(extract_rebar_peso_plus10_table(text, page_number))
    except Exception:
        pass
    return lines


def _parse_footing_mesh_spec(line: str) -> FootingRebarSpec | None:
    match = FOOTING_MESH_SPEC_LINE.match(line.strip())
    if not match:
        return None
    return FootingRebarSpec(
        bar_count=int(match.group("count")),
        diameter_mm=float(match.group("diameter")),
        spacing_cm=_to_float(match.group("spacing")),
    )


def extract_footings(text: str, page_number: int) -> list[Footing]:
    # "QUADRO DE ELEMENTOS DE FUNDAÇÃO" do CYPE CAD: cada sapata (ou grupo de sapatas
    # idênticas) aparece como 3 linhas consecutivas — referências, "LxL" (cm), altura (cm) —
    # seguidas de 2 ou 4 linhas de armadura (inf. X/Y e, se existir, sup. X/Y).
    if "FUNDAÇÃO" not in text.upper() and "FUNDACAO" not in text.upper():
        return []
    lines = [l.strip() for l in text.split("\n")]
    footings = []
    i = 0
    while i < len(lines) - 2:
        ref_line = lines[i]
        if FOOTING_REF_LINE.match(ref_line):
            dim_match = DIMENSION_LINE.match(lines[i + 1])
            height_match = NUMBER_LINE.match(lines[i + 2])
            if dim_match and height_match:
                refs = re.findall(r"P\d+", ref_line, flags=re.IGNORECASE)
                mesh_specs: list[FootingRebarSpec] = []
                j = i + 3
                while j < len(lines) and len(mesh_specs) < 4:
                    if FOOTING_REF_LINE.match(lines[j]) and DIMENSION_LINE.match(lines[j + 1] if j + 1 < len(lines) else ""):
                        break
                    spec = _parse_footing_mesh_spec(lines[j])
                    if spec:
                        mesh_specs.append(spec)
                        j += 1
                        continue
                    # Linhas intercalares (cabeçalhos repetidos, vazios) — saltar sem abortar.
                    if not lines[j] or re.search(r"armadur|refer|dimens|altura", lines[j], re.IGNORECASE):
                        j += 1
                        continue
                    break
                footings.append(
                    Footing(
                        refs=refs,
                        width_cm=float(dim_match.group(1)),
                        length_cm=float(dim_match.group(2)),
                        height_cm=_to_float(lines[i + 2]),
                        page=page_number,
                        bottom_x=mesh_specs[0] if len(mesh_specs) > 0 else None,
                        bottom_y=mesh_specs[1] if len(mesh_specs) > 1 else None,
                        top_x=mesh_specs[2] if len(mesh_specs) > 2 else None,
                        top_y=mesh_specs[3] if len(mesh_specs) > 3 else None,
                    )
                )
                i = j if j > i + 3 else i + 3
                continue
        i += 1
    return footings


def extract_column_groups(text: str, page_number: int) -> list[ColumnGroup]:
    # "QUADRO DE PILARES": nalguns modelos de exportação a lista de referências vem logo a
    # seguir ao título (bloco de legenda curto); noutros (bloco de título mais longo, com
    # muitos mais campos de metadados) só aparece bem mais abaixo na página. Por isso
    # procura-se um bloco contíguo de linhas-referência em qualquer ponto da página — não só
    # imediatamente a seguir ao título — desde que "QUADRO DE PILARES" apareça nessa página.
    if "QUADRO DE PILARES" not in text.upper():
        return []
    lines = [l.strip() for l in text.split("\n") if l.strip()]
    page_floor, _ = detect_floor_label(text)
    starts = [i for i, line in enumerate(lines) if FOOTING_REF_LINE.match(line)]
    groups: list[ColumnGroup] = []
    for pos, start in enumerate(starts):
        end = starts[pos + 1] if pos + 1 < len(starts) else min(len(lines), start + 40)
        block = lines[start:end]
        refs = re.findall(r"P\d+", block[0], flags=re.IGNORECASE)
        if not refs:
            continue
        groups.append(_column_group_from_block(refs, block[1:], page_number, page_floor))
    return groups


def _column_group_from_block(refs: list[str], block: list[str], page_number: int, page_floor: str | None) -> ColumnGroup:
    width_cm = depth_cm = diameter_cm = None
    shape = "rectangular"
    long_count = long_diameter = stirrup_diameter = stirrup_spacing = None
    height_m = None
    block_floor, _ = detect_floor_label("\n".join(block))
    numbers: list[float] = []
    for line in block:
        section = COLUMN_SECTION_DIM.match(line)
        if section:
            width_cm = float(section.group(1))
            depth_cm = float(section.group(2))
            continue
        diameter = COLUMN_DIAMETER.match(line)
        if diameter and width_cm is None:
            diameter_cm = float(diameter.group(1))
            shape = "circular"
            continue
        long_match = COLUMN_LONG_ARM.search(line)
        if long_match:
            parts = COLUMN_BAR_SPEC.findall(long_match.group(1))
            if parts:
                long_count = sum(int(count) for count, _diameter in parts)
                long_diameter = max(float(diameter) for _count, diameter in parts)
            continue
        trans_match = COLUMN_TRANS_ARM.search(line)
        if trans_match:
            stirrup_diameter = float(trans_match.group(1))
            continue
        interval = COLUMN_HEIGHT_INTERVAL.search(line)
        if interval:
            height_m = round(float(interval.group(1)) / 100, 2)
            continue
        if re.fullmatch(r"\d+(?:[.,]\d+)?", line):
            numbers.append(float(line.replace(",", ".")))
    if width_cm is None and diameter_cm is None:
        section_candidates = [value for value in numbers if 12 <= value <= 80]
        if len(section_candidates) >= 2:
            width_cm, depth_cm = section_candidates[0], section_candidates[1]
        elif len(section_candidates) == 1:
            width_cm = depth_cm = section_candidates[0]
    if stirrup_spacing is None:
        spacing_candidates = [value for value in numbers if 8 <= value <= 30]
        if spacing_candidates:
            stirrup_spacing = spacing_candidates[-1]
    confidence = 0.35
    if width_cm and depth_cm:
        confidence += 0.25
    if height_m:
        confidence += 0.2
    if long_count:
        confidence += 0.15
    return ColumnGroup(
        refs=refs,
        page=page_number,
        shape=shape,
        width_cm=width_cm,
        depth_cm=depth_cm,
        diameter_cm=diameter_cm,
        from_floor=block_floor or page_floor,
        to_floor=block_floor or page_floor,
        explicit_height_m=height_m,
        longitudinal_bar_count=long_count,
        longitudinal_diameter_mm=long_diameter,
        stirrup_diameter_mm=stirrup_diameter,
        stirrup_spacing_cm=stirrup_spacing,
        confidence=min(0.95, confidence),
    )


def _floor_sort_key(label: str) -> int:
    floor = label.lower()
    if "cave" in floor or "subsolo" in floor:
        return -10
    if "térreo" in floor or "terreo" in floor or "rés" in floor:
        return 0
    match = re.search(r"(\d+)", floor)
    if match:
        return int(match.group(1))
    if "superior" in floor:
        return 50
    if "anexo" in floor:
        return 80
    if "cobertura" in floor:
        return 90
    return 60


def _dedupe_column_groups(groups: list[ColumnGroup]) -> list[ColumnGroup]:
    best: dict[tuple[str, ...], ColumnGroup] = {}
    for group in groups:
        key = tuple(sorted(ref.upper() for ref in group.refs))
        previous = best.get(key)
        score = (
            (1 if group.width_cm or group.diameter_cm else 0)
            + (1 if group.explicit_height_m else 0)
            + (1 if group.longitudinal_bar_count else 0)
            + group.confidence
        )
        previous_score = 0.0
        if previous:
            previous_score = (
                (1 if previous.width_cm or previous.diameter_cm else 0)
                + (1 if previous.explicit_height_m else 0)
                + (1 if previous.longitudinal_bar_count else 0)
                + previous.confidence
            )
        if previous is None or score >= previous_score:
            best[key] = group
    return list(best.values())


def _rebar_kg_per_m(diameter_mm: float) -> float:
    diameter_m = diameter_mm / 1000
    return (math.pi / 4) * diameter_m * diameter_m * 7850


def _column_height_m(group: ColumnGroup, floors: list[StructuralFloor]) -> float | None:
    if group.explicit_height_m and group.explicit_height_m > 0:
        return group.explicit_height_m
    by_label = {floor.label: floor for floor in floors}
    start = by_label.get(group.from_floor or "")
    end = by_label.get(group.to_floor or "")
    if start and end and start.elevation_m is not None and end.elevation_m is not None:
        delta = abs(end.elevation_m - start.elevation_m)
        return delta if delta > 0 else None
    host = start or end
    if host and host.floor_to_floor_height_m:
        return host.floor_to_floor_height_m
    return None


def _column_concrete_m3(group: ColumnGroup, height_m: float | None) -> float:
    quantity = max(len(group.refs), 1)
    if not height_m or height_m <= 0:
        return 0.0
    if group.shape == "circular" and group.diameter_cm:
        diameter_m = group.diameter_cm / 100
        return round(quantity * math.pi * diameter_m * diameter_m * 0.25 * height_m, 2)
    if group.width_cm and group.depth_cm:
        return round(quantity * (group.width_cm / 100) * (group.depth_cm / 100) * height_m, 2)
    return 0.0


def _column_steel_kg(group: ColumnGroup, height_m: float | None) -> float:
    quantity = max(len(group.refs), 1)
    if not height_m or not group.longitudinal_bar_count or not group.longitudinal_diameter_mm:
        return 0.0
    longitudinal = quantity * group.longitudinal_bar_count * height_m * 1.1 * _rebar_kg_per_m(group.longitudinal_diameter_mm)
    stirrups = 0.0
    spacing_m = (group.stirrup_spacing_cm or 0) / 100
    if group.stirrup_diameter_mm and spacing_m > 0:
        if group.shape == "circular" and group.diameter_cm:
            perimeter_m = math.pi * (group.diameter_cm / 100)
        else:
            perimeter_m = 2 * ((group.width_cm or 0) + (group.depth_cm or 0)) / 100
        if perimeter_m > 0:
            stirrups = quantity * math.ceil(height_m / spacing_m) * perimeter_m * _rebar_kg_per_m(group.stirrup_diameter_mm)
    return round(longitudinal + stirrups, 2)


def _summarise_column_groups(groups: list[ColumnGroup], floors: list[StructuralFloor]) -> list[ColumnGroupSummary]:
    summaries: list[ColumnGroupSummary] = []
    for group in groups:
        height_m = _column_height_m(group, floors)
        concrete = _column_concrete_m3(group, height_m)
        steel = _column_steel_kg(group, height_m)
        summaries.append(
            ColumnGroupSummary(
                code="=".join(group.refs),
                shape=group.shape,
                width_cm=group.width_cm,
                depth_cm=group.depth_cm,
                diameter_cm=group.diameter_cm,
                quantity=len(group.refs),
                from_floor=group.from_floor,
                to_floor=group.to_floor,
                explicit_height_m=group.explicit_height_m or height_m,
                longitudinal_bar_count=group.longitudinal_bar_count,
                longitudinal_diameter_mm=group.longitudinal_diameter_mm,
                stirrup_diameter_mm=group.stirrup_diameter_mm,
                stirrup_spacing_cm=group.stirrup_spacing_cm,
                concrete_volume_m3=concrete,
                steel_weight_kg=steel,
                steel_source="calculated" if steel > 0 else "calculated",
                source_page=group.page,
                confidence=group.confidence,
                needs_confirmation=concrete <= 0 or height_m is None,
            )
        )
    return summaries


def _build_structural_floors(
    rooms: list[Room],
    slabs: list[SlabSummary],
    column_groups: list[ColumnGroup],
    beam_spans: list[BeamSpan],
) -> list[StructuralFloor]:
    labels: list[str] = []
    seen: set[str] = set()

    def add(label: str | None) -> None:
        if not label:
            return
        key = label.strip()
        if not key or key in seen:
            return
        seen.add(key)
        labels.append(key)

    for room in rooms:
        add(room.floor)
    for slab in slabs:
        add(slab.floor)
    for group in column_groups:
        add(group.from_floor)
        add(group.to_floor)
    for span in beam_spans:
        add(span.floor)
    labels.sort(key=_floor_sort_key)
    return [
        StructuralFloor(label=label, sort_order=index, source="plant")
        for index, label in enumerate(labels)
    ]


def extract_beam_spans(text: str, page_number: int) -> list[BeamSpan]:
    # "Desenho de vigas": cada "Pórtico N" é seguido (numa janela próxima) por um bloco de
    # comprimentos em metros (decimais) e, logo a seguir, o mesmo número de secções "LxA"
    # (cm) repetidas — um par comprimento/secção por vão do pórtico.
    lines = [l.strip() for l in text.split("\n")]
    floor, _ = detect_floor_label(text)
    portico_indices = [i for i, l in enumerate(lines) if PORTICO_LABEL_LINE.match(l)]
    spans: list[BeamSpan] = []
    for pos, idx in enumerate(portico_indices):
        line = lines[idx]
        portico_match = PORTICO_LABEL_LINE.match(line)
        portico_name = f"Pórtico {portico_match.group(1)}"
        # Cada pórtico pode ter poucos ou muitos vãos — em vez de uma janela fixa (que corta a
        # meio pórticos com muitos vãos, ex: 8 secções), lê-se até ao próximo rótulo "Pórtico N"
        # (ou ao fim da página), que é o limite real do bloco deste pórtico.
        next_idx = portico_indices[pos + 1] if pos + 1 < len(portico_indices) else len(lines)
        segment = lines[idx + 1 : next_idx]

        section_start = None
        section_run: list[tuple[float, float]] = []
        for k, l in enumerate(segment):
            dim = DIMENSION_LINE.match(l)
            if dim:
                if section_start is None:
                    section_start = k
                section_run.append((float(dim.group(1)), float(dim.group(2))))
            elif section_start is not None:
                break
        if not section_run:
            continue

        lengths: list[float] = []
        k = section_start - 1
        while k >= 0 and DECIMAL_METER_LINE.match(segment[k]):
            lengths.insert(0, _to_float(segment[k]))
            k -= 1
        if len(lengths) != len(section_run):
            # Contagem de comprimentos não bate com o nº de secções encontradas — os dados
            # não são fiáveis o suficiente para associar comprimento a secção, salta este pórtico.
            continue

        for (width, height), length in zip(section_run, lengths):
            spans.append(
                BeamSpan(
                    portico=portico_name,
                    width_cm=width,
                    height_cm=height,
                    length_m=length,
                    page=page_number,
                    floor=floor,
                )
            )
    return spans


def extract_staircases(text: str, page_number: int) -> list[Staircase]:
    # Cada escada tem um bloco "Geometria" limpo e regular: "Escada N" (linha própria),
    # depois pares rótulo/valor — "Largura"/"1.000 m", "Espessura"/"0.15 m", "Nº de
    # degraus"/"18", "Desnível que vence"/"3.32 m" — até à secção "Cargas".
    lines = [l.strip() for l in text.split("\n")]
    staircases = []
    for idx, line in enumerate(lines):
        match = STAIRCASE_LABEL_LINE.match(line)
        if not match:
            continue
        element = f"Escada {match.group(1)}"
        window = lines[idx : idx + 20]
        values: dict[str, str] = {}
        for k, l in enumerate(window):
            if l in ("Largura", "Espessura", "Desnível que vence", "Nº de degraus") and k + 1 < len(window):
                values[l] = window[k + 1]
            if l == "Cargas":
                break

        width_match = METER_VALUE.match(values.get("Largura", ""))
        thickness_match = METER_VALUE.match(values.get("Espessura", ""))
        rise_match = METER_VALUE.match(values.get("Desnível que vence", ""))
        steps_match = INTEGER_VALUE.match(values.get("Nº de degraus", ""))
        if not (width_match and thickness_match and rise_match and steps_match):
            continue

        staircases.append(
            Staircase(
                element=element,
                width_m=_to_float(width_match.group(1)),
                thickness_m=_to_float(thickness_match.group(1)),
                steps_count=int(steps_match.group(1)),
                rise_m=_to_float(rise_match.group(1)),
                page=page_number,
            )
        )
    return staircases


def extract_slab_rebar_layer(text: str) -> SlabRebarLayer | None:
    """Lê a malha predominante da folha sem inventar uma direcção ausente.

    Quando X/Y aparecem explicitamente, cada direcção mantém o seu diâmetro e
    espaçamento. Quando a folha apresenta apenas uma chamada repetida (formato
    corrente em plantas CYPE), a chamada aplica-se às duas direcções.
    """
    directional: dict[str, list[tuple[float, float]]] = {"x": [], "y": []}
    all_specs: list[tuple[float, float]] = []
    for raw_line in text.splitlines():
        matches = list(SLAB_MESH_SPEC_PATTERN.finditer(raw_line))
        for match in matches:
            diameter = float(match.group("diameter"))
            spacing = _to_float(match.group("spacing"))
            if not (4 <= diameter <= 40 and 5 <= spacing <= 40):
                continue
            spec = (diameter, spacing)
            all_specs.append(spec)
            prefix = raw_line[max(0, match.start() - 28):match.start()].lower()
            suffix = raw_line[match.end():match.end() + 18].lower()
            direction_match = re.search(r"(?:direc(?:ção|cao)|dir\.?\s*)?\b([xy])\b", prefix + " " + suffix)
            if direction_match:
                directional[direction_match.group(1)].append(spec)

    if not all_specs:
        return None

    # Sem indicaÃ§Ã£o explÃ­cita X/Y, vÃ¡rios diÃ¢metros representam zonas/posiÃ§Ãµes diferentes,
    # nÃ£o uma malha uniforme. Devolver a chamada dominante seria tecnicamente enganador; os
    # pesos por diÃ¢metro continuam preservados no resumo da laje para compra e orÃ§amento.
    distinct_diameters = {round(diameter, 2) for diameter, _spacing in all_specs}
    has_directional_evidence = bool(directional["x"] or directional["y"])
    if len(distinct_diameters) > 1 and not has_directional_evidence:
        return None

    dominant = Counter((round(d, 2), round(s, 2)) for d, s in all_specs).most_common(1)[0][0]

    def dominant_for(direction: str) -> tuple[float, float]:
        specs = directional[direction]
        return Counter((round(d, 2), round(s, 2)) for d, s in specs).most_common(1)[0][0] if specs else dominant

    x_diameter, x_spacing = dominant_for("x")
    y_diameter, y_spacing = dominant_for("y")
    return SlabRebarLayer(x_diameter, x_spacing, y_diameter, y_spacing)


def extract_structural_material_specs(text: str) -> tuple[str | None, str | None, float | None]:
    eurocode_match = CONCRETE_EUROCODE_PATTERN.search(text)
    concrete_match = CONCRETE_B_PATTERN.search(text)
    steel_match = STEEL_GRADE_PATTERN.search(text)
    cover_match = COVER_PATTERN.search(text)
    if eurocode_match:
        concrete_class = f"C{eurocode_match.group(1)}/{eurocode_match.group(2)}"
    elif concrete_match:
        concrete_class = re.sub(r"[^A-Z0-9]", "", concrete_match.group(1).upper())
    else:
        concrete_class = None
    if steel_match:
        compact_grade = re.sub(r"[^A-Z0-9]", "", steel_match.group(1).upper())
        steel_grade = f"{compact_grade[0]}-{compact_grade[1:]}"
    else:
        steel_grade = None
    cover_cm = None
    if cover_match:
        cover_cm = _to_float(cover_match.group(1))
        if (cover_match.group(2) or "cm").lower() == "mm":
            cover_cm /= 10
    return concrete_class, steel_grade, cover_cm


def extract_slabs(text: str, page_number: int) -> list[Slab]:
    slabs: list[Slab] = []
    floor_label, _ = detect_floor_label(text)
    lines = [l.strip() for l in text.split("\n")]
    concrete_class, steel_grade, cover_cm = extract_structural_material_specs(text)

    # Formato 1 (CYPE CAD): folha dedicada por piso+camada, título "ARMADURA
    # INFERIOR"/"ARMADURA SUPERIOR", espessura "h=20" repetida na planta.
    title_match = SLAB_PAGE_TITLE_PATTERN.search(text)
    if title_match:
        layer = title_match.group(1).lower()
        thicknesses = [_to_float(m.group(1)) for m in (SLAB_THICKNESS_LINE.match(l) for l in lines) if m]
        # Em muitos projectos CYPE, a espessura aparece na planta de elementos
        # (ex.: páginas 41–43) e o mapa de aço inferior/superior vem noutras
        # páginas (ex.: 62–67). A página de aço não pode ser descartada só por
        # não repetir h=; espessura 0 significa "ligar à laje do mesmo piso".
        slabs.append(Slab(
            floor=floor_label,
            layer=layer,
            thickness_cm=thicknesses[0] if thicknesses else 0.0,
            page=page_number,
            rebar=extract_slab_rebar_layer(text),
            concrete_class=concrete_class,
            steel_grade=steel_grade,
            cover_cm=cover_cm,
        ))

    # Formato 2 (planta geral de elementos estruturais, sem folha de armadura própria):
    # referência "L1" seguida imediatamente pela espessura "h=15".
    for idx, line in enumerate(lines):
        if SLAB_REF_LINE.match(line) and idx + 1 < len(lines):
            thickness_match = SLAB_THICKNESS_LINE.match(lines[idx + 1])
            if thickness_match:
                slabs.append(Slab(
                    floor=floor_label,
                    layer="geral",
                    thickness_cm=_to_float(thickness_match.group(1)),
                    page=page_number,
                    concrete_class=concrete_class,
                    steel_grade=steel_grade,
                    cover_cm=cover_cm,
                ))

    return slabs


def _avg(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def summarise_slabs(slabs: list[Slab]) -> list[SlabSummary]:
    """Agrupa desenhos inferior/superior na laje física de cada nível."""
    groups: list[dict] = []
    for slab in sorted(slabs, key=lambda item: (item.floor or "", item.page, item.layer)):
        target = None
        if slab.floor:
            target = next(
                (
                    group
                    for group in groups
                    if group["floor"] == slab.floor
                    and (
                        slab.thickness_cm <= 0
                        or group["thickness_cm"] <= 0
                        or abs(group["thickness_cm"] - slab.thickness_cm) < 0.01
                    )
                ),
                None,
            )
        elif slab.layer == "geral":
            target = next(
                (
                    group
                    for group in groups
                    if group["floor"] is None
                    and group["general_page"] == slab.page
                    and abs(group["thickness_cm"] - slab.thickness_cm) < 0.01
                ),
                None,
            )
        else:
            target = next(
                (
                    group
                    for group in reversed(groups)
                    if group["floor"] is None
                    and group["general_page"] is None
                    and abs(group["thickness_cm"] - slab.thickness_cm) < 0.01
                    and slab.layer not in group["layers"]
                    and abs(max(group["pages"]) - slab.page) <= 1
                ),
                None,
            )
        if target is None:
            target = {
                "floor": slab.floor,
                "thickness_cm": slab.thickness_cm,
                "layers": set(),
                "pages": set(),
                "general_page": slab.page if slab.layer == "geral" else None,
                "top_rebar": None,
                "bottom_rebar": None,
                "concrete_class": slab.concrete_class,
                "steel_grade": slab.steel_grade,
                "cover_cm": slab.cover_cm,
            }
            groups.append(target)
        target["layers"].add(slab.layer)
        target["pages"].add(slab.page)
        if target["thickness_cm"] <= 0 < slab.thickness_cm:
            target["thickness_cm"] = slab.thickness_cm
        if slab.layer == "superior" and slab.rebar:
            target["top_rebar"] = slab.rebar
        elif slab.layer == "inferior" and slab.rebar:
            target["bottom_rebar"] = slab.rebar
        if slab.layer in ("inferior", "superior"):
            # A folha de armadura Ã© mais especÃ­fica do que uma nota global da memÃ³ria.
            target["concrete_class"] = slab.concrete_class or target["concrete_class"]
            target["steel_grade"] = slab.steel_grade or target["steel_grade"]
        else:
            target["concrete_class"] = target["concrete_class"] or slab.concrete_class
            target["steel_grade"] = target["steel_grade"] or slab.steel_grade
        target["cover_cm"] = target["cover_cm"] if target["cover_cm"] is not None else slab.cover_cm

    return [
        SlabSummary(
            floor=group["floor"],
            thickness_cm=group["thickness_cm"],
            layers=sorted(group["layers"]),
            pages=sorted(group["pages"]),
            top_rebar=group["top_rebar"],
            bottom_rebar=group["bottom_rebar"],
            concrete_class=group["concrete_class"],
            steel_grade=group["steel_grade"],
            cover_cm=group["cover_cm"],
        )
        for group in groups
    ]


def build_structural_summary(
    footings: list[Footing],
    column_groups: list[ColumnGroup],
    beam_spans: list[BeamSpan],
    rebar_schedules: list[RebarLine],
    staircases: list[Staircase],
    slabs: list[Slab],
    rooms: list[Room] | None = None,
) -> StructuralSummary | None:
    if not footings and not column_groups and not beam_spans and not rebar_schedules and not staircases and not slabs:
        return None

    # Cada linha do quadro pode representar várias sapatas/pilares idênticos (ex: "P07, P09,
    # P15 e P16") — pesa-se a média pelo nº de referências de cada linha, não pelo nº de linhas.
    footing_refs = {ref for f in footings for ref in f.refs}
    footing_widths = [f.width_cm for f in footings for _ in f.refs]
    footing_lengths = [f.length_cm for f in footings for _ in f.refs]
    footing_depths = [f.height_cm for f in footings for _ in f.refs]

    column_groups = _dedupe_column_groups(column_groups)
    column_refs = {ref for g in column_groups for ref in g.refs}

    # Cada piso numera os seus pórticos a partir de 1 — "Pórtico 1" do Piso 1 e "Pórtico 1" do
    # Piso 2 são vigas físicas diferentes que partilham o mesmo nome, por isso a página entra na
    # chave de unicidade (sem isso, ficheiros com numeração por piso ficavam subcontados).
    beam_porticos = {(b.portico, b.page) for b in beam_spans}
    beam_lengths = [b.length_m for b in beam_spans]
    beam_widths = [b.width_cm for b in beam_spans]
    beam_heights = [b.height_cm for b in beam_spans]
    # Volume real de betão em vigas — comprimento × secção de cada vão, a partir dos dados
    # extraídos (substitui o rácio genérico usado quando não há planta estrutural).
    beams_concrete_volume_m3 = sum(b.length_m * (b.width_cm / 100) * (b.height_cm / 100) for b in beam_spans)

    staircase_elements = {s.element for s in staircases}

    # Cada folha de armadura de laje é uma combinação piso×camada (inferior/superior) — conta-se
    # o nº de folhas distintas, e a espessura (h=X) é igual em todas neste tipo de ficheiro.
    slab_summaries = summarise_slabs(slabs)
    slab_thicknesses = [s.thickness_cm for s in slab_summaries]
    page_layers = {(slab.page, slab.layer) for slab in slabs}
    for summary in slab_summaries:
        by_diameter: dict[str, float] = defaultdict(float)
        for line in rebar_schedules:
            if line.page not in summary.pages:
                continue
            layer = next((name for page, name in page_layers if page == line.page), "geral")
            if layer == "superior":
                summary.top_steel_weight_kg += line.weight_kg
            elif layer == "inferior":
                summary.bottom_steel_weight_kg += line.weight_kg
            by_diameter[f"{line.diameter_mm:g}"] += line.weight_kg
        summary.steel_by_diameter = {diameter: round(weight, 2) for diameter, weight in sorted(by_diameter.items(), key=lambda item: float(item[0]))}

    footings_steel, columns_steel, beams_steel, slabs_steel, stairs_steel, total_steel = _classify_steel_weights(
        rebar_schedules
    )
    # Se o mapa de lajes já acumulou aço por folha, usa-o como preferência para a família lajes.
    slab_map_steel = round(sum(s.top_steel_weight_kg + s.bottom_steel_weight_kg for s in slab_summaries), 2)
    if slab_map_steel > 0:
        slabs_steel = slab_map_steel

    beam_groups = _build_beam_groups(beam_spans, slab_summaries, beams_steel, rebar_schedules)
    floors = _build_structural_floors(rooms or [], slab_summaries, column_groups, beam_spans)
    column_summaries = _summarise_column_groups(column_groups, floors)
    columns_concrete = round(sum(group.concrete_volume_m3 for group in column_summaries), 2)

    return StructuralSummary(
        footings_count=len(footing_refs),
        footings_avg_width_cm=round(_avg(footing_widths), 2),
        footings_avg_length_cm=round(_avg(footing_lengths), 2),
        footings_avg_depth_cm=round(_avg(footing_depths), 2),
        columns_count=len(column_refs),
        columns_concrete_volume_m3=columns_concrete,
        beams_count=len(beam_porticos),
        beams_total_length_m=round(sum(beam_lengths), 2),
        beams_avg_width_cm=round(_avg(beam_widths), 2),
        beams_avg_height_cm=round(_avg(beam_heights), 2),
        beams_concrete_volume_m3=round(beams_concrete_volume_m3, 2),
        staircases_count=len(staircase_elements),
        slabs_count=len(slab_summaries),
        slabs_avg_thickness_cm=round(_avg(slab_thicknesses), 2),
        slabs=slab_summaries,
        # Peso total de aço já com +10% de desperdício, tal como vem calculado nos "Resumo
        # Aço" do projecto — soma de todos os elementos (sapatas, pilares, vigas, escadas,
        # armadura de lajes/cobertura — este último grupo só passou a ser contabilizado
        # depois de "Armadura longitudinal inferior/superior" entrar no ELEMENT_LABEL_PATTERN).
        total_steel_weight_kg=total_steel,
        footings_steel_weight_kg=footings_steel,
        columns_steel_weight_kg=columns_steel,
        beams_steel_weight_kg=beams_steel,
        slabs_steel_weight_kg=slabs_steel,
        stairs_steel_weight_kg=stairs_steel,
        beam_groups=beam_groups,
        column_groups=column_summaries,
        floors=floors,
    )


def _hydro_system_for_text(text: str) -> str:
    normalised = _normalise_key(text)
    if "AGUAS PLUVIAIS" in normalised or "DRENAGEM PLUVIAL" in normalised:
        return "aguas_pluviais"
    if any(token in normalised for token in ("AGUAS RESIDUAIS", "AGUAS NEGRAS", "AGUAS BRANCAS")):
        return "aguas_residuais"
    if "REDE DE INCENDIO" in normalised or "COMBATE A INCENDIO" in normalised:
        return "incendio"
    if "VENTILACAO" in normalised:
        return "ventilacao"
    if any(token in normalised for token in ("ABASTECIMENTO", "REDE DE AGUA", "AGUA FRIA")):
        return "agua_fria"
    if "PISCINA" in normalised:
        return "piscina"
    return "hidrossanitario"


def _hydro_evidence_kind(text: str) -> str:
    normalised = _normalise_key(text)
    if any(token in normalised for token in (
        "ESPECIFICACOES TECNICAS", "MEMORIA DESCRITIVA", "CALCULO", "DIMENSIONAMENTO",
    )):
        return "especificacao"
    if any(token in normalised for token in ("PORMENOR", "DETALHE", "CORTE", "BOMBA DA PISCINA")):
        return "detalhe"
    if any(token in normalised for token in ("ABASTECIMENTO DE AGUA", "DRENAGEM DE AGUAS", "REDE DE", "PISCINA")):
        return "planta"
    return "referencia"


def _drawing_scale(text: str) -> int | None:
    values = [int(value) for value in re.findall(r"\b1\s*:\s*(25|50|75|100|125|150|200|250|500)\b", text)]
    return Counter(values).most_common(1)[0][0] if values else None


def _pipe_colour_family(colour: tuple[float, float, float] | None) -> str | None:
    if not colour:
        return None
    red, green, blue = colour
    if red >= 0.75 and red >= green * 1.8 and red >= blue * 1.8:
        return "red"
    if blue >= 0.48 and blue >= red * 2.0 and blue >= green * 1.45:
        return "blue"
    return None


def _vector_pipe_colour_family(colour: tuple[float, float, float] | None) -> str | None:
    family = _pipe_colour_family(colour)
    if family == "blue" and colour and colour[2] < 0.75:
        return None
    return family


def _colour_from_int(value: int) -> tuple[float, float, float]:
    return (((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255)


def _diameter_from_coloured_label(raw: str, system: str) -> tuple[float | None, str | None]:
    fraction = re.search(r"Ø\s*((?:\d+\s+)?\d+\s*/\s*\d+|[½¾¼⅜⅝])", raw, re.IGNORECASE)
    if fraction:
        return None, re.sub(r"\s+", "", fraction.group(1))
    numeric = re.search(r"Ø\s*(\d+(?:[.,]\d+)?)", raw, re.IGNORECASE)
    if not numeric:
        return None, None
    value = float(numeric.group(1).replace(",", "."))
    # Alguns desenhos CAD escrevem Ø0.75 para a rede de 75 mm. Só normalizamos este caso
    # quando a própria prancha é de drenagem e não existe símbolo de polegadas.
    if system == "aguas_residuais" and 0 < value < 2:
        value *= 100
    return value, None


def _coloured_pipe_labels(page, system: str) -> dict[str, tuple[float | None, str | None, str | None]]:
    candidates: dict[str, list[tuple[float | None, str | None, str | None]]] = defaultdict(list)
    for block in page.get_text("dict").get("blocks", []):
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                raw = str(span.get("text") or "")
                if "Ø" not in raw:
                    continue
                family = _pipe_colour_family(_colour_from_int(int(span.get("color") or 0)))
                if not family:
                    continue
                diameter_mm, diameter_inch = _diameter_from_coloured_label(raw, system)
                if diameter_mm is None and diameter_inch is None:
                    continue
                material = next((item for item in ("HDPE", "PEAD", "UPVC", "PVC", "PPR") if item in raw.upper()), None)
                candidates[family].append((diameter_mm, diameter_inch, material))
    return {
        family: Counter(values).most_common(1)[0][0]
        for family, values in candidates.items()
        if values
    }


def _line_length(item) -> float:
    if not item or item[0] != "l":
        return 0.0
    p1, p2 = item[1], item[2]
    return ((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2) ** 0.5


def _vector_length_by_colour(page) -> dict[str, tuple[float, str]]:
    stroke_groups: dict[tuple[str, float], float] = defaultdict(float)
    filled_lengths: dict[str, float] = defaultdict(float)
    for drawing in page.get_drawings():
        stroke = drawing.get("color")
        stroke_family = _vector_pipe_colour_family(tuple(float(value) for value in stroke) if stroke else None)
        width = round(float(drawing.get("width") or 0), 3)
        if stroke_family and drawing.get("type") == "s" and 0.35 <= width <= 0.9:
            for item in drawing.get("items", []):
                length = _line_length(item)
                if length >= 5:
                    stroke_groups[(stroke_family, width)] += length

        fill = drawing.get("fill")
        fill_family = _vector_pipe_colour_family(tuple(float(value) for value in fill) if fill else None)
        if not fill_family or drawing.get("type") != "f":
            continue
        rect = drawing.get("rect")
        if not rect:
            continue
        long_side = max(float(rect.width), float(rect.height))
        short_side = min(float(rect.width), float(rect.height))
        if long_side < 3 or short_side > 3.5 or long_side / max(short_side, 0.01) < 3:
            continue
        edge_length = max((_line_length(item) for item in drawing.get("items", [])), default=0.0)
        filled_lengths[fill_family] += max(edge_length, long_side)

    measured: dict[str, tuple[float, str]] = {}
    families = {family for family, _width in stroke_groups} | set(filled_lengths)
    for family in families:
        stroke_candidates = [
            (length, "vector_stroke")
            for (candidate_family, _width), length in stroke_groups.items()
            if candidate_family == family
        ]
        fill_candidate = (filled_lengths.get(family, 0.0), "vector_fill")
        length, basis = max(stroke_candidates + [fill_candidate], key=lambda item: item[0])
        if length >= 10:
            measured[family] = (length, basis)
    return measured


def _eligible_vector_segments(page) -> dict[str, tuple[list[tuple[tuple[float, float], tuple[float, float]]], str]]:
    stroke_groups: dict[tuple[str, float], list[tuple[tuple[float, float], tuple[float, float]]]] = defaultdict(list)
    fill_groups: dict[str, list[tuple[tuple[float, float], tuple[float, float]]]] = defaultdict(list)
    for drawing in page.get_drawings():
        stroke = drawing.get("color")
        family = _vector_pipe_colour_family(tuple(float(value) for value in stroke) if stroke else None)
        width = round(float(drawing.get("width") or 0), 3)
        if family and drawing.get("type") == "s" and 0.35 <= width <= 0.9:
            for item in drawing.get("items", []):
                if _line_length(item) < 5:
                    continue
                p1, p2 = item[1], item[2]
                stroke_groups[(family, width)].append(((p1.x, p1.y), (p2.x, p2.y)))

        fill = drawing.get("fill")
        family = _vector_pipe_colour_family(tuple(float(value) for value in fill) if fill else None)
        rect = drawing.get("rect")
        if not family or drawing.get("type") != "f" or not rect:
            continue
        long_side = max(float(rect.width), float(rect.height))
        short_side = min(float(rect.width), float(rect.height))
        if long_side < 3 or short_side > 3.5 or long_side / max(short_side, 0.01) < 3:
            continue
        edges = [item for item in drawing.get("items", []) if item[0] == "l"]
        longest = max(edges, key=_line_length, default=None)
        if not longest:
            continue
        p1, p2 = longest[1], longest[2]
        # O eixo está a meia espessura do polígono; para topologia a pequena translação é
        # irrelevante porque os extremos são agrupados com tolerância.
        fill_groups[family].append(((p1.x, p1.y), (p2.x, p2.y)))

    result: dict[str, tuple[list[tuple[tuple[float, float], tuple[float, float]]], str]] = {}
    families = {family for family, _width in stroke_groups} | set(fill_groups)
    for family in families:
        stroke_options = [
            (segments, "vector_stroke")
            for (candidate, _width), segments in stroke_groups.items()
            if candidate == family
        ]
        fill_option = (fill_groups.get(family, []), "vector_fill")
        segments, basis = max(
            stroke_options + [fill_option],
            key=lambda option: sum(((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2) ** 0.5 for a, b in option[0]),
        )
        if segments:
            result[family] = (segments, basis)
    return result


def _network_topology_counts(segments: list[tuple[tuple[float, float], tuple[float, float]]]) -> dict[str, int]:
    nodes: list[tuple[float, float]] = []
    adjacency: dict[int, list[int]] = defaultdict(list)

    def node_for(point: tuple[float, float]) -> int:
        for index, candidate in enumerate(nodes):
            if ((candidate[0] - point[0]) ** 2 + (candidate[1] - point[1]) ** 2) ** 0.5 <= 3.5:
                return index
        nodes.append(point)
        return len(nodes) - 1

    for start, end in segments:
        a, b = node_for(start), node_for(end)
        if a == b:
            continue
        adjacency[a].append(b)
        adjacency[b].append(a)

    result = {"terminal": 0, "curva": 0, "te": 0, "juncao": 0}
    for node, neighbours in adjacency.items():
        unique = list(dict.fromkeys(neighbours))
        degree = len(unique)
        if degree == 1:
            result["terminal"] += 1
        elif degree == 2:
            origin = nodes[node]
            vectors = [(nodes[other][0] - origin[0], nodes[other][1] - origin[1]) for other in unique]
            lengths = [max((x * x + y * y) ** 0.5, 0.001) for x, y in vectors]
            cosine = (vectors[0][0] * vectors[1][0] + vectors[0][1] * vectors[1][1]) / (lengths[0] * lengths[1])
            if cosine > -0.985:
                result["curva"] += 1
        elif degree == 3:
            result["te"] += 1
        elif degree >= 4:
            result["juncao"] += 1
    return result


def extract_hydro_vector_accessories(page, text: str, page_number: int) -> list[HydroEquipmentEvidence]:
    evidence_kind = _hydro_evidence_kind(text)
    system = _hydro_system_for_text(text)
    if evidence_kind != "planta" or system not in {"agua_fria", "aguas_residuais", "aguas_pluviais"} or not _drawing_scale(text):
        return []
    labels = _coloured_pipe_labels(page, system)
    equipment: list[HydroEquipmentEvidence] = []
    for family, (segments, basis) in _eligible_vector_segments(page).items():
        # Os polígonos de drenagem medem bem o comprimento, mas os seus extremos ficam
        # deslocados pela espessura e ainda não formam uma topologia segura para acessórios.
        if basis != "vector_stroke":
            continue
        diameter_mm, diameter_inch, _material = labels.get(family, (None, None, None))
        suffix = f"_{int(diameter_mm)}mm" if diameter_mm is not None else f"_{diameter_inch}pol" if diameter_inch else ""
        for kind, quantity in _network_topology_counts(segments).items():
            if quantity <= 0:
                continue
            equipment.append(HydroEquipmentEvidence(
                kind=f"{kind}{suffix}",
                page=page_number,
                occurrences=quantity,
                evidence_kind="planta",
                confidence=0.68,
                quantity=quantity,
                code=None,
                floor=None,
                source="vector_topology",
                requires_confirmation=True,
            ))
    return equipment


def extract_hydro_coded_equipment(page, text: str, page_number: int) -> list[HydroEquipmentEvidence]:
    normalised = _normalise_key(text)
    evidence_kind = _hydro_evidence_kind(text)
    if evidence_kind != "planta" and "PISCINA" not in normalised:
        return []
    equipment: list[HydroEquipmentEvidence] = []
    if "ABASTECIMENTO DE AGUA" in normalised:
        for code in sorted(set(re.findall(r"\bB\d{2}\b", text, re.IGNORECASE))):
            equipment.append(HydroEquipmentEvidence(
                kind="ponto_abastecimento", page=page_number, occurrences=1, evidence_kind="planta",
                confidence=0.9, quantity=1, code=code.upper(), source="codigo_planta", requires_confirmation=False,
            ))
        for code in sorted(set(re.findall(r"\bP\d{2}\b", text, re.IGNORECASE))):
            equipment.append(HydroEquipmentEvidence(
                kind="ligacao_principal", page=page_number, occurrences=1, evidence_kind="planta",
                confidence=0.86, quantity=1, code=code.upper(), source="codigo_planta", requires_confirmation=False,
            ))

    if "PISCINA" in normalised and "TABELA DE SELECCAO" in normalised:
        component_names = {
            "1": "filtro_piscina", "2": "bomba_piscina", "3": "valvula_selectora",
            "4": "skimmer", "5": "regulador_nivel", "6": "boca_impulsao",
            "7": "aspirador_piscina", "8": "escada_piscina", "9": "quadro_piscina",
        }
        counts: Counter[str] = Counter()
        for block in page.get_text("dict").get("blocks", []):
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    value = str(span.get("text") or "").strip()
                    if value not in component_names or not 5.5 <= float(span.get("size") or 0) <= 9.5:
                        continue
                    x0, y0, x1, y1 = span.get("bbox")
                    if page.rect.width * 0.15 <= (x0 + x1) / 2 <= page.rect.width * 0.75 and page.rect.height * 0.15 <= (y0 + y1) / 2 <= page.rect.height * 0.68:
                        counts[value] += 1
        for code, quantity in counts.items():
            equipment.append(HydroEquipmentEvidence(
                kind=component_names[code], page=page_number, occurrences=quantity, evidence_kind="planta",
                confidence=0.9, quantity=quantity, code=code, source="simbolo_numerado", requires_confirmation=False,
            ))

    if "AGUAS RESIDUAIS" in normalised:
        boxes = 0
        for drawing in page.get_drawings():
            fill = drawing.get("fill")
            rect = drawing.get("rect")
            if not fill or not rect or max(float(value) for value in fill) > 0.08:
                continue
            if 8.5 <= rect.width <= 11 and 8.5 <= rect.height <= 11:
                boxes += 1
        if boxes:
            equipment.append(HydroEquipmentEvidence(
                kind="caixa_drenagem", page=page_number, occurrences=boxes, evidence_kind="planta",
                confidence=0.72, quantity=boxes, source="simbolo_geometrico", requires_confirmation=True,
            ))
    return equipment


def extract_hydro_vector_measurements(page, text: str, page_number: int) -> list[HydroPipeEvidence]:
    """Mede apenas redes CAD coloridas, com escala declarada e geometria inequívoca."""
    evidence_kind = _hydro_evidence_kind(text)
    system = _hydro_system_for_text(text)
    scale = _drawing_scale(text)
    if evidence_kind != "planta" or system not in {"agua_fria", "aguas_residuais", "aguas_pluviais"} or not scale:
        return []
    labels = _coloured_pipe_labels(page, system)
    vectors = _vector_length_by_colour(page)
    metres_per_point = scale * 25.4 / 72 / 1000
    results: list[HydroPipeEvidence] = []
    for family, (length_points, basis) in vectors.items():
        diameter_mm, diameter_inch, material = labels.get(family, (None, None, None))
        measured_system = system
        if system == "agua_fria" and family == "red":
            measured_system = "agua_quente"
        results.append(HydroPipeEvidence(
            system=measured_system,
            material=material,
            diameter_mm=diameter_mm,
            diameter_inch=diameter_inch,
            page=page_number,
            occurrences=1,
            evidence_kind="planta",
            measured_length_m=round(length_points * metres_per_point, 2),
            confidence=0.84 if labels.get(family) else 0.74,
            floor=None,
            measurement_basis=basis,
            trace_colour=family,
        ))
    return results


def _infer_hydro_floor(text: str, rooms: list[Room]) -> str | None:
    explicit, _priority = detect_floor_label(text)
    if explicit:
        room_floors = {room.floor for room in rooms if room.floor}
        if explicit == "1º Piso" and "Piso Superior" in room_floors and "1º Piso" not in room_floors:
            return "Piso Superior"
        return explicit
    normalised = f" {_normalise_key(text)} "
    labels_by_floor: dict[str, set[str]] = defaultdict(set)
    for room in rooms:
        if not room.floor:
            continue
        name = _normalise_key(room.name)
        if room.number:
            labels_by_floor[room.floor].add(f"{name} {_normalise_key(room.number)}")
        elif len(name) >= 6:
            labels_by_floor[room.floor].add(name)
    scores = {
        floor: sum(1 for label in labels if f" {label} " in normalised)
        for floor, labels in labels_by_floor.items()
    }
    ranked = sorted(scores.items(), key=lambda item: item[1], reverse=True)
    if not ranked or ranked[0][1] < 2:
        return None
    if len(ranked) > 1 and ranked[0][1] <= ranked[1][1] + 1:
        return None
    return ranked[0][0]


def extract_hydrosanitary_summary(
    document_analysis: DocumentAnalysis,
    page_texts: list[str],
    vector_measurements: list[HydroPipeEvidence] | None = None,
    equipment_measurements: list[HydroEquipmentEvidence] | None = None,
    rooms: list[Room] | None = None,
) -> HydrosanitarySummary | None:
    """Extrai evidência hidrossanitária sem converter rótulos em comprimentos de obra."""
    hydro_pages = sorted({
        page
        for section in document_analysis.sections
        if section.discipline == "hidrossanitario"
        for page in range(section.start_page, section.end_page + 1)
    })
    if not hydro_pages:
        return None

    grouped_pipes: dict[tuple[str, str | None, float | None, str | None, int, str], int] = defaultdict(int)
    equipment: list[HydroEquipmentEvidence] = []
    systems: set[str] = set()
    septic_tank_detected = False
    pool_detected = False
    materials = ("HDPE", "PEAD", "UPVC", "PVC", "PPR")

    for page_number in hydro_pages:
        if not 1 <= page_number <= len(page_texts):
            continue
        text = page_texts[page_number - 1]
        if not text.strip():
            continue
        system = _hydro_system_for_text(text)
        evidence_kind = _hydro_evidence_kind(text)
        if evidence_kind in {"planta", "detalhe"} and system != "hidrossanitario":
            systems.add(system)
        confidence = 0.88 if evidence_kind == "planta" else 0.72 if evidence_kind == "detalhe" else 0.58

        for line in (raw.strip() for raw in text.splitlines()):
            if not line or "@" in line:
                continue
            upper = line.upper()
            material = next((item for item in materials if item in upper), None)
            for match in re.finditer(r"Ø\s*((?:\d+\s+)?\d+\s*/\s*\d+|[½¾¼⅜⅝])\s*[\"”]?", line, re.IGNORECASE):
                diameter = re.sub(r"\s+", "", match.group(1))
                grouped_pipes[(system, material, None, diameter, page_number, evidence_kind)] += 1
            for match in re.finditer(r"Ø\s*(\d+(?:[.,]\d+)?)\s*[\"”]", line, re.IGNORECASE):
                diameter = match.group(1).replace(",", ".")
                grouped_pipes[(system, material, None, diameter, page_number, evidence_kind)] += 1
            for match in re.finditer(r"Ø\s*(\d{2,3})(?:\s*mm)?", line, re.IGNORECASE):
                suffix = line[match.end():match.end() + 3]
                has_mm = bool(re.search(r"mm", match.group(0), re.IGNORECASE))
                if '"' in suffix or "”" in suffix or not (has_mm or material or "I=" in upper):
                    continue
                grouped_pipes[(system, material, float(match.group(1)), None, page_number, evidence_kind)] += 1

        # Menções em memórias e catálogos são especificações, não contagens de equipamentos.
        if evidence_kind not in {"planta", "detalhe"}:
            continue
        normalised = _normalise_key(text)
        equipment_patterns = (
            ("deposito", r"\b(?:DEPOSITO|RESERVATORIO)\b"),
            ("fossa_septica", r"\bFOSSA\s+SEPTICA\b"),
            ("piscina", r"\bPISCINA\b"),
            ("bomba", r"\bBOMBA(?:GEM|S)?\b"),
            ("contador", r"\bCONTADOR\b"),
            ("caixa_inspeccao", r"\bCAIXA\s+(?:DE\s+INSPECCAO|NORMALIZADA)\b"),
            ("ralo", r"\bGULLY\b|\bRALO\b"),
        )
        for kind, pattern in equipment_patterns:
            occurrences = len(re.findall(pattern, normalised))
            if not occurrences:
                continue
            capacity_l = None
            if kind == "deposito":
                capacity_match = re.search(r"(?:DEPOSITO|RESERVATORIO).{0,50}?(\d{3,5})\s*L\b", normalised, re.DOTALL)
                if capacity_match:
                    capacity_l = float(capacity_match.group(1))
            confirmed_label = evidence_kind == "planta" and occurrences == 1 and kind in {"deposito", "contador", "fossa_septica"}
            equipment.append(HydroEquipmentEvidence(
                kind=kind,
                page=page_number,
                occurrences=occurrences,
                evidence_kind=evidence_kind,
                capacity_l=capacity_l,
                confidence=confidence,
                quantity=1 if confirmed_label else None,
                floor=_infer_hydro_floor(text, rooms or []),
                source="etiqueta_explicita",
                requires_confirmation=not confirmed_label,
            ))
            septic_tank_detected = septic_tank_detected or kind == "fossa_septica"
            pool_detected = pool_detected or kind == "piscina"

    pipes = [
        HydroPipeEvidence(
            system=key[0],
            material=key[1],
            diameter_mm=key[2],
            diameter_inch=key[3],
            page=key[4],
            occurrences=count,
            evidence_kind=key[5],
            measured_length_m=None,
            confidence=0.88 if key[5] == "planta" else 0.72 if key[5] == "detalhe" else 0.58,
            floor=_infer_hydro_floor(page_texts[key[4] - 1], rooms or []),
            measurement_basis=None,
        )
        for key, count in sorted(grouped_pipes.items(), key=lambda item: (item[0][4], item[0][0], item[0][2] or 0, item[0][3] or ""))
    ]
    known_vector_specs: dict[tuple[str, str], list[HydroPipeEvidence]] = defaultdict(list)
    for measurement in vector_measurements or []:
        if measurement.trace_colour and (measurement.diameter_mm is not None or measurement.diameter_inch is not None):
            known_vector_specs[(measurement.system, measurement.trace_colour)].append(measurement)
    for measurement in vector_measurements or []:
        if measurement.page in hydro_pages:
            if measurement.trace_colour and measurement.diameter_mm is None and measurement.diameter_inch is None:
                neighbours = known_vector_specs.get((measurement.system, measurement.trace_colour), [])
                nearest = min(neighbours, key=lambda item: abs(item.page - measurement.page), default=None)
                if nearest and abs(nearest.page - measurement.page) <= 2:
                    measurement.diameter_mm = nearest.diameter_mm
                    measurement.diameter_inch = nearest.diameter_inch
                    measurement.material = nearest.material
                    measurement.confidence = min(measurement.confidence, 0.78)
            measurement.floor = measurement.floor or _infer_hydro_floor(
                page_texts[measurement.page - 1], rooms or []
            )
            pipes.append(measurement)
            systems.add(measurement.system)
    for item in equipment_measurements or []:
        if item.page not in hydro_pages:
            continue
        item.floor = item.floor or _infer_hydro_floor(page_texts[item.page - 1], rooms or [])
        equipment.append(item)
    has_vector_lengths = any(pipe.measured_length_m is not None for pipe in pipes)
    return HydrosanitarySummary(
        systems=sorted(systems),
        pipes=pipes,
        equipment=equipment,
        septic_tank_detected=septic_tank_detected,
        pool_detected=pool_detected,
        quantitative_coverage="vector_partial" if has_vector_lengths else "partial" if any(pipe.evidence_kind == "planta" for pipe in pipes) else "evidence_only",
        requires_confirmation=True,
    )


def build_technical_quality_issues(
    document_analysis: DocumentAnalysis,
    rooms: list[Room],
    openings: list[Opening],
    structural_summary: StructuralSummary | None,
) -> list[TechnicalQualityIssue]:
    """Expõe limites reais da leitura sem transformar inferências em medições."""
    disciplines = {section.discipline for section in document_analysis.sections}
    pages_by_discipline = {
        discipline: sorted({page for section in document_analysis.sections if section.discipline == discipline for page in range(section.start_page, section.end_page + 1)})
        for discipline in disciplines
    }
    issues: list[TechnicalQualityIssue] = []

    def add(code: str, severity: str, scope: str, message: str, pages: list[int] | None = None, confirm: bool = False):
        issues.append(TechnicalQualityIssue(code, severity, scope, message, pages or [], confirm))

    if "arquitectura" in disciplines:
        architecture_pages = pages_by_discipline.get("arquitectura", [])
        if not rooms:
            add("architecture.rooms_missing", "critical", "arquitectura", "Não foram identificados compartimentos e áreas.", architecture_pages, True)
        else:
            missing_perimeters = sum(room.perimeter_m is None or room.perimeter_m <= 0 for room in rooms)
            if missing_perimeters:
                add(
                    "architecture.room_perimeters_missing",
                    "warning",
                    "arquitectura",
                    f"{missing_perimeters} compartimento(s) não têm perímetro confirmado; paredes e revestimentos não devem ser fechados automaticamente.",
                    sorted({room.page for room in rooms if room.perimeter_m is None or room.perimeter_m <= 0}),
                    True,
                )

        doors = [opening for opening in openings if opening.kind == "porta"]
        windows = [opening for opening in openings if opening.kind == "janela"]
        if not doors:
            add("architecture.doors_missing", "critical", "aberturas", "Nenhuma porta foi identificada.", architecture_pages, True)
        if not windows:
            add("architecture.windows_missing", "critical", "aberturas", "Nenhuma janela foi identificada.", architecture_pages, True)

        incomplete = [
            opening for opening in openings
            if opening.needs_confirmation or not opening.width_m or not opening.height_m or opening.location == "desconhecida"
        ]
        if incomplete:
            add(
                "architecture.openings_incomplete",
                "critical",
                "aberturas",
                f"{sum(max(opening.quantity, 1) for opening in incomplete)} vão(s) não têm dimensão e localização totalmente confirmadas.",
                sorted({opening.page for opening in incomplete}),
                True,
            )

    if "estrutura" in disciplines:
        structure_pages = pages_by_discipline.get("estrutura", [])
        if not structural_summary:
            add("structure.summary_missing", "critical", "estrutura", "Não foi possível formar o resumo estrutural.", structure_pages, True)
        else:
            missing_families = [
                label for label, count in (
                    ("fundações", structural_summary.footings_count),
                    ("pilares", structural_summary.columns_count),
                    ("vigas", structural_summary.beams_count),
                    ("lajes", structural_summary.slabs_count),
                ) if count == 0
            ]
            if missing_families:
                add("structure.families_missing", "warning", "estrutura", f"Elementos não confirmados: {', '.join(missing_families)}.", structure_pages, True)
            if structural_summary.total_steel_weight_kg <= 0:
                add("structure.steel_missing", "critical", "estrutura", "O peso de aço não foi confirmado.", structure_pages, True)

    if "hidrossanitario" in disciplines:
        hydro_summary = document_analysis.hydrosanitary_summary
        has_plan_evidence = bool(
            hydro_summary
            and any(pipe.evidence_kind == "planta" for pipe in hydro_summary.pipes)
        )
        has_vector_lengths = bool(
            hydro_summary
            and any(pipe.measured_length_m is not None for pipe in hydro_summary.pipes)
        )
        add(
            "hydro.vector_lengths_partial"
            if has_vector_lengths
            else "hydro.lengths_not_measured" if has_plan_evidence else "hydro.quantities_not_measured",
            "warning",
            "hidrossanitario",
            "Foram medidos troços vetoriais com escala confirmada; ligações sem codificação e quantidades finais de aparelhos ainda exigem revisão."
            if has_vector_lengths
            else "Tubagens e diâmetros foram identificados, mas os comprimentos e as quantidades finais de aparelhos exigem confirmação."
            if has_plan_evidence
            else "A disciplina hidrossanitária foi separada, mas comprimentos de tubagem e quantidades de aparelhos ainda não foram medidos.",
            pages_by_discipline.get("hidrossanitario", []),
            True,
        )

    return issues


def parse_pdf(file_bytes: bytes, progress_callback=None, detection_tags: list[str] | None = None) -> ParseResult:
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    metadata = PlantMetadata()
    document_text_parts: list[str] = []
    room_page_priorities: dict[int, int] = {}

    # Candidatos por nível — a cascata escolhe um nível depois da classificação.
    rooms_schedule: list[Room] = []
    rooms_cotada: list[Room] = []
    rooms_mobiliada: list[Room] = []
    rooms_fallback: list[Room] = []
    openings_quadro: list[Opening] = []
    openings_spatial: list[Opening] = []
    rebar_total10: list[RebarLine] = []
    rebar_peso10: list[RebarLine] = []
    footings: list[Footing] = []
    column_groups: list[ColumnGroup] = []
    beam_spans: list[BeamSpan] = []
    staircases: list[Staircase] = []
    slabs: list[Slab] = []
    hydro_vector_measurements: list[HydroPipeEvidence] = []
    hydro_equipment_measurements: list[HydroEquipmentEvidence] = []

    for page_index in range(doc.page_count):
        page = doc[page_index]
        text_page = page.get_textpage()
        text = page.get_text("text", textpage=text_page)
        page_number = page_index + 1
        document_text_parts.append(text)

        page_metadata = extract_metadata(text)
        # Um carimbo pode ter o proprietÃ¡rio na capa e especialidade/conteÃºdo apenas nas
        # pranchas. Completa campo a campo, em vez de substituir o objecto inteiro ou parar na
        # primeira pÃ¡gina parcialmente preenchida.
        for field_name, value in page_metadata.__dict__.items():
            if value and not getattr(metadata, field_name):
                setattr(metadata, field_name, value)

        if is_room_area_page(text):
            plan_type = detect_plan_type(text)
            room_page_priorities[page_number] = ROOM_PAGE_PRIORITY.get(plan_type, 1)
            page_dict = page.get_text("dict", textpage=text_page)
            schedule_rooms = extract_room_schedule(text, page_number)
            if schedule_rooms:
                rooms_schedule.extend(schedule_rooms)
            else:
                labeled = merge_page_room_sources(
                    extract_rooms(text, page_number),
                    extract_rooms_spatial(page, page_number, text, page_dict),
                )
                if plan_type == "mobiliada":
                    rooms_mobiliada.extend(labeled)
                else:
                    rooms_cotada.extend(labeled)
            rooms_fallback.extend(extract_room_list_fallback(text, page_number))

        # Vãos: quadro e geometria ficam separados para a cascata.
        openings_quadro.extend(extract_opening_schedule(text, page_number))
        openings_spatial.extend(extract_openings_spatial(page, page_number, text))

        rebar_total10.extend(extract_rebar_total_plus10(text, page_number))
        try:
            from rebar_estimate import extract_rebar_peso_plus10_table

            rebar_peso10.extend(extract_rebar_peso_plus10_table(text, page_number))
        except Exception:
            pass

        footings.extend(extract_footings(text, page_number))
        column_groups.extend(extract_column_groups(text, page_number))
        beam_spans.extend(extract_beam_spans(text, page_number))
        staircases.extend(extract_staircases(text, page_number))
        slabs.extend(extract_slabs(text, page_number))
        hydro_vector_measurements.extend(extract_hydro_vector_measurements(page, text, page_number))
        hydro_equipment_measurements.extend(extract_hydro_coded_equipment(page, text, page_number))
        hydro_equipment_measurements.extend(extract_hydro_vector_accessories(page, text, page_number))
        if progress_callback:
            progress_callback(page_number, doc.page_count)

    page_hints: dict[int, list[tuple[str, int, str]]] = defaultdict(list)
    for page in {
        room.page
        for room in rooms_schedule + rooms_cotada + rooms_mobiliada + rooms_fallback
    }:
        page_hints[page].append(("arquitectura", 7, "compartimentos e áreas reconhecidos"))
    for page in {opening.page for opening in openings_quadro + openings_spatial}:
        page_hints[page].append(("arquitectura", 8, "portas ou janelas reconhecidas"))
    for page in {line.page for line in rebar_total10 + rebar_peso10}:
        page_hints[page].append(("estrutura", 11, "armaduras reconhecidas"))
    for page in {
        item.page
        for collection in (footings, column_groups, beam_spans, staircases, slabs)
        for item in collection
    }:
        page_hints[page].append(("estrutura", 8, "elementos estruturais reconhecidos"))

    classifications = classify_document_pages(document_text_parts, page_hints)
    document_analysis = build_document_analysis(classifications, document_text_parts)
    if document_analysis.sections:
        first_identity = next(
            (section.identity for section in document_analysis.sections if section.identity),
            None,
        )
        if first_identity:
            metadata.proprietario = first_identity.owner or metadata.proprietario
            location = first_identity.location or ""
            bairro_match = re.search(r"(?i)\bBairro\s+(.+?)(?=\s*[-,]\s*Cidade|$)", location)
            city_match = re.search(r"(?i)\bCidade\s+de\s+(.+?)(?=\s*[-,]|$)", location)
            if bairro_match:
                metadata.bairro = bairro_match.group(1).strip()
            if city_match:
                metadata.distrito = city_match.group(1).strip()
            elif not metadata.distrito:
                metadata.distrito = location or None
    if document_analysis.is_multi_discipline:
        # ConteÃºdo, nÃºmero e escala pertencem a cada prancha; num PDF composto, expor o
        # primeiro valor encontrado mistura especialidades e pode atÃ© recuperar texto oculto
        # de um carimbo-modelo. A informaÃ§Ã£o detalhada permanece nas secÃ§Ãµes/pÃ¡ginas.
        metadata.especialidade = "MULTIDISCIPLINAR"
        metadata.conteudo = None
        metadata.numero = None
        metadata.escala = None
    normalised_document = _normalise_key("\n".join(document_text_parts))
    document_analysis.matched_tags = sorted({
        tag.strip().lower()
        for tag in (detection_tags or [])
        if tag.strip() and _normalise_key(tag) in normalised_document
    })
    architecture_pages = {page.page for page in classifications if page.discipline == "arquitectura"}
    structure_pages = {page.page for page in classifications if page.discipline == "estrutura"}

    def _on_arch(items):
        return [item for item in items if item.page in architecture_pages]

    def _on_struct(items):
        return [item for item in items if item.page in structure_pages]

    rooms_schedule = _on_arch(rooms_schedule)
    rooms_cotada = _on_arch(rooms_cotada)
    rooms_mobiliada = _on_arch(rooms_mobiliada)
    rooms_fallback = _on_arch(rooms_fallback)
    openings_quadro = _on_arch(openings_quadro)
    openings_spatial = _on_arch(openings_spatial)
    rebar_total10 = _on_struct(rebar_total10)
    rebar_peso10 = _on_struct(rebar_peso10)
    footings = _on_struct(footings)
    column_groups = _on_struct(column_groups)
    beam_spans = _on_struct(beam_spans)
    staircases = _on_struct(staircases)
    slabs = _on_struct(slabs)

    # Materiais e recobrimentos aparecem muitas vezes na memÃ³ria estrutural, nÃ£o em todas as
    # pranchas de laje. Completa apenas campos ausentes; nunca substitui uma especificaÃ§Ã£o
    # explÃ­cita da folha por uma premissa global.
    structural_text = "\n".join(
        text for page, text in enumerate(document_text_parts, start=1) if page in structure_pages
    )
    global_concrete, global_steel, global_slab_cover = extract_structural_material_specs(structural_text)
    for slab in slabs:
        slab.concrete_class = slab.concrete_class or global_concrete
        slab.steel_grade = slab.steel_grade or global_steel
        slab.cover_cm = slab.cover_cm if slab.cover_cm is not None else global_slab_cover

    default_floor = detect_document_default_floor("\n".join(document_text_parts))
    page_texts_map = {index + 1: text for index, text in enumerate(document_text_parts)}
    document_text = "\n".join(document_text_parts)

    from resolve_cascade import (
        cascade_log_lines,
        resolve_openings_cascade,
        resolve_rebar_cascade,
        resolve_rooms_cascade,
    )

    selected_rooms, rooms_cascade = resolve_rooms_cascade(
        schedule_rooms=rooms_schedule,
        labeled_cotada_rooms=rooms_cotada,
        mobiliada_rooms=rooms_mobiliada,
        fallback_rooms=rooms_fallback,
        page_priorities=room_page_priorities,
        page_texts=document_text_parts,
        architecture_pages=architecture_pages,
        default_floor=default_floor,
    )
    selected_openings, openings_cascade = resolve_openings_cascade(
        quadro_openings=openings_quadro,
        spatial_openings=openings_spatial,
        page_texts=document_text_parts,
        architecture_pages=architecture_pages,
        document_text=document_text,
    )
    rebar_schedules, rebar_cascade = resolve_rebar_cascade(
        total_plus10_lines=rebar_total10,
        peso_plus10_lines=rebar_peso10,
        page_texts=page_texts_map,
        structure_pages=structure_pages,
        rooms=selected_rooms,
        footings=footings,
        beam_spans=beam_spans,
        slabs=slabs,
    )

    # Evidência da cascata no matchedTags (visível em diagnóstico / health de parse).
    for line in cascade_log_lines([rooms_cascade, openings_cascade, rebar_cascade]):
        tag = line.lower()
        if tag not in document_analysis.matched_tags:
            document_analysis.matched_tags.append(tag)

    doc.close()
    structural_summary = build_structural_summary(
        footings, column_groups, beam_spans, rebar_schedules, staircases, slabs, selected_rooms
    )
    document_analysis.hydrosanitary_summary = extract_hydrosanitary_summary(
        document_analysis,
        document_text_parts,
        vector_measurements=hydro_vector_measurements,
        equipment_measurements=hydro_equipment_measurements,
        rooms=selected_rooms,
    )
    document_analysis.quality_issues = build_technical_quality_issues(
        document_analysis, selected_rooms, selected_openings, structural_summary
    )
    from schedule_detect import classify_page_tables
    from technical_issues import cross_check_structural

    for page_text in document_text_parts:
        for table in classify_page_tables(page_text):
            if table.kind != "desconhecido":
                tag = f"schedule:{table.kind}"
                if tag not in document_analysis.matched_tags:
                    document_analysis.matched_tags.append(tag)
    document_analysis.quality_issues.extend(
        cross_check_structural(
            structural_summary,
            rebar_schedules,
            selected_rooms,
            beam_spans,
            document_text_parts,
        )
    )
    document_analysis.requires_technical_confirmation = any(
        issue.requires_confirmation for issue in document_analysis.quality_issues
    )
    return ParseResult(
        metadata=metadata,
        rooms=selected_rooms,
        openings=selected_openings,
        rebar_schedules=rebar_schedules,
        staircases=staircases,
        structural_summary=structural_summary,
        document_analysis=document_analysis,
    )

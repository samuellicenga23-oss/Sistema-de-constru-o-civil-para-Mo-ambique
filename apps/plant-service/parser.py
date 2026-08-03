"""
Extracção de dados de plantas ArchiCAD exportadas em PDF vectorial.

Abordagem: extracção de texto posicionado (não visão computacional) — o ArchiCAD já escreve
como texto vectorial as áreas de compartimentos e os pesos de aço por elemento estrutural,
confirmado por análise real de um projecto de exemplo (Projecto Completo Gil.pdf, 91 páginas).
Reconstrução geométrica de paredes a partir de cotas/linhas fica fora de âmbito (ver plano).
"""
import re
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, field

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


@dataclass
class RebarLine:
    element: str
    diameter_mm: float
    weight_kg: float
    page: int


@dataclass
class Footing:
    refs: list[str]
    width_cm: float
    length_cm: float
    height_cm: float
    page: int


@dataclass
class ColumnGroup:
    refs: list[str]
    page: int


@dataclass
class BeamSpan:
    portico: str
    width_cm: float
    height_cm: float
    length_m: float
    page: int


@dataclass
class Staircase:
    element: str
    width_m: float
    thickness_m: float
    steps_count: int
    rise_m: float
    page: int


@dataclass
class Slab:
    floor: str | None
    layer: str  # "inferior" | "superior"
    thickness_cm: float
    page: int


@dataclass
class SlabSummary:
    floor: str | None
    thickness_cm: float
    layers: list[str]
    pages: list[int]


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
class DocumentSection:
    discipline: str
    label: str
    start_page: int
    end_page: int
    page_count: int
    confidence: float
    evidence: list[str] = field(default_factory=list)


@dataclass
class DocumentAnalysis:
    page_count: int
    is_multi_discipline: bool
    sections: list[DocumentSection] = field(default_factory=list)
    matched_tags: list[str] = field(default_factory=list)


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


def build_document_analysis(classifications: list[PageClassification]) -> DocumentAnalysis:
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
            )
        )
        start = end + 1
    recognized = {section.discipline for section in sections if section.discipline != "outro"}
    return DocumentAnalysis(
        page_count=len(classifications),
        is_multi_discipline=len(recognized) > 1,
        sections=sections,
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
    r"^(?:fase|especialidade|propriet[aá]ri[oa]|projectou|conte[uú]do|nome\s+do\s+desenho|"
    r"layout\s+id|revision|revis[aã]o|escala|n[uú]mero|legenda|observa[çc][õo]es|"
    r"planta|projecto|projeto|al[çc]ado|corte|pormenor|detalhe|gspublisherversion)\b",
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
# código P/D/J/W, designação e dimensão largura x altura. A quantidade no fim é opcional.
OPENING_SCHEDULE_PATTERN = re.compile(
    r"(?im)^\s*(?P<code>(?:P|D|J|W)\s*[-.]?\s*\d{1,3})\s+"
    r"(?P<label>[^\n]{0,90}?)\s+"
    r"(?P<width>\d(?:[.,]\d{1,3})?)\s*(?:m\s*)?[x×]\s*"
    r"(?P<height>\d(?:[.,]\d{1,3})?)\s*(?:m)?"
    r"(?:\s+(?P<quantity>\d{1,3}))?\s*$"
)
OPENING_CODE_PATTERN = re.compile(r"^(?P<prefix>[PDJW])\s*[-.]?\s*(?P<number>\d{1,3})$", re.IGNORECASE)
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
FOOTING_REF_LINE = re.compile(r"^\(?P\d+(?:\s*(?:,|e|-|=)\s*P\d+)*\)?$")
DIMENSION_LINE = re.compile(r"^(\d+)\s*x\s*(\d+)$")
NUMBER_LINE = re.compile(r"^\d+(?:[.,]\d+)?$")
DECIMAL_METER_LINE = re.compile(r"^\d+[.,]\d+$")
PORTICO_LABEL_LINE = re.compile(r"^Pórtico\s*(\d+)$")
STAIRCASE_LABEL_LINE = re.compile(r"^Escada\s*(\d+)$")
METER_VALUE = re.compile(r"^([\d.,]+)\s*m$")
INTEGER_VALUE = re.compile(r"^(\d+)$")

# Folhas de armadura de lajes (piso térreo/intermédio/cobertura): título "ARMADURA
# INFERIOR"/"ARMADURA SUPERIOR" na legenda, e a espessura da laje repetida várias vezes na
# planta como "h=20" (cm) — mesmo valor em toda a folha, uma ocorrência chega.
SLAB_PAGE_TITLE_PATTERN = re.compile(r"ARMADURA\s+(INFERIOR|SUPERIOR)", re.IGNORECASE)
SLAB_THICKNESS_LINE = re.compile(r"^h\s*=\s*(\d+(?:[.,]\d+)?)$", re.IGNORECASE)
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
    (re.compile(r"primeiro\s*piso", re.IGNORECASE), "1º Piso", 1),
    (re.compile(r"segundo\s*piso", re.IGNORECASE), "2º Piso", 1),
    (re.compile(r"terceiro\s*piso", re.IGNORECASE), "3º Piso", 1),
    (re.compile(r"(\d+)\s*[ºªo]\s*piso", re.IGNORECASE), None, 1),  # capturado dinamicamente
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


def extract_opening_schedule(text: str, page_number: int) -> list[Opening]:
    floor, _ = detect_floor_label(text)
    openings: list[Opening] = []
    for match in OPENING_SCHEDULE_PATTERN.finditer(text):
        raw_code = re.sub(r"\s+", "", match.group("code")).replace(".", "-").upper()
        prefix = raw_code[0]
        label = match.group("label").strip()
        kind = "janela" if prefix in ("J", "W") or re.search(r"janela|window", label, re.IGNORECASE) else "porta"
        width = _to_float(match.group("width"))
        height = _to_float(match.group("height"))
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
    dimensions = []
    codes = []
    for word in words:
        value = str(word[4]).strip()
        centre = ((word[0] + word[2]) / 2, (word[1] + word[3]) / 2)
        if DECIMAL_DIMENSION_PATTERN.fullmatch(value):
            dimensions.append((centre, _to_float(value), value))
        code_match = OPENING_CODE_PATTERN.fullmatch(value)
        if code_match:
            codes.append((centre, f"{code_match.group('prefix').upper()}{code_match.group('number')}"))

    def nearby_code(cx: float, cy: float, kind: str) -> str | None:
        allowed = ("J", "W") if kind == "janela" else ("P", "D")
        candidates = [
            ((x - cx) ** 2 + (y - cy) ** 2, code)
            for (x, y), code in codes
            if code.startswith(allowed) and abs(x - cx) <= 55 and abs(y - cy) <= 55
        ]
        return min(candidates)[1] if candidates else None

    candidates: list[tuple[Opening, tuple[float, float]]] = []
    door_centres: list[tuple[float, float]] = []
    for drawing in page.get_drawings():
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
            if not pairs:
                continue
            _distance, opening_width, opening_height = min(pairs)
            door_centres.append((cx, cy))
            candidates.append((Opening(
                kind="porta",
                code=nearby_code(cx, cy, "porta"),
                width_m=opening_width,
                height_m=opening_height,
                sill_height_m=0,
                quantity=1,
                floor=floor,
                location="desconhecida",
                material=None,
                page=page_number,
                confidence=0.84,
                source="geometria",
                needs_confirmation=True,
            ), (cx, cy)))

    # Janelas (e portas sem arco) só entram automaticamente quando existe um código inequívoco.
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
        candidates.append((Opening(
            kind=kind,
            code=code,
            width_m=opening_width,
            height_m=opening_height,
            sill_height_m=None if kind == "janela" else 0,
            quantity=1,
            floor=floor,
            location="desconhecida",
            material=None,
            page=page_number,
            confidence=0.76,
            source="geometria",
            needs_confirmation=True,
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
            candidates.append((Opening(
                kind=kind,
                code=None,
                width_m=opening_width,
                height_m=opening_height,
                sill_height_m=None,
                quantity=1,
                floor=floor,
                location="desconhecida",
                material=None,
                page=page_number,
                confidence=0.48,
                source="geometria",
                needs_confirmation=True,
            ), (cx, cy)))

    # Agrupa ocorrências iguais na mesma prancha sem apagar portas realmente repetidas.
    grouped: dict[tuple, Opening] = {}
    for opening, _centre in candidates:
        key = (opening.kind, opening.code, opening.width_m, opening.height_m, opening.floor, opening.page)
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
        key = (opening.source, opening.page, opening.kind, opening.code, opening.width_m, opening.height_m)
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
# não sendo "cotada" (mobilada, implantação, localização) — nunca quando o tipo não é detectado
# (legenda em formato diferente, ou projecto que não distingue "cotada"/"mobilada" e só tem um
# tipo de planta): nesse caso continua-se a extrair, tal como antes desta alteração, para não
# fazer desaparecer silenciosamente todos os compartimentos de projectos sem essa legenda.
ROOM_EXCLUDED_PLAN_TYPES = {
    "imagem_satelite",
    "mobiliada",
    "implantacao",
    "localizacao",
    "fundacao",
    "cobertura",
    "alcados",
    "cortes",
}

ROOM_PAGE_PRIORITY = {"cotada": 4, "geral": 3, None: 2}

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
    "proprietario": r"Propriet[áa]rio\s*:\s*([^\n:]+?)(?=\s{2,}|$|Fase\s*:|Bairro\s*:)",
    "fase": r"Fase\s*:\s*([^\n:]+?)(?=\s{2,}|$|Especialidade\s*:)",
    "bairro": r"Bairro\s*:\s*([^\n:]+?)(?=\s{2,}|$|Talh[ãa]o\s*:)",
    "talhao": r"Talh[ãa]o\s*:\s*([^\n:]+?)(?=\s{2,}|$|Distrito\s*:)",
    "distrito": r"Distrito\s*:\s*([^\n:]+?)(?=\s{2,}|$)",
    "especialidade": r"Especialidade\s*:\s*([^\n:]+?)(?=\s{2,}|$|Planta)",
    "conteudo": r"Conte[úu]do\s*:\s*([^\n:]+?)(?=\s{2,}|$|Escala)",
    "numero": r"N[uú]mero\s*:\s*([^\n:]+?)(?=\s{2,}|$)",
    "escala": r"Escala\s*:?\s*([\d:.,/\s]+?)(?=\s{2,}|$)",
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
            room = Room(name=name, number=number, area_m2=area, page=page_number, floor=floor_label)
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
            area = _to_float(area_matches[-1].group(1))
            perimeter = _to_float(length_matches[0].group(1)) if length_matches else None
            if area > 0:
                rooms.append(Room(name=room_name, number=None, area_m2=area, page=page_number, floor=current_floor, perimeter_m=perimeter))
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


def extract_rebar_schedules(text: str, page_number: int) -> list[RebarLine]:
    lines = []
    # Percorre o texto associando cada bloco "Total+10%: Ø..: x Ø..: y Total: z" ao
    # rótulo de elemento mais próximo que o precede (ex: "P1", "Pórtico 6").
    element_positions = [(m.start(), m.group(1)) for m in ELEMENT_LABEL_PATTERN.finditer(text)]
    for block_match in re.finditer(r"Total\+10%:.{0,200}?Total:\s*[\d.,]+", text, re.DOTALL):
        block_start = block_match.start()
        current_element = None
        for pos, label in element_positions:
            if pos <= block_start:
                current_element = label
            else:
                break
        if not current_element:
            continue
        block_text = block_match.group(0)
        for diam_match in REBAR_DIAMETER_PATTERN.finditer(block_text):
            diameter_mm = float(diam_match.group(1))
            weight_kg = _to_float(diam_match.group(2))
            lines.append(RebarLine(element=current_element, diameter_mm=diameter_mm, weight_kg=weight_kg, page=page_number))
    return lines


def extract_footings(text: str, page_number: int) -> list[Footing]:
    # "QUADRO DE ELEMENTOS DE FUNDAÇÃO" do CYPE CAD: cada sapata (ou grupo de sapatas
    # idênticas) aparece como 3 linhas consecutivas — referências, "LxL" (cm), altura (cm) —
    # seguidas de 2 ou 4 linhas de armadura antes da referência seguinte.
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
                refs = re.findall(r"P\d+", ref_line)
                footings.append(
                    Footing(
                        refs=refs,
                        width_cm=float(dim_match.group(1)),
                        length_cm=float(dim_match.group(2)),
                        height_cm=_to_float(lines[i + 2]),
                        page=page_number,
                    )
                )
                i += 3
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
    lines = [l.strip() for l in text.split("\n")]
    groups: list[ColumnGroup] = []
    run: list[str] = []

    def flush(run: list[str]) -> None:
        if len(run) < 2:
            return
        for ref_line in run:
            refs = re.findall(r"P\d+", ref_line)
            if refs:
                groups.append(ColumnGroup(refs=refs, page=page_number))

    for line in lines:
        if FOOTING_REF_LINE.match(line):
            run.append(line)
        else:
            flush(run)
            run = []
    flush(run)
    return groups


def extract_beam_spans(text: str, page_number: int) -> list[BeamSpan]:
    # "Desenho de vigas": cada "Pórtico N" é seguido (numa janela próxima) por um bloco de
    # comprimentos em metros (decimais) e, logo a seguir, o mesmo número de secções "LxA"
    # (cm) repetidas — um par comprimento/secção por vão do pórtico.
    lines = [l.strip() for l in text.split("\n")]
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
            spans.append(BeamSpan(portico=portico_name, width_cm=width, height_cm=height, length_m=length, page=page_number))
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


def extract_slabs(text: str, page_number: int) -> list[Slab]:
    slabs: list[Slab] = []
    floor_label, _ = detect_floor_label(text)
    lines = [l.strip() for l in text.split("\n")]

    # Formato 1 (CYPE CAD): folha dedicada por piso+camada, título "ARMADURA
    # INFERIOR"/"ARMADURA SUPERIOR", espessura "h=20" repetida na planta.
    title_match = SLAB_PAGE_TITLE_PATTERN.search(text)
    if title_match:
        layer = title_match.group(1).lower()
        thicknesses = [_to_float(m.group(1)) for m in (SLAB_THICKNESS_LINE.match(l) for l in lines) if m]
        if thicknesses:
            slabs.append(Slab(floor=floor_label, layer=layer, thickness_cm=thicknesses[0], page=page_number))

    # Formato 2 (planta geral de elementos estruturais, sem folha de armadura própria):
    # referência "L1" seguida imediatamente pela espessura "h=15".
    for idx, line in enumerate(lines):
        if SLAB_REF_LINE.match(line) and idx + 1 < len(lines):
            thickness_match = SLAB_THICKNESS_LINE.match(lines[idx + 1])
            if thickness_match:
                slabs.append(Slab(floor=floor_label, layer="geral", thickness_cm=_to_float(thickness_match.group(1)), page=page_number))

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
                    if group["floor"] == slab.floor and abs(group["thickness_cm"] - slab.thickness_cm) < 0.01
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
            }
            groups.append(target)
        target["layers"].add(slab.layer)
        target["pages"].add(slab.page)

    return [
        SlabSummary(
            floor=group["floor"],
            thickness_cm=group["thickness_cm"],
            layers=sorted(group["layers"]),
            pages=sorted(group["pages"]),
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
) -> StructuralSummary | None:
    if not footings and not column_groups and not beam_spans and not rebar_schedules and not staircases and not slabs:
        return None

    # Cada linha do quadro pode representar várias sapatas/pilares idênticos (ex: "P07, P09,
    # P15 e P16") — pesa-se a média pelo nº de referências de cada linha, não pelo nº de linhas.
    footing_refs = {ref for f in footings for ref in f.refs}
    footing_widths = [f.width_cm for f in footings for _ in f.refs]
    footing_lengths = [f.length_cm for f in footings for _ in f.refs]
    footing_depths = [f.height_cm for f in footings for _ in f.refs]

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

    return StructuralSummary(
        footings_count=len(footing_refs),
        footings_avg_width_cm=_avg(footing_widths),
        footings_avg_length_cm=_avg(footing_lengths),
        footings_avg_depth_cm=_avg(footing_depths),
        columns_count=len(column_refs),
        beams_count=len(beam_porticos),
        beams_total_length_m=sum(beam_lengths),
        beams_avg_width_cm=_avg(beam_widths),
        beams_avg_height_cm=_avg(beam_heights),
        beams_concrete_volume_m3=beams_concrete_volume_m3,
        staircases_count=len(staircase_elements),
        slabs_count=len(slab_summaries),
        slabs_avg_thickness_cm=_avg(slab_thicknesses),
        slabs=slab_summaries,
        # Peso total de aço já com +10% de desperdício, tal como vem calculado nos "Resumo
        # Aço" do projecto — soma de todos os elementos (sapatas, pilares, vigas, escadas,
        # armadura de lajes/cobertura — este último grupo só passou a ser contabilizado
        # depois de "Armadura longitudinal inferior/superior" entrar no ELEMENT_LABEL_PATTERN).
        total_steel_weight_kg=sum(r.weight_kg for r in rebar_schedules),
    )


def parse_pdf(file_bytes: bytes, progress_callback=None, detection_tags: list[str] | None = None) -> ParseResult:
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    metadata = PlantMetadata()
    rooms: list[Room] = []
    openings: list[Opening] = []
    fallback_rooms: list[Room] = []
    document_text_parts: list[str] = []
    room_page_priorities: dict[int, int] = {}
    rebar_schedules: list[RebarLine] = []
    footings: list[Footing] = []
    column_groups: list[ColumnGroup] = []
    beam_spans: list[BeamSpan] = []
    staircases: list[Staircase] = []
    slabs: list[Slab] = []

    for page_index in range(doc.page_count):
        page = doc[page_index]
        # Reutiliza o mesmo TextPage para texto corrido e geometria. Sem isto, PyMuPDF voltava a
        # interpretar fontes e objectos da página duas ou três vezes nas plantas cotadas.
        text_page = page.get_textpage()
        text = page.get_text("text", textpage=text_page)
        page_number = page_index + 1
        document_text_parts.append(text)

        if not metadata.especialidade:
            page_metadata = extract_metadata(text)
            if any(v for v in page_metadata.__dict__.values()):
                metadata = page_metadata

        # Só se extraem áreas de compartimento de folhas "planta cotada" — uma folha "planta
        # mobilada"/"planta de implantação" do mesmo piso mostra a mesma área outra vez, e nem
        # sempre repete o número do compartimento (ver is_room_area_page), o que faz o duplicado
        # escapar à de-duplicação e inflacionar a área total do piso.
        if is_room_area_page(text):
            plan_type = detect_plan_type(text)
            room_page_priorities[page_number] = ROOM_PAGE_PRIORITY.get(plan_type, 1)
            page_dict = page.get_text("dict", textpage=text_page)
            rooms.extend(
                merge_page_room_sources(
                    extract_rooms(text, page_number),
                    extract_rooms_spatial(page, page_number, text, page_dict),
                    extract_room_schedule(text, page_number),
                )
            )
            fallback_rooms.extend(extract_room_list_fallback(text, page_number))
        openings.extend(extract_opening_schedule(text, page_number))
        openings.extend(extract_openings_spatial(page, page_number, text))
        rebar_schedules.extend(extract_rebar_schedules(text, page_number))
        footings.extend(extract_footings(text, page_number))
        column_groups.extend(extract_column_groups(text, page_number))
        beam_spans.extend(extract_beam_spans(text, page_number))
        staircases.extend(extract_staircases(text, page_number))
        slabs.extend(extract_slabs(text, page_number))
        if progress_callback:
            progress_callback(page_number, doc.page_count)

    # Conteúdo já extraído é também evidência. Isto mantém a leitura robusta quando um gabinete
    # entrega pranchas sem capa, sem código normalizado e até sem o campo "Especialidade".
    page_hints: dict[int, list[tuple[str, int, str]]] = defaultdict(list)
    for page in {room.page for room in rooms + fallback_rooms}:
        page_hints[page].append(("arquitectura", 7, "compartimentos e áreas reconhecidos"))
    for page in {opening.page for opening in openings}:
        page_hints[page].append(("arquitectura", 8, "portas ou janelas reconhecidas"))
    for page in {line.page for line in rebar_schedules}:
        page_hints[page].append(("estrutura", 11, "armaduras reconhecidas"))
    for page in {
        item.page
        for collection in (footings, column_groups, beam_spans, staircases, slabs)
        for item in collection
    }:
        page_hints[page].append(("estrutura", 8, "elementos estruturais reconhecidos"))

    classifications = classify_document_pages(document_text_parts, page_hints)
    document_analysis = build_document_analysis(classifications)
    normalised_document = _normalise_key("\n".join(document_text_parts))
    document_analysis.matched_tags = sorted({
        tag.strip().lower()
        for tag in (detection_tags or [])
        if tag.strip() and _normalise_key(tag) in normalised_document
    })
    architecture_pages = {page.page for page in classifications if page.discipline == "arquitectura"}
    structure_pages = {page.page for page in classifications if page.discipline == "estrutura"}

    # A extracção é feita enquanto cada página é lida para manter o progresso real; depois da
    # classificação global retêm-se os resultados da especialidade certa. Isto evita que uma
    # planta hidrossanitária que reutiliza o fundo arquitectónico duplique compartimentos, ou que
    # números de uma memória descritiva sejam confundidos com armaduras.
    rooms = [room for room in rooms if room.page in architecture_pages]
    fallback_rooms = [room for room in fallback_rooms if room.page in architecture_pages]
    openings = [opening for opening in openings if opening.page in architecture_pages]
    rebar_schedules = [line for line in rebar_schedules if line.page in structure_pages]
    footings = [item for item in footings if item.page in structure_pages]
    column_groups = [item for item in column_groups if item.page in structure_pages]
    beam_spans = [item for item in beam_spans if item.page in structure_pages]
    staircases = [item for item in staircases if item.page in structure_pages]
    slabs = [item for item in slabs if item.page in structure_pages]

    default_floor = detect_document_default_floor("\n".join(document_text_parts))
    selected_rooms = rooms if rooms else fallback_rooms
    if default_floor:
        for room in selected_rooms:
            if room.floor is None:
                room.floor = default_floor

    doc.close()
    structural_summary = build_structural_summary(footings, column_groups, beam_spans, rebar_schedules, staircases, slabs)
    return ParseResult(
        metadata=metadata,
        rooms=dedupe_rooms(selected_rooms, room_page_priorities),
        openings=merge_openings(openings, "\n".join(document_text_parts)),
        rebar_schedules=rebar_schedules,
        staircases=staircases,
        structural_summary=structural_summary,
        document_analysis=document_analysis,
    )

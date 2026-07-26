"""
Extracção de dados de plantas ArchiCAD exportadas em PDF vectorial.

Abordagem: extracção de texto posicionado (não visão computacional) — o ArchiCAD já escreve
como texto vectorial as áreas de compartimentos e os pesos de aço por elemento estrutural,
confirmado por análise real de um projecto de exemplo (Projecto Completo Gil.pdf, 91 páginas).
Reconstrução geométrica de paredes a partir de cotas/linhas fica fora de âmbito (ver plano).
"""
import re
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
class ParseResult:
    metadata: PlantMetadata
    rooms: list[Room] = field(default_factory=list)
    rebar_schedules: list[RebarLine] = field(default_factory=list)
    staircases: list[Staircase] = field(default_factory=list)
    structural_summary: StructuralSummary | None = None


# Nome do compartimento (maiúsculas, acentos incluídos) + número opcional + "A: 21,74 m²"
ROOM_PATTERN = re.compile(
    r"([A-ZÀ-Ÿ][A-ZÀ-Ÿ0-9°ºª\.\s]{1,40}?)\s+(\d{1,3})?\s*A[:=]\s*(\d+[.,]\d+)\s*m[²2]"
)

# Formato alternativo (tabela nativa do ArchiCAD "Rooms by stories" exportada a PDF): uma
# tabela com colunas Story/Room/R. Height/Perimeter/Wall surf./Measured Area, um compartimento
# por linha, cada valor de coluna na sua própria linha (algumas em branco/omissas). Dá o
# perímetro real de cada compartimento — melhor do que a aproximação por área.
ROOM_SCHEDULE_MARKER = re.compile(r"Rooms by stories", re.IGNORECASE)
AREA_VALUE_LINE = re.compile(r"^([\d.,]+)\s*m[²2]$")
LENGTH_VALUE_LINE = re.compile(r"^([\d.,]+)\s*m$")

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
    (re.compile(r"t[ée]rreo|r[ée]s\s*-?\s*do\s*-?\s*ch[ãa]o", re.IGNORECASE), "Piso Térreo", 1),
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


# Tipo de folha de arquitectura, lido do campo "Conteúdo" da legenda (ex: "PLANTA COTADA PISO
# TÉRREO", "PLANTA MOBILADA PISO SUPERIOR") — um projecto tipicamente tem as duas variantes por
# piso (cotada = com cotas/dimensões; mobilada/mobiliada = com mobiliário desenhado), mostrando a
# MESMA área de compartimento nas duas. Só a "planta cotada" deve entrar na extracção de áreas:
# usar as duas ao mesmo tempo faz o sistema ler a área do mesmo compartimento duas vezes (uma por
# folha), e se a folha mobilada não repetir o número do compartimento (frequente — esse número é
# tipicamente um apontamento da cotagem, não do mobiliário), a de-duplicação por número falha
# silenciosamente a apanhar o duplicado, inflacionando a área total do piso.
PLAN_TYPE_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"planta\s+cotada", re.IGNORECASE), "cotada"),
    (re.compile(r"planta\s+mobil(?:i)?ada", re.IGNORECASE), "mobiliada"),
    (re.compile(r"planta\s+de\s+implanta[çc][ãa]o", re.IGNORECASE), "implantacao"),
    (re.compile(r"planta\s+de\s+localiza[çc][ãa]o", re.IGNORECASE), "localizacao"),
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
ROOM_EXCLUDED_PLAN_TYPES = {"mobiliada", "implantacao", "localizacao"}

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
        name = re.sub(r"\s+", " ", match.group(1)).strip()
        # Filtra falsos positivos onde o "nome" capturado é demasiado curto/genérico
        if len(name) < 3:
            continue
        number = match.group(2)
        area = _to_float(match.group(3))
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


def dedupe_rooms(rooms: list[Room]) -> list[Room]:
    # O mesmo compartimento aparece frequentemente em mais do que uma folha "planta cotada" do
    # mesmo piso (ex: uma folha por zona da casa) — a de-duplicação junta essas repetições. O
    # número do compartimento por si só NÃO é uma chave segura entre pisos diferentes: cada piso
    # tipicamente recomeça a sua própria numeração (ex: "01" no Piso Térreo E "01" no Piso
    # Superior são dois compartimentos físicos distintos) — juntar por número sem o piso fazia um
    # destes dois desaparecer silenciosamente, apanhado directamente num projecto real de dois
    # pisos. Por isso a chave inclui sempre o piso detectado (ou "" quando nenhum piso foi
    # identificado nessa ocorrência — ocorrências sem piso só se juntam entre si, nunca com uma
    # ocorrência que tenha piso identificado).
    #
    # O nome do compartimento por vezes vem contaminado com rótulos de eixos da grelha do desenho
    # (ex: "A2 A2 QUARTO 01" em vez de "QUARTO 01", quando o texto do compartimento aparece perto
    # de referências de eixo na peça desenhada) — por isso não é a chave, só se escolhe entre as
    # ocorrências do grupo já formado por (piso, número) a versão mais limpa (mais curta).
    #
    # As duas decisões — que NOME mostrar e que PISO atribuir — são resolvidas em separado:
    # o nome mais limpo (mais curto) entre as ocorrências, e o piso da ocorrência cuja
    # etiqueta é mais específica (ex: "Anexo" vence uma legenda combinada de "Piso Térreo").
    # Nem sempre a etiqueta mais específica é a correcta (ex: um compartimento do piso térreo
    # que também aparece como referência de contexto numa folha de "Anexo") — por isso esta
    # atribuição fica sempre revisável no ecrã de confirmação antes de entrar no Assistente.
    groups: dict[tuple[str, str], list[Room]] = {}
    for room in rooms:
        floor_key = (room.floor or "").strip().upper()
        item_key = room.number if room.number else f"__{room.name.strip().upper()}"
        groups.setdefault((floor_key, item_key), []).append(room)

    deduped = []
    for group in groups.values():
        cleanest = min(group, key=lambda r: len(r.name.strip()))
        best_floor_room = max(group, key=lambda r: detect_floor_label(r.floor or "")[1])
        perimeter = next((r.perimeter_m for r in group if r.perimeter_m is not None), None)
        deduped.append(
            Room(
                name=re.sub(r"\s+", " ", cleanest.name).strip(),
                number=cleanest.number,
                area_m2=cleanest.area_m2,
                page=best_floor_room.page,
                floor=best_floor_room.floor,
                perimeter_m=perimeter,
            )
        )
    return deduped


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


def build_structural_summary(
    footings: list[Footing],
    column_groups: list[ColumnGroup],
    beam_spans: list[BeamSpan],
    rebar_schedules: list[RebarLine],
    staircases: list[Staircase],
    slabs: list[Slab],
) -> StructuralSummary | None:
    if not footings and not column_groups and not beam_spans:
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
    slab_keys = {(s.floor, s.layer, s.page) for s in slabs}
    slab_thicknesses = [s.thickness_cm for s in slabs]

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
        slabs_count=len(slab_keys),
        slabs_avg_thickness_cm=_avg(slab_thicknesses),
        # Peso total de aço já com +10% de desperdício, tal como vem calculado nos "Resumo
        # Aço" do projecto — soma de todos os elementos (sapatas, pilares, vigas, escadas,
        # armadura de lajes/cobertura — este último grupo só passou a ser contabilizado
        # depois de "Armadura longitudinal inferior/superior" entrar no ELEMENT_LABEL_PATTERN).
        total_steel_weight_kg=sum(r.weight_kg for r in rebar_schedules),
    )


def parse_pdf(file_bytes: bytes) -> ParseResult:
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    metadata = PlantMetadata()
    rooms: list[Room] = []
    rebar_schedules: list[RebarLine] = []
    footings: list[Footing] = []
    column_groups: list[ColumnGroup] = []
    beam_spans: list[BeamSpan] = []
    staircases: list[Staircase] = []
    slabs: list[Slab] = []

    for page_index in range(doc.page_count):
        page = doc[page_index]
        text = page.get_text()
        page_number = page_index + 1

        if not metadata.especialidade:
            page_metadata = extract_metadata(text)
            if any(v for v in page_metadata.__dict__.values()):
                metadata = page_metadata

        # Só se extraem áreas de compartimento de folhas "planta cotada" — uma folha "planta
        # mobilada"/"planta de implantação" do mesmo piso mostra a mesma área outra vez, e nem
        # sempre repete o número do compartimento (ver is_room_area_page), o que faz o duplicado
        # escapar à de-duplicação e inflacionar a área total do piso.
        if is_room_area_page(text):
            rooms.extend(extract_rooms(text, page_number))
            rooms.extend(extract_room_schedule(text, page_number))
        rebar_schedules.extend(extract_rebar_schedules(text, page_number))
        footings.extend(extract_footings(text, page_number))
        column_groups.extend(extract_column_groups(text, page_number))
        beam_spans.extend(extract_beam_spans(text, page_number))
        staircases.extend(extract_staircases(text, page_number))
        slabs.extend(extract_slabs(text, page_number))

    doc.close()
    structural_summary = build_structural_summary(footings, column_groups, beam_spans, rebar_schedules, staircases, slabs)
    return ParseResult(
        metadata=metadata,
        rooms=dedupe_rooms(rooms),
        rebar_schedules=rebar_schedules,
        staircases=staircases,
        structural_summary=structural_summary,
    )

import asyncio
import hashlib
import json
import os
from collections import OrderedDict
from threading import Lock

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from pydantic import BaseModel, Field
from fastapi.responses import StreamingResponse

from parser import parse_pdf

app = FastAPI(title="SIGO Plant Service")

# Segredo partilhado com a API principal — este serviço não tem o seu próprio sistema de
# utilizadores/sessões, e confiava até agora só em estar isolado na rede (127.0.0.1). Se
# PLANT_SERVICE_TOKEN não estiver definido (ex: em desenvolvimento local), a verificação fica
# desligada, tal como o CORS_ORIGIN da API principal segue o mesmo padrão "seguro por omissão
# em produção, permissivo em dev sem configuração" (achado da auditoria).
PLANT_SERVICE_TOKEN = os.environ.get("PLANT_SERVICE_TOKEN")
IS_PRODUCTION = os.environ.get("ENVIRONMENT") == "production"
PARSER_VERSION = "2026.08-resumo-fam-1"
PARSER_CONCURRENCY = max(1, min(2, int(os.environ.get("PLANT_PARSER_CONCURRENCY", "1"))))
PARSER_CACHE_SIZE = max(1, min(20, int(os.environ.get("PLANT_PARSER_CACHE_SIZE", "6"))))
parser_slots = asyncio.Semaphore(PARSER_CONCURRENCY)
parse_cache: OrderedDict[str, dict] = OrderedDict()
parse_cache_lock = Lock()

# Falhar já no arranque, não silenciosamente pedido a pedido — sem isto, um deploy em produção
# que se esquecesse de definir o token ficava a aceitar qualquer pedido sem autenticação
# interna, e ninguém dava por isso até haver um problema.
if IS_PRODUCTION and not PLANT_SERVICE_TOKEN:
    raise RuntimeError("PLANT_SERVICE_TOKEN tem de estar definido quando ENVIRONMENT=production.")


@app.get("/health")
def health():
    try:
        from ai_assist import ai_config, ollama_reachable

        cfg = ai_config()
        ai = {**cfg, "reachable": ollama_reachable() if cfg["enabled"] else False}
    except Exception as exc:  # noqa: BLE001
        ai = {"enabled": False, "reachable": False, "error": str(exc)[:120]}
    return {"status": "ok", "parserVersion": PARSER_VERSION, "ai": ai}


class RoomOut(BaseModel):
    name: str
    number: str | None
    areaM2: float
    page: int
    floor: str | None
    perimeterM: float | None


class RebarLineOut(BaseModel):
    element: str
    diameterMm: float
    weightKg: float
    page: int


class MetadataOut(BaseModel):
    proprietario: str | None
    fase: str | None
    bairro: str | None
    talhao: str | None
    distrito: str | None
    especialidade: str | None
    conteudo: str | None
    numero: str | None
    escala: str | None


class StaircaseOut(BaseModel):
    element: str
    widthM: float
    thicknessM: float
    stepsCount: int
    riseM: float
    page: int


class SlabRebarLayerOut(BaseModel):
    xDiameterMm: float
    xSpacingCm: float
    yDiameterMm: float
    ySpacingCm: float


class SlabOut(BaseModel):
    floor: str | None
    thicknessCm: float
    layers: list[str]
    pages: list[int]
    topRebar: SlabRebarLayerOut | None = None
    bottomRebar: SlabRebarLayerOut | None = None
    topSteelWeightKg: float = 0
    bottomSteelWeightKg: float = 0
    steelByDiameter: dict[str, float] = Field(default_factory=dict)
    concreteClass: str | None = None
    steelGrade: str | None = None
    coverCm: float | None = None


class OpeningOut(BaseModel):
    kind: str
    code: str | None
    widthM: float | None
    heightM: float | None
    sillHeightM: float | None
    quantity: int
    floor: str | None
    location: str
    material: str | None
    page: int
    confidence: float
    source: str
    needsConfirmation: bool
    designation: str | None = None


class BeamGroupOut(BaseModel):
    label: str
    slabIndex: int | None = None
    floor: str | None = None
    beamsCount: int
    totalLengthM: float
    avgWidthCm: float = 0
    avgHeightCm: float = 0
    steelWeightKg: float = 0


class StructuralSummaryOut(BaseModel):
    footingsCount: int
    footingsAvgWidthCm: float
    footingsAvgLengthCm: float
    footingsAvgDepthCm: float
    columnsCount: int
    beamsCount: int
    beamsTotalLengthM: float
    beamsAvgWidthCm: float
    beamsAvgHeightCm: float
    beamsConcreteVolumeM3: float
    beamGroups: list[BeamGroupOut] = Field(default_factory=list)
    staircasesCount: int
    slabsCount: int
    slabsAvgThicknessCm: float
    slabs: list[SlabOut]
    totalSteelWeightKg: float
    footingsSteelWeightKg: float = 0
    columnsSteelWeightKg: float = 0
    beamsSteelWeightKg: float = 0
    slabsSteelWeightKg: float = 0
    stairsSteelWeightKg: float = 0


class DocumentSectionOut(BaseModel):
    discipline: str
    label: str
    startPage: int
    endPage: int
    pageCount: int
    confidence: float
    evidence: list[str]
    identity: dict | None = None


class DocumentIdentityConflictOut(BaseModel):
    field: str
    severity: str
    values: list[dict]


class DocumentAnalysisOut(BaseModel):
    pageCount: int
    isMultiDiscipline: bool
    sections: list[DocumentSectionOut]
    matchedTags: list[str]
    identityConflicts: list[DocumentIdentityConflictOut] = Field(default_factory=list)
    requiresIdentityConfirmation: bool = False
    identityConfirmed: bool = False


class ParseResponse(BaseModel):
    metadata: MetadataOut
    rooms: list[RoomOut]
    openings: list[OpeningOut]
    rebarSchedules: list[RebarLineOut]
    staircases: list[StaircaseOut]
    structuralSummary: StructuralSummaryOut | None
    documentAnalysis: DocumentAnalysisOut


def build_parse_response(result) -> ParseResponse:
    summary = result.structural_summary
    document_analysis = result.document_analysis
    return ParseResponse(
        metadata=MetadataOut(**result.metadata.__dict__),
        rooms=[RoomOut(name=r.name, number=r.number, areaM2=r.area_m2, page=r.page, floor=r.floor, perimeterM=r.perimeter_m) for r in result.rooms],
        openings=[
            OpeningOut(
                kind=o.kind,
                code=o.code,
                widthM=o.width_m,
                heightM=o.height_m,
                sillHeightM=o.sill_height_m,
                quantity=o.quantity,
                floor=o.floor,
                location=o.location,
                material=o.material,
                page=o.page,
                confidence=o.confidence,
                source=o.source,
                needsConfirmation=o.needs_confirmation,
                designation=o.designation,
            )
            for o in result.openings
        ],
        rebarSchedules=[
            RebarLineOut(element=r.element, diameterMm=r.diameter_mm, weightKg=r.weight_kg, page=r.page)
            for r in result.rebar_schedules
        ],
        staircases=[
            StaircaseOut(element=s.element, widthM=s.width_m, thicknessM=s.thickness_m, stepsCount=s.steps_count, riseM=s.rise_m, page=s.page)
            for s in result.staircases
        ],
        structuralSummary=StructuralSummaryOut(
            footingsCount=summary.footings_count,
            footingsAvgWidthCm=summary.footings_avg_width_cm,
            footingsAvgLengthCm=summary.footings_avg_length_cm,
            footingsAvgDepthCm=summary.footings_avg_depth_cm,
            columnsCount=summary.columns_count,
            beamsCount=summary.beams_count,
            beamsTotalLengthM=summary.beams_total_length_m,
            beamsAvgWidthCm=summary.beams_avg_width_cm,
            beamsAvgHeightCm=summary.beams_avg_height_cm,
            beamsConcreteVolumeM3=summary.beams_concrete_volume_m3,
            staircasesCount=summary.staircases_count,
            slabsCount=summary.slabs_count,
            slabsAvgThicknessCm=summary.slabs_avg_thickness_cm,
            slabs=[
                SlabOut(
                    floor=slab.floor,
                    thicknessCm=slab.thickness_cm,
                    layers=slab.layers,
                    pages=slab.pages,
                    topRebar=SlabRebarLayerOut(
                        xDiameterMm=slab.top_rebar.x_diameter_mm,
                        xSpacingCm=slab.top_rebar.x_spacing_cm,
                        yDiameterMm=slab.top_rebar.y_diameter_mm,
                        ySpacingCm=slab.top_rebar.y_spacing_cm,
                    ) if slab.top_rebar else None,
                    bottomRebar=SlabRebarLayerOut(
                        xDiameterMm=slab.bottom_rebar.x_diameter_mm,
                        xSpacingCm=slab.bottom_rebar.x_spacing_cm,
                        yDiameterMm=slab.bottom_rebar.y_diameter_mm,
                        ySpacingCm=slab.bottom_rebar.y_spacing_cm,
                    ) if slab.bottom_rebar else None,
                    topSteelWeightKg=slab.top_steel_weight_kg,
                    bottomSteelWeightKg=slab.bottom_steel_weight_kg,
                    steelByDiameter=slab.steel_by_diameter,
                    concreteClass=slab.concrete_class,
                    steelGrade=slab.steel_grade,
                    coverCm=slab.cover_cm,
                )
                for slab in summary.slabs
            ],
            totalSteelWeightKg=summary.total_steel_weight_kg,
            footingsSteelWeightKg=summary.footings_steel_weight_kg,
            columnsSteelWeightKg=summary.columns_steel_weight_kg,
            beamsSteelWeightKg=summary.beams_steel_weight_kg,
            slabsSteelWeightKg=summary.slabs_steel_weight_kg,
            stairsSteelWeightKg=summary.stairs_steel_weight_kg,
            beamGroups=[
                BeamGroupOut(
                    label=group.label,
                    slabIndex=group.slab_index,
                    floor=group.floor,
                    beamsCount=group.beams_count,
                    totalLengthM=group.total_length_m,
                    avgWidthCm=group.avg_width_cm,
                    avgHeightCm=group.avg_height_cm,
                    steelWeightKg=group.steel_weight_kg,
                )
                for group in summary.beam_groups
            ],
        )
        if summary
        else None,
        documentAnalysis=DocumentAnalysisOut(
            pageCount=document_analysis.page_count,
            isMultiDiscipline=document_analysis.is_multi_discipline,
            matchedTags=document_analysis.matched_tags,
            identityConflicts=[
                DocumentIdentityConflictOut(
                    field=conflict.field,
                    severity=conflict.severity,
                    values=conflict.values,
                )
                for conflict in document_analysis.identity_conflicts
            ],
            requiresIdentityConfirmation=document_analysis.requires_identity_confirmation,
            identityConfirmed=document_analysis.identity_confirmed,
            sections=[
                DocumentSectionOut(
                    discipline=section.discipline,
                    label=section.label,
                    startPage=section.start_page,
                    endPage=section.end_page,
                    pageCount=section.page_count,
                    confidence=section.confidence,
                    evidence=section.evidence,
                    identity={
                        "owner": section.identity.owner,
                        "location": section.identity.location,
                        "projectTitle": section.identity.project_title,
                        "pages": section.identity.pages,
                    } if section.identity else None,
                )
                for section in document_analysis.sections
            ],
        ),
    )


def _payload(response: ParseResponse) -> dict:
    return response.model_dump() if hasattr(response, "model_dump") else response.dict()


def _cached_payload(file_bytes: bytes, detection_tags: list[str] | None = None) -> tuple[str, dict | None]:
    tags_hash = hashlib.sha256(json.dumps(sorted(detection_tags or []), ensure_ascii=False).encode()).hexdigest()[:12]
    cache_key = f"{PARSER_VERSION}:{tags_hash}:{hashlib.sha256(file_bytes).hexdigest()}"
    with parse_cache_lock:
        cached = parse_cache.get(cache_key)
        if cached is not None:
            parse_cache.move_to_end(cache_key)
    return cache_key, cached


def _store_payload(cache_key: str, payload: dict) -> None:
    with parse_cache_lock:
        parse_cache[cache_key] = payload
        parse_cache.move_to_end(cache_key)
        while len(parse_cache) > PARSER_CACHE_SIZE:
            parse_cache.popitem(last=False)


@app.post("/parse", response_model=ParseResponse)
async def parse(
    file: UploadFile = File(...),
    detection_tags_json: str | None = Form(default=None, alias="detectionTags"),
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
):
    if PLANT_SERVICE_TOKEN and x_internal_token != PLANT_SERVICE_TOKEN:
        raise HTTPException(401, "Não autorizado")
    if file.content_type != "application/pdf" and not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Só é suportado PDF vectorial (DWG fica para quando houver um ficheiro de exemplo)")

    file_bytes = await file.read()
    detection_tags = json.loads(detection_tags_json) if detection_tags_json else []
    cache_key, cached = _cached_payload(file_bytes, detection_tags)
    if cached is not None:
        return ParseResponse(**cached)
    async with parser_slots:
        cache_key, cached = _cached_payload(file_bytes, detection_tags)
        if cached is not None:
            return ParseResponse(**cached)
        result = await asyncio.to_thread(parse_pdf, file_bytes, None, detection_tags)
        response = build_parse_response(result)
        _store_payload(cache_key, _payload(response))
        return response


class MeasurementMapRequest(BaseModel):
    rows: list[dict]
    catalog: list[dict]


@app.post("/assist/measurement-map")
def assist_measurement_map(
    body: MeasurementMapRequest,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
):
    if PLANT_SERVICE_TOKEN and x_internal_token != PLANT_SERVICE_TOKEN:
        raise HTTPException(401, "Não autorizado")
    from measurement_map_ai import map_measurement_rows

    return map_measurement_rows(body.rows, body.catalog)


@app.post("/assist/boq-extract")
async def assist_boq_extract(
    file: UploadFile = File(...),
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
):
    """Extrai itens de um mapa de quantidades em PDF (texto + IA se necessário)."""
    if PLANT_SERVICE_TOKEN and x_internal_token != PLANT_SERVICE_TOKEN:
        raise HTTPException(401, "Não autorizado")
    filename = (file.filename or "").lower()
    if file.content_type not in ("application/pdf", "application/octet-stream") and not filename.endswith(".pdf"):
        raise HTTPException(400, "Só é suportado PDF de mapa de quantidades")
    file_bytes = await file.read()
    if len(file_bytes) > 20 * 1024 * 1024:
        raise HTTPException(400, "PDF demasiado grande (máx. 20 MB)")
    from boq_pdf_extract import extract_boq_from_pdf

    result = await asyncio.to_thread(extract_boq_from_pdf, file_bytes)
    if result.get("error") and not result.get("rows"):
        raise HTTPException(400, result["error"])
    return result


@app.post("/parse-stream")
async def parse_stream(
    file: UploadFile = File(...),
    detection_tags_json: str | None = Form(default=None, alias="detectionTags"),
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
):
    if PLANT_SERVICE_TOKEN and x_internal_token != PLANT_SERVICE_TOKEN:
        raise HTTPException(401, "Não autorizado")
    if file.content_type != "application/pdf" and not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Só é suportado PDF vectorial")

    file_bytes = await file.read()
    detection_tags = json.loads(detection_tags_json) if detection_tags_json else []

    async def stream_events():
        queue: asyncio.Queue = asyncio.Queue()
        loop = asyncio.get_running_loop()
        cache_key, cached = _cached_payload(file_bytes, detection_tags)
        if cached is not None:
            yield json.dumps({"type": "stage", "progress": 92, "message": "A reutilizar análise validada deste ficheiro"}, ensure_ascii=False) + "\n"
            yield json.dumps({"type": "result", "data": cached}, ensure_ascii=False) + "\n"
            return

        if parser_slots.locked():
            yield json.dumps({"type": "stage", "progress": 28, "message": "Análise em fila; o leitor está a concluir outro projecto"}, ensure_ascii=False) + "\n"

        await parser_slots.acquire()
        cache_key, cached = _cached_payload(file_bytes, detection_tags)
        if cached is not None:
            parser_slots.release()
            yield json.dumps({"type": "stage", "progress": 92, "message": "A reutilizar análise validada deste ficheiro"}, ensure_ascii=False) + "\n"
            yield json.dumps({"type": "result", "data": cached}, ensure_ascii=False) + "\n"
            return

        def report_progress(current_page: int, total_pages: int):
            loop.call_soon_threadsafe(
                queue.put_nowait,
                {"type": "progress", "currentPage": current_page, "totalPages": total_pages},
            )

        def run_parser():
            try:
                result = parse_pdf(file_bytes, report_progress, detection_tags)
                response = build_parse_response(result)
                payload = _payload(response)
                _store_payload(cache_key, payload)
                loop.call_soon_threadsafe(queue.put_nowait, {"type": "result", "data": payload})
            except Exception as exc:
                loop.call_soon_threadsafe(queue.put_nowait, {"type": "error", "message": str(exc)})

        parser_task = asyncio.create_task(asyncio.to_thread(run_parser))
        try:
            while True:
                message = await queue.get()
                yield json.dumps(message, ensure_ascii=False) + "\n"
                if message["type"] in ("result", "error"):
                    break
        finally:
            await parser_task
            parser_slots.release()

    return StreamingResponse(stream_events(), media_type="application/x-ndjson")

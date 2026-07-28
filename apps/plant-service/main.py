import asyncio
import json
import os

from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from pydantic import BaseModel
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

# Falhar já no arranque, não silenciosamente pedido a pedido — sem isto, um deploy em produção
# que se esquecesse de definir o token ficava a aceitar qualquer pedido sem autenticação
# interna, e ninguém dava por isso até haver um problema.
if IS_PRODUCTION and not PLANT_SERVICE_TOKEN:
    raise RuntimeError("PLANT_SERVICE_TOKEN tem de estar definido quando ENVIRONMENT=production.")


@app.get("/health")
def health():
    return {"status": "ok"}


class RoomOut(BaseModel):
    name: str
    number: str | None
    areaM2: float
    page: int
    floor: str | None


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
    staircasesCount: int
    slabsCount: int
    slabsAvgThicknessCm: float
    totalSteelWeightKg: float


class DocumentSectionOut(BaseModel):
    discipline: str
    label: str
    startPage: int
    endPage: int
    pageCount: int
    confidence: float
    evidence: list[str]


class DocumentAnalysisOut(BaseModel):
    pageCount: int
    isMultiDiscipline: bool
    sections: list[DocumentSectionOut]


class ParseResponse(BaseModel):
    metadata: MetadataOut
    rooms: list[RoomOut]
    rebarSchedules: list[RebarLineOut]
    staircases: list[StaircaseOut]
    structuralSummary: StructuralSummaryOut | None
    documentAnalysis: DocumentAnalysisOut


def build_parse_response(result) -> ParseResponse:
    summary = result.structural_summary
    document_analysis = result.document_analysis
    return ParseResponse(
        metadata=MetadataOut(**result.metadata.__dict__),
        rooms=[RoomOut(name=r.name, number=r.number, areaM2=r.area_m2, page=r.page, floor=r.floor) for r in result.rooms],
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
            totalSteelWeightKg=summary.total_steel_weight_kg,
        )
        if summary
        else None,
        documentAnalysis=DocumentAnalysisOut(
            pageCount=document_analysis.page_count,
            isMultiDiscipline=document_analysis.is_multi_discipline,
            sections=[
                DocumentSectionOut(
                    discipline=section.discipline,
                    label=section.label,
                    startPage=section.start_page,
                    endPage=section.end_page,
                    pageCount=section.page_count,
                    confidence=section.confidence,
                    evidence=section.evidence,
                )
                for section in document_analysis.sections
            ],
        ),
    )


@app.post("/parse", response_model=ParseResponse)
async def parse(
    file: UploadFile = File(...),
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
):
    if PLANT_SERVICE_TOKEN and x_internal_token != PLANT_SERVICE_TOKEN:
        raise HTTPException(401, "Não autorizado")
    if file.content_type != "application/pdf" and not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Só é suportado PDF vectorial (DWG fica para quando houver um ficheiro de exemplo)")

    file_bytes = await file.read()
    result = parse_pdf(file_bytes)

    return build_parse_response(result)


@app.post("/parse-stream")
async def parse_stream(
    file: UploadFile = File(...),
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
):
    if PLANT_SERVICE_TOKEN and x_internal_token != PLANT_SERVICE_TOKEN:
        raise HTTPException(401, "Não autorizado")
    if file.content_type != "application/pdf" and not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Só é suportado PDF vectorial")

    file_bytes = await file.read()

    async def stream_events():
        queue: asyncio.Queue = asyncio.Queue()
        loop = asyncio.get_running_loop()

        def report_progress(current_page: int, total_pages: int):
            loop.call_soon_threadsafe(
                queue.put_nowait,
                {"type": "progress", "currentPage": current_page, "totalPages": total_pages},
            )

        def run_parser():
            try:
                result = parse_pdf(file_bytes, report_progress)
                response = build_parse_response(result)
                payload = response.model_dump() if hasattr(response, "model_dump") else response.dict()
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

    return StreamingResponse(stream_events(), media_type="application/x-ndjson")

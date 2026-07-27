import os

from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from pydantic import BaseModel

from parser import parse_pdf

app = FastAPI(title="SIGA Plant Service")

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


class ParseResponse(BaseModel):
    metadata: MetadataOut
    rooms: list[RoomOut]
    rebarSchedules: list[RebarLineOut]
    staircases: list[StaircaseOut]
    structuralSummary: StructuralSummaryOut | None


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

    summary = result.structural_summary
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
    )

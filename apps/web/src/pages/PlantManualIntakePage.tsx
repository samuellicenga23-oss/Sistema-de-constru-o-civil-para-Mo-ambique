import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  classifyStructuralSteelWeights,
  roundStructuralQty,
} from "@sigo/shared";
import {
  plantsApi,
  type ExtractedRebarLine,
  type ExtractedRoom,
  type Plant,
  type PlantReviewRequest,
  type StructuralSlab,
  type StructuralSummary,
} from "../api/plants";
import Layout from "../components/Layout";
import PlantSlabManagerModal from "../components/PlantSlabManagerModal";
import { IconBack, IconPlus, IconTrash } from "../components/icons";

type RoomDraft = {
  key: string;
  id?: string;
  name: string;
  floor: string;
  areaM2: string;
  perimeterM: string;
};

function emptySummary(): StructuralSummary {
  return {
    footingsCount: 0,
    footingsAvgWidthCm: 0,
    footingsAvgLengthCm: 0,
    footingsAvgDepthCm: 0,
    columnsCount: 0,
    beamsCount: 0,
    beamsTotalLengthM: 0,
    beamsAvgWidthCm: 0,
    beamsAvgHeightCm: 0,
    beamsConcreteVolumeM3: 0,
    staircasesCount: 0,
    slabsCount: 0,
    slabsAvgThicknessCm: 0,
    slabs: [],
    footingsSteelWeightKg: 0,
    columnsSteelWeightKg: 0,
    beamsSteelWeightKg: 0,
    slabsSteelWeightKg: 0,
    totalSteelWeightKg: 0,
  };
}

function normalizeSummary(base: StructuralSummary, rebar: ExtractedRebarLine[]): StructuralSummary {
  const classified = classifyStructuralSteelWeights(
    rebar.map((line) => ({ element: line.element, weightKg: Number(line.weightKg) })),
  );
  const slabSteelFromSlabs = roundStructuralQty(
    (base.slabs ?? []).reduce(
      (sum, slab) => sum + Number(slab.topSteelWeightKg ?? 0) + Number(slab.bottomSteelWeightKg ?? 0),
      0,
    ),
  );
  const footingsSteel = roundStructuralQty(base.footingsSteelWeightKg ?? classified.footingsSteelWeightKg);
  const columnsSteel = roundStructuralQty(base.columnsSteelWeightKg ?? classified.columnsSteelWeightKg);
  const beamsSteel = roundStructuralQty(base.beamsSteelWeightKg ?? classified.beamsSteelWeightKg);
  const slabsSteel = roundStructuralQty(
    base.slabsSteelWeightKg
      || slabSteelFromSlabs
      || classified.slabsSteelWeightKg,
  );
  const total = roundStructuralQty(
    base.totalSteelWeightKg
      || footingsSteel + columnsSteel + beamsSteel + slabsSteel + classified.otherSteelWeightKg
      || classified.totalSteelWeightKg,
  );
  return {
    ...base,
    footingsAvgWidthCm: roundStructuralQty(base.footingsAvgWidthCm),
    footingsAvgLengthCm: roundStructuralQty(base.footingsAvgLengthCm),
    footingsAvgDepthCm: roundStructuralQty(base.footingsAvgDepthCm),
    beamsTotalLengthM: roundStructuralQty(base.beamsTotalLengthM),
    beamsAvgWidthCm: roundStructuralQty(base.beamsAvgWidthCm),
    beamsAvgHeightCm: roundStructuralQty(base.beamsAvgHeightCm),
    beamsConcreteVolumeM3: roundStructuralQty(base.beamsConcreteVolumeM3),
    slabsAvgThicknessCm: roundStructuralQty(base.slabsAvgThicknessCm),
    footingsSteelWeightKg: footingsSteel,
    columnsSteelWeightKg: columnsSteel,
    beamsSteelWeightKg: beamsSteel,
    slabsSteelWeightKg: slabsSteel,
    totalSteelWeightKg: total,
  };
}

function roomToDraft(room: ExtractedRoom): RoomDraft {
  return {
    key: room.id,
    id: room.id,
    name: room.name,
    floor: room.floor ?? "",
    areaM2: roundStructuralQty(Number(room.areaM2)).toFixed(2),
    perimeterM: room.perimeterM != null ? roundStructuralQty(Number(room.perimeterM)).toFixed(2) : "",
  };
}

function DecimalField({
  label,
  value,
  onChange,
  min = 0,
  step = "0.01",
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  step?: string;
}) {
  return (
    <label className="text-sm">
      {label}
      <input
        type="number"
        min={min}
        step={step}
        className="input mt-1"
        value={Number.isFinite(value) ? roundStructuralQty(value).toFixed(2) : "0.00"}
        onChange={(e) => onChange(roundStructuralQty(Number(e.target.value) || 0))}
      />
    </label>
  );
}

export default function PlantManualIntakePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [plant, setPlant] = useState<Plant | null>(null);
  const [summary, setSummary] = useState<StructuralSummary>(emptySummary());
  const [rooms, setRooms] = useState<RoomDraft[]>([]);
  const [slabs, setSlabs] = useState<StructuralSlab[]>([]);
  const [rebarSchedules, setRebarSchedules] = useState<ExtractedRebarLine[]>([]);
  const [notes, setNotes] = useState("");
  const [gaps, setGaps] = useState<string[]>([]);
  const [review, setReview] = useState<PlantReviewRequest | null>(null);
  const [slaHours, setSlaHours] = useState(5);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [slabManagerOpen, setSlabManagerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([plantsApi.detail(id), plantsApi.getReviewRequest(id)])
      .then(async ([detail, reviewState]) => {
        setPlant(detail.plant);
        setRebarSchedules(detail.rebarSchedules);
        const base = normalizeSummary(detail.plant.structuralSummary ?? emptySummary(), detail.rebarSchedules);
        setSummary(base);
        setSlabs(base.slabs ?? []);
        setRooms(detail.rooms.map(roomToDraft));
        setReview(reviewState.review);
        setSlaHours(reviewState.slaHours);
        if (!reviewState.review && (detail.plant.processingStatus === "erro" || detail.rooms.length === 0 || !base.footingsCount || !base.columnsCount)) {
          try {
            const requested = await plantsApi.requestEngineReview(id, {
              gaps: [
                detail.plant.processingStatus === "erro"
                  ? `Processamento interrompido aos ${detail.plant.processingProgress}%`
                  : "Extracção incompleta — dados a completar no formulário dedicado",
              ],
            });
            setReview(requested.review);
            setSlaHours(requested.slaHours);
            setSuccess(requested.message);
          } catch {
            // O formulário continua utilizável mesmo se o aviso ao admin falhar.
          }
        }
        const localGaps: string[] = [];
        if (detail.plant.processingStatus === "erro") {
          localGaps.push(detail.plant.errorMessage || "A análise automática foi interrompida.");
        }
        if (!base.footingsCount) localGaps.push("Sapatas por preencher");
        if (!base.columnsCount) localGaps.push("Pilares por preencher");
        if (!base.beamsCount) localGaps.push("Vigas por preencher");
        if (!(base.slabs?.length || base.slabsCount)) localGaps.push("Lajes por preencher");
        if (!detail.rooms.length) localGaps.push("Compartimentos por preencher");
        setGaps(localGaps);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Não foi possível carregar a planta"))
      .finally(() => setLoading(false));
  }, [id]);

  const floorOptions = useMemo(() => {
    const names = new Set<string>();
    for (const room of rooms) if (room.floor.trim()) names.add(room.floor.trim());
    for (const slab of slabs) if (slab.floor) names.add(slab.floor);
    if (!names.size) names.add("Piso Térreo");
    return Array.from(names);
  }, [rooms, slabs]);

  const rebarPreview = useMemo(
    () => classifyStructuralSteelWeights(rebarSchedules.map((line) => ({ element: line.element, weightKg: Number(line.weightKg) }))),
    [rebarSchedules],
  );

  const slaCopy = useMemo(
    () => `A equipa SIGO já foi notificada para melhorar a análise desta planta. Respondemos em até ${slaHours} horas e regularizamos a leitura da planta e do projecto.`,
    [slaHours],
  );

  function patchSummary(patch: Partial<StructuralSummary>, recalculateTotal = false) {
    setSummary((current) => {
      const next = { ...current, ...patch };
      if (recalculateTotal) {
        next.totalSteelWeightKg = roundStructuralQty(
          Number(next.footingsSteelWeightKg ?? 0)
          + Number(next.columnsSteelWeightKg ?? 0)
          + Number(next.beamsSteelWeightKg ?? 0)
          + Number(next.slabsSteelWeightKg ?? 0)
          + rebarPreview.otherSteelWeightKg,
        );
      }
      return next;
    });
  }

  function applySlabs(nextSlabs: StructuralSlab[]) {
    const slabsSteel = roundStructuralQty(
      nextSlabs.reduce((sum, slab) => sum + Number(slab.topSteelWeightKg ?? 0) + Number(slab.bottomSteelWeightKg ?? 0), 0),
    );
    setSlabs(nextSlabs);
    patchSummary({
      slabs: nextSlabs,
      slabsCount: nextSlabs.length,
      slabsAvgThicknessCm: nextSlabs.length
        ? roundStructuralQty(nextSlabs.reduce((sum, slab) => sum + slab.thicknessCm, 0) / nextSlabs.length)
        : 0,
      slabsSteelWeightKg: slabsSteel || summary.slabsSteelWeightKg,
    }, true);
  }

  async function handleRequestReview() {
    if (!id) return;
    setRequesting(true);
    setError(null);
    try {
      const requested = await plantsApi.requestEngineReview(id, {
        userNotes: notes.trim() || undefined,
        gaps,
      });
      setReview(requested.review);
      setSlaHours(requested.slaHours);
      setSuccess(requested.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível enviar o pedido");
    } finally {
      setRequesting(false);
    }
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (!id) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const payloadSummary: StructuralSummary = {
        ...summary,
        slabs,
        slabsCount: slabs.length || summary.slabsCount,
        slabsAvgThicknessCm: slabs.length
          ? roundStructuralQty(slabs.reduce((sum, slab) => sum + slab.thicknessCm, 0) / slabs.length)
          : summary.slabsAvgThicknessCm,
        footingsAvgWidthCm: roundStructuralQty(summary.footingsAvgWidthCm),
        footingsAvgLengthCm: roundStructuralQty(summary.footingsAvgLengthCm),
        footingsAvgDepthCm: roundStructuralQty(summary.footingsAvgDepthCm),
        beamsTotalLengthM: roundStructuralQty(summary.beamsTotalLengthM),
        footingsSteelWeightKg: roundStructuralQty(summary.footingsSteelWeightKg ?? 0),
        columnsSteelWeightKg: roundStructuralQty(summary.columnsSteelWeightKg ?? 0),
        beamsSteelWeightKg: roundStructuralQty(summary.beamsSteelWeightKg ?? 0),
        slabsSteelWeightKg: roundStructuralQty(summary.slabsSteelWeightKg ?? 0),
        totalSteelWeightKg: roundStructuralQty(summary.totalSteelWeightKg),
      };
      const result = await plantsApi.saveManualData(id, {
        structuralSummary: payloadSummary,
        rooms: rooms.map((room) => ({
          id: room.id,
          name: room.name.trim(),
          floor: room.floor.trim() || null,
          areaM2: Number(room.areaM2),
          perimeterM: room.perimeterM.trim() ? Number(room.perimeterM) : null,
          page: 1,
        })),
        userNotes: notes.trim() || undefined,
        requestEngineReview: true,
      });
      setPlant(result.plant);
      setSummary(normalizeSummary(result.plant.structuralSummary ?? payloadSummary, rebarSchedules));
      setSlabs(result.plant.structuralSummary?.slabs ?? slabs);
      setRooms(result.rooms.map(roomToDraft));
      setReview(result.review);
      setSlaHours(result.slaHours);
      setSuccess(result.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível guardar");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <Layout title="Completar dados da planta"><p className="text-sm text-slate-500">A carregar…</p></Layout>;
  }
  if (!plant) {
    return <Layout title="Completar dados da planta"><p className="text-sm text-red-600">{error ?? "Planta não encontrada"}</p></Layout>;
  }

  return (
    <Layout
      title="Completar dados da planta"
      actions={
        <div className="flex gap-2">
          <Link to={`/plantas/${plant.id}`} className="btn btn-ghost btn-sm">Ver resumo</Link>
          <Link to={`/projectos/${plant.projectId}`} className="btn btn-ghost btn-sm">
            <IconBack className="h-3.5 w-3.5" />
            Projecto
          </Link>
        </div>
      }
    >
      <form onSubmit={handleSave} className="mx-auto w-full max-w-3xl space-y-5">
        <section className="card border-blue-200 bg-blue-50 p-5">
          <h2 className="text-base font-semibold text-blue-950">Vamos regularizar a leitura desta planta</h2>
          <p className="mt-2 text-sm leading-relaxed text-blue-900">{slaCopy}</p>
          {plant.processingStatus === "erro" && (
            <p className="mt-2 text-sm text-blue-900">
              A análise parou aos <strong>{plant.processingProgress}%</strong>
              {plant.errorMessage ? ` (${plant.errorMessage})` : ""}.
            </p>
          )}
          {gaps.length > 0 && (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-blue-950">
              {gaps.map((gap) => <li key={gap}>{gap}</li>)}
            </ul>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="btn btn-secondary btn-sm" disabled={requesting || !!review} onClick={handleRequestReview}>
              {review ? "Pedido já enviado ao super admin" : requesting ? "A enviar…" : "Enviar para revisão do motor"}
            </button>
            {review && (
              <span className="badge badge-brand self-center">
                Status: {review.status} · SLA {review.slaHours}h
              </span>
            )}
          </div>
        </section>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {success && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{success}</p>}

        <section className="card card-pad space-y-4">
          <h2 className="section-title">Estrutura</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">Sapatas (quantidade)
              <input type="number" min={0} step="1" className="input mt-1" value={summary.footingsCount}
                onChange={(e) => patchSummary({ footingsCount: Math.max(0, Math.round(Number(e.target.value) || 0)) })} />
            </label>
            <DecimalField label="Largura média sapata (cm)" value={summary.footingsAvgWidthCm}
              onChange={(value) => patchSummary({ footingsAvgWidthCm: value })} />
            <DecimalField label="Comprimento médio sapata (cm)" value={summary.footingsAvgLengthCm}
              onChange={(value) => patchSummary({ footingsAvgLengthCm: value })} />
            <DecimalField label="Altura média sapata (cm)" value={summary.footingsAvgDepthCm}
              onChange={(value) => patchSummary({ footingsAvgDepthCm: value })} />
            <label className="text-sm">Pilares (quantidade)
              <input type="number" min={0} step="1" className="input mt-1" value={summary.columnsCount}
                onChange={(e) => patchSummary({ columnsCount: Math.max(0, Math.round(Number(e.target.value) || 0)) })} />
            </label>
            <label className="text-sm">Vigas (quantidade)
              <input type="number" min={0} step="1" className="input mt-1" value={summary.beamsCount}
                onChange={(e) => patchSummary({ beamsCount: Math.max(0, Math.round(Number(e.target.value) || 0)) })} />
            </label>
            <DecimalField label="Comprimento total de vigas (m)" value={summary.beamsTotalLengthM}
              onChange={(value) => patchSummary({ beamsTotalLengthM: value })} />
          </div>
        </section>

        <section className="card card-pad space-y-4">
          <div>
            <h2 className="section-title">Aço estrutural encontrado</h2>
            <p className="mt-1 text-sm text-slate-600">
              Valores lidos do mapa de aço — corriga se necessário. O total alimenta as medições e o assistente.
            </p>
          </div>
          {(rebarPreview.totalSteelWeightKg > 0 || summary.totalSteelWeightKg > 0) && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Mapa detectado: sapatas {rebarPreview.footingsSteelWeightKg.toFixed(2)} kg · pilares {rebarPreview.columnsSteelWeightKg.toFixed(2)} kg · vigas {rebarPreview.beamsSteelWeightKg.toFixed(2)} kg · lajes {rebarPreview.slabsSteelWeightKg.toFixed(2)} kg
              {rebarPreview.otherSteelWeightKg > 0 ? ` · outros ${rebarPreview.otherSteelWeightKg.toFixed(2)} kg` : ""}
              {" · "}total {rebarPreview.totalSteelWeightKg.toFixed(2)} kg
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <DecimalField
              label="Aço nas sapatas (kg)"
              value={summary.footingsSteelWeightKg ?? 0}
              onChange={(value) => patchSummary({ footingsSteelWeightKg: value }, true)}
            />
            <DecimalField
              label="Aço nos pilares (kg)"
              value={summary.columnsSteelWeightKg ?? 0}
              onChange={(value) => patchSummary({ columnsSteelWeightKg: value }, true)}
            />
            <DecimalField
              label="Aço nas vigas (kg)"
              value={summary.beamsSteelWeightKg ?? 0}
              onChange={(value) => patchSummary({ beamsSteelWeightKg: value }, true)}
            />
            <DecimalField
              label="Aço nas lajes (kg)"
              value={summary.slabsSteelWeightKg ?? 0}
              onChange={(value) => patchSummary({ slabsSteelWeightKg: value }, true)}
            />
            <DecimalField
              label="Aço total (kg)"
              value={summary.totalSteelWeightKg}
              onChange={(value) => patchSummary({ totalSteelWeightKg: value })}
            />
          </div>
        </section>

        <section className="card card-pad space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="section-title">Lajes</h2>
              <p className="mt-1 text-sm text-slate-600">
                {slabs.length} laje(s) ·{" "}
                {slabs.reduce((sum, slab) => sum + Number(slab.areaM2 ?? 0), 0).toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m²
              </p>
            </div>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setSlabManagerOpen(true)}>
              Gerir lajes
            </button>
          </div>
          {slabs.length === 0 ? (
            <p className="text-sm text-slate-500">Sem lajes registadas — use o mesmo pop-up de área, espessura e armaduras.</p>
          ) : (
            <ul className="space-y-2 text-sm text-slate-700">
              {slabs.map((slab, index) => (
                <li key={`${slab.name}-${index}`} className="rounded-lg border border-slate-200 px-3 py-2">
                  <strong>{slab.name || `Laje ${index + 1}`}</strong>
                  <span className="text-slate-500">
                    {" · "}{slab.floor || "Sem piso"}
                    {" · "}{roundStructuralQty(Number(slab.areaM2 ?? 0)).toFixed(2)} m²
                    {" · "}{roundStructuralQty(slab.thicknessCm).toFixed(2)} cm
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card card-pad space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="section-title">Compartimentos</h2>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setRooms((items) => [...items, {
                key: `new-${Date.now()}`,
                name: "",
                floor: "Piso Térreo",
                areaM2: "",
                perimeterM: "",
              }])}
            >
              <IconPlus className="h-3.5 w-3.5" /> Adicionar compartimento
            </button>
          </div>
          {rooms.length === 0 && <p className="text-sm text-slate-500">Sem compartimentos — adicione salas, WC, cozinha, etc.</p>}
          {rooms.map((room, index) => (
            <div key={room.key} className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-4">
              <input required className="input" placeholder="Nome" value={room.name}
                onChange={(e) => setRooms((items) => items.map((item, i) => i === index ? { ...item, name: e.target.value } : item))} />
              <input className="input" placeholder="Piso" value={room.floor}
                onChange={(e) => setRooms((items) => items.map((item, i) => i === index ? { ...item, floor: e.target.value } : item))} />
              <input required type="number" min={0.01} step="0.01" className="input" placeholder="Área m²" value={room.areaM2}
                onChange={(e) => setRooms((items) => items.map((item, i) => i === index ? { ...item, areaM2: e.target.value } : item))} />
              <div className="flex gap-2">
                <input type="number" min={0} step="0.01" className="input" placeholder="Perímetro m" value={room.perimeterM}
                  onChange={(e) => setRooms((items) => items.map((item, i) => i === index ? { ...item, perimeterM: e.target.value } : item))} />
                <button type="button" className="icon-btn-danger" onClick={() => setRooms((items) => items.filter((_, i) => i !== index))}>
                  <IconTrash className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </section>

        <section className="card card-pad space-y-2">
          <h2 className="section-title">Medições / notas que o sistema não leu bem</h2>
          <textarea
            className="input min-h-28"
            placeholder="Ex.: faltaram pilares do anexo, laje da cobertura com 18 cm, WC do piso 1 com 4.5 m²…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </section>

        <div className="flex flex-wrap gap-2 pb-8">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "A guardar…" : "Guardar dados e manter revisão"}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => navigate(`/plantas/${plant.id}`)}>
            Voltar ao resumo
          </button>
        </div>
      </form>

      <PlantSlabManagerModal
        open={slabManagerOpen}
        slabs={slabs}
        floorOptions={floorOptions}
        onClose={() => setSlabManagerOpen(false)}
        onChange={applySlabs}
        saveLabel="Aplicar lajes"
        onSave={() => {
          setSlabManagerOpen(false);
        }}
      />
    </Layout>
  );
}

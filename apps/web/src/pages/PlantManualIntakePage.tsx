import { FormEvent, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  classifyStructuralSteelWeights,
  ensureBeamGroupsForSlabs,
  roundStructuralQty,
  syncBeamAggregatesFromGroups,
  type StructuralBeamGroup,
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
    beamGroups: [],
    staircasesCount: 0,
    slabsCount: 0,
    slabsAvgThicknessCm: 0,
    slabs: [],
    footingsSteelWeightKg: 0,
    columnsSteelWeightKg: 0,
    beamsSteelWeightKg: 0,
    slabsSteelWeightKg: 0,
    stairsSteelWeightKg: 0,
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
  const stairsSteel = roundStructuralQty(base.stairsSteelWeightKg ?? classified.stairsSteelWeightKg);
  const beamGroups = ensureBeamGroupsForSlabs(
    {
      beamGroups: base.beamGroups ?? [],
      beamsCount: base.beamsCount,
      beamsTotalLengthM: base.beamsTotalLengthM,
      beamsAvgWidthCm: base.beamsAvgWidthCm,
      beamsAvgHeightCm: base.beamsAvgHeightCm,
      beamsSteelWeightKg: beamsSteel,
    },
    base.slabs ?? [],
  );
  const beamAgg = syncBeamAggregatesFromGroups(beamGroups);
  const total = roundStructuralQty(
    base.totalSteelWeightKg
      || footingsSteel + columnsSteel + beamAgg.beamsSteelWeightKg + slabsSteel + stairsSteel + classified.otherSteelWeightKg
      || classified.totalSteelWeightKg,
  );
  return {
    ...base,
    ...beamAgg,
    beamGroups,
    footingsAvgWidthCm: roundStructuralQty(base.footingsAvgWidthCm),
    footingsAvgLengthCm: roundStructuralQty(base.footingsAvgLengthCm),
    footingsAvgDepthCm: roundStructuralQty(base.footingsAvgDepthCm),
    slabsAvgThicknessCm: roundStructuralQty(base.slabsAvgThicknessCm),
    footingsSteelWeightKg: footingsSteel,
    columnsSteelWeightKg: columnsSteel,
    beamsSteelWeightKg: beamAgg.beamsSteelWeightKg,
    slabsSteelWeightKg: slabsSteel,
    stairsSteelWeightKg: stairsSteel,
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
  hint,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  step?: string;
  hint?: string;
}) {
  return (
    <label className="text-sm">
      <span className="font-medium text-slate-800">{label}</span>
      {hint && <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>}
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

function FamilyCard({
  id,
  title,
  subtitle,
  children,
}: {
  id: string;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="card scroll-mt-24 overflow-hidden">
      <div className="border-b border-slate-100 bg-slate-50 px-5 py-3">
        <h2 className="text-base font-semibold text-slate-950">{title}</h2>
        <p className="mt-0.5 text-sm text-slate-600">{subtitle}</p>
      </div>
      <div className="space-y-4 p-5">{children}</div>
    </section>
  );
}

export default function PlantManualIntakePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [plant, setPlant] = useState<Plant | null>(null);
  const [summary, setSummary] = useState<StructuralSummary>(emptySummary());
  const [rooms, setRooms] = useState<RoomDraft[]>([]);
  const [slabs, setSlabs] = useState<StructuralSlab[]>([]);
  const [beamGroups, setBeamGroups] = useState<StructuralBeamGroup[]>([]);
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
        setBeamGroups(base.beamGroups ?? []);
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
        if (!base.beamsCount && !(base.beamGroups?.length)) localGaps.push("Vigas por preencher");
        if (!(base.slabs?.length || base.slabsCount)) localGaps.push("Lajes por preencher");
        if (!detail.rooms.length) localGaps.push("Compartimentos por preencher");
        setGaps(localGaps);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Não foi possível carregar a planta"))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (loading || !location.hash) return;
    const el = document.querySelector(location.hash);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [loading, location.hash]);

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

  const steelTotalPreview = useMemo(
    () => roundStructuralQty(
      Number(summary.footingsSteelWeightKg ?? 0)
      + Number(summary.columnsSteelWeightKg ?? 0)
      + Number(summary.beamsSteelWeightKg ?? 0)
      + Number(summary.slabsSteelWeightKg ?? 0)
      + Number(summary.stairsSteelWeightKg ?? 0)
      + rebarPreview.otherSteelWeightKg,
    ),
    [summary, rebarPreview.otherSteelWeightKg],
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
          + Number(next.stairsSteelWeightKg ?? 0)
          + rebarPreview.otherSteelWeightKg,
        );
      }
      return next;
    });
  }

  function applyBeamGroups(nextGroups: StructuralBeamGroup[]) {
    const agg = syncBeamAggregatesFromGroups(nextGroups);
    setBeamGroups(nextGroups);
    patchSummary({ beamGroups: nextGroups, ...agg }, true);
  }

  function updateBeamGroup(index: number, patch: Partial<StructuralBeamGroup>) {
    applyBeamGroups(beamGroups.map((group, i) => (i === index ? { ...group, ...patch } : group)));
  }

  function applySlabs(nextSlabs: StructuralSlab[]) {
    const slabsSteel = roundStructuralQty(
      nextSlabs.reduce((sum, slab) => sum + Number(slab.topSteelWeightKg ?? 0) + Number(slab.bottomSteelWeightKg ?? 0), 0),
    );
    const nextGroups = ensureBeamGroupsForSlabs(
      {
        beamGroups: beamGroups.length ? beamGroups : (summary.beamGroups ?? []),
        beamsCount: summary.beamsCount,
        beamsTotalLengthM: summary.beamsTotalLengthM,
        beamsAvgWidthCm: summary.beamsAvgWidthCm,
        beamsAvgHeightCm: summary.beamsAvgHeightCm,
        beamsSteelWeightKg: summary.beamsSteelWeightKg,
      },
      nextSlabs,
    );
    setSlabs(nextSlabs);
    setBeamGroups(nextGroups);
    const beamAgg = syncBeamAggregatesFromGroups(nextGroups);
    patchSummary({
      slabs: nextSlabs,
      slabsCount: nextSlabs.length,
      slabsAvgThicknessCm: nextSlabs.length
        ? roundStructuralQty(nextSlabs.reduce((sum, slab) => sum + slab.thicknessCm, 0) / nextSlabs.length)
        : 0,
      slabsSteelWeightKg: slabsSteel || summary.slabsSteelWeightKg,
      beamGroups: nextGroups,
      ...beamAgg,
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

  async function persist(keepReview: boolean) {
    if (!id) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const beamAgg = syncBeamAggregatesFromGroups(beamGroups);
      const payloadSummary: StructuralSummary = {
        ...summary,
        ...beamAgg,
        beamGroups,
        slabs,
        slabsCount: slabs.length || summary.slabsCount,
        slabsAvgThicknessCm: slabs.length
          ? roundStructuralQty(slabs.reduce((sum, slab) => sum + slab.thicknessCm, 0) / slabs.length)
          : summary.slabsAvgThicknessCm,
        footingsAvgWidthCm: roundStructuralQty(summary.footingsAvgWidthCm),
        footingsAvgLengthCm: roundStructuralQty(summary.footingsAvgLengthCm),
        footingsAvgDepthCm: roundStructuralQty(summary.footingsAvgDepthCm),
        footingsSteelWeightKg: roundStructuralQty(summary.footingsSteelWeightKg ?? 0),
        columnsSteelWeightKg: roundStructuralQty(summary.columnsSteelWeightKg ?? 0),
        beamsSteelWeightKg: beamAgg.beamsSteelWeightKg,
        slabsSteelWeightKg: roundStructuralQty(summary.slabsSteelWeightKg ?? 0),
        stairsSteelWeightKg: roundStructuralQty(summary.stairsSteelWeightKg ?? 0),
        staircasesCount: summary.staircasesCount,
        totalSteelWeightKg: roundStructuralQty(
          Number(summary.footingsSteelWeightKg ?? 0)
          + Number(summary.columnsSteelWeightKg ?? 0)
          + beamAgg.beamsSteelWeightKg
          + Number(summary.slabsSteelWeightKg ?? 0)
          + Number(summary.stairsSteelWeightKg ?? 0)
          + rebarPreview.otherSteelWeightKg,
        ),
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
        requestEngineReview: keepReview,
      });
      const next = normalizeSummary(result.plant.structuralSummary ?? payloadSummary, rebarSchedules);
      setPlant(result.plant);
      setSummary(next);
      setSlabs(next.slabs ?? slabs);
      setBeamGroups(next.beamGroups ?? beamGroups);
      setRooms(result.rooms.map(roomToDraft));
      setReview(result.review);
      setSlaHours(result.slaHours);
      setSuccess(result.message || (keepReview ? "Dados guardados. A revisão do motor mantém-se activa." : "Dados guardados."));
      if (!keepReview) navigate(`/plantas/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível guardar");
    } finally {
      setSaving(false);
    }
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    await persist(true);
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
      subtitle="Um bloco por família estrutural — medidas e aço juntos, como no mapa de quantidades"
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
      <form onSubmit={handleSave} className="mx-auto w-full max-w-3xl space-y-5 pb-28">
        {error && <p className="text-sm text-red-600">{error}</p>}
        {success && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{success}</p>}

        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
          <strong className="text-slate-950">Armadura identificada (mapa)</strong>
          <p className="mt-1 tabular-nums text-xs text-slate-600 sm:text-sm">
            Sapatas {rebarPreview.footingsSteelWeightKg.toFixed(2)} kg · Pilares {rebarPreview.columnsSteelWeightKg.toFixed(2)} kg · Vigas {rebarPreview.beamsSteelWeightKg.toFixed(2)} kg · Lajes {rebarPreview.slabsSteelWeightKg.toFixed(2)} kg · Escadas {rebarPreview.stairsSteelWeightKg.toFixed(2)} kg
            {rebarPreview.otherSteelWeightKg > 0 ? ` · Outros ${rebarPreview.otherSteelWeightKg.toFixed(2)} kg` : ""}
            {" · "}Total {rebarPreview.totalSteelWeightKg.toFixed(2)} kg
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Valores editáveis abaixo por família. Total de trabalho: <strong className="tabular-nums text-slate-800">{steelTotalPreview.toFixed(2)} kg</strong>
          </p>
        </div>

        <FamilyCard
          id="sapatas"
          title="1. Sapatas / fundações"
          subtitle="Quantidade, medidas médias e kg de aço desta família"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="font-medium text-slate-800">Quantidade de sapatas</span>
              <input
                type="number"
                min={0}
                step="1"
                className="input mt-1"
                value={summary.footingsCount}
                onChange={(e) => patchSummary({ footingsCount: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
              />
            </label>
            <DecimalField
              label="Aço nas sapatas (kg)"
              value={summary.footingsSteelWeightKg ?? 0}
              onChange={(value) => patchSummary({ footingsSteelWeightKg: value }, true)}
              hint="Do mapa de aço · fundações"
            />
            <DecimalField label="Largura média (cm)" value={summary.footingsAvgWidthCm} onChange={(value) => patchSummary({ footingsAvgWidthCm: value })} />
            <DecimalField label="Comprimento médio (cm)" value={summary.footingsAvgLengthCm} onChange={(value) => patchSummary({ footingsAvgLengthCm: value })} />
            <DecimalField label="Altura / profundidade média (cm)" value={summary.footingsAvgDepthCm} onChange={(value) => patchSummary({ footingsAvgDepthCm: value })} />
          </div>
        </FamilyCard>

        <FamilyCard
          id="pilares"
          title="2. Pilares"
          subtitle="Contagem e armadura longitudinal dos pilares"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="font-medium text-slate-800">Quantidade de pilares</span>
              <input
                type="number"
                min={0}
                step="1"
                className="input mt-1"
                value={summary.columnsCount}
                onChange={(e) => patchSummary({ columnsCount: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
              />
            </label>
            <DecimalField
              label="Aço nos pilares (kg)"
              value={summary.columnsSteelWeightKg ?? 0}
              onChange={(value) => patchSummary({ columnsSteelWeightKg: value }, true)}
              hint="Do mapa de aço · pilares/pilaretes"
            />
          </div>
        </FamilyCard>

        <FamilyCard
          id="vigas"
          title="3. Vigas por laje"
          subtitle="Cada grupo identifica as vigas da respectiva laje (nível) — qtd, comprimento, secção e aço"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-500">
              Total: {summary.beamsCount} viga(s) · {roundStructuralQty(summary.beamsTotalLengthM).toFixed(2)} ml · {roundStructuralQty(summary.beamsSteelWeightKg ?? 0).toFixed(2)} kg
            </p>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                const index = beamGroups.length;
                applyBeamGroups([
                  ...beamGroups,
                  {
                    id: `beam-group-${Date.now()}`,
                    label: `Vigas da Laje ${index + 1}`,
                    slabIndex: index,
                    floor: slabs[index]?.floor ?? null,
                    beamsCount: 0,
                    totalLengthM: 0,
                    avgWidthCm: summary.beamsAvgWidthCm || 20,
                    avgHeightCm: summary.beamsAvgHeightCm || 40,
                    steelWeightKg: 0,
                  },
                ]);
              }}
            >
              <IconPlus className="h-3.5 w-3.5" /> Grupo de vigas
            </button>
          </div>

          {beamGroups.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
              Ainda sem grupos. Crie lajes abaixo ou adicione «Vigas da Laje 1», «Vigas da Laje 2», etc.
            </p>
          ) : (
            <ul className="space-y-3">
              {beamGroups.map((group, index) => (
                <li key={group.id ?? `g-${index}`} className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <input
                      className="input font-semibold"
                      value={group.label}
                      onChange={(e) => updateBeamGroup(index, { label: e.target.value })}
                      placeholder={`Vigas da Laje ${index + 1}`}
                    />
                    <button
                      type="button"
                      className="icon-btn-danger shrink-0"
                      aria-label="Eliminar grupo"
                      onClick={() => applyBeamGroups(beamGroups.filter((_, i) => i !== index))}
                    >
                      <IconTrash className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <label className="text-sm">
                      Laje / piso
                      <select
                        className="input mt-1"
                        value={group.floor ?? ""}
                        onChange={(e) => {
                          const floor = e.target.value || null;
                          const slabIndex = slabs.findIndex((slab) => (slab.floor || "") === (floor || ""));
                          const slab = slabIndex >= 0 ? slabs[slabIndex] : null;
                          updateBeamGroup(index, {
                            floor,
                            slabIndex: slabIndex >= 0 ? slabIndex : undefined,
                            label: slab
                              ? `Vigas da ${slab.name || slab.floor || `Laje ${slabIndex + 1}`}`
                              : group.label,
                          });
                        }}
                      >
                        <option value="">Sem piso</option>
                        {floorOptions.map((floor) => (
                          <option key={floor} value={floor}>{floor}</option>
                        ))}
                      </select>
                    </label>
                    <label className="text-sm">
                      Nº de vigas
                      <input
                        type="number"
                        min={0}
                        step="1"
                        className="input mt-1"
                        value={group.beamsCount}
                        onChange={(e) => updateBeamGroup(index, { beamsCount: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                      />
                    </label>
                    <DecimalField
                      label="Comprimento total (m)"
                      value={group.totalLengthM}
                      onChange={(value) => updateBeamGroup(index, { totalLengthM: value })}
                    />
                    <DecimalField
                      label="Largura média (cm)"
                      value={group.avgWidthCm ?? 0}
                      onChange={(value) => updateBeamGroup(index, { avgWidthCm: value })}
                    />
                    <DecimalField
                      label="Altura média (cm)"
                      value={group.avgHeightCm ?? 0}
                      onChange={(value) => updateBeamGroup(index, { avgHeightCm: value })}
                    />
                    <DecimalField
                      label="Aço deste grupo (kg)"
                      value={group.steelWeightKg ?? 0}
                      onChange={(value) => updateBeamGroup(index, { steelWeightKg: value })}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </FamilyCard>

        <FamilyCard
          id="lajes"
          title="4. Lajes"
          subtitle="Área, espessura e armadura superior/inferior — mesmo pop-up de gestão"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-slate-600">
              {slabs.length} laje(s) ·{" "}
              {slabs.reduce((sum, slab) => sum + Number(slab.areaM2 ?? 0), 0).toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m² · aço{" "}
              {roundStructuralQty(summary.slabsSteelWeightKg ?? 0).toFixed(2)} kg
            </p>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setSlabManagerOpen(true)}>
              Gerir lajes
            </button>
          </div>
          {slabs.length === 0 ? (
            <p className="text-sm text-slate-500">Sem lajes — abra o pop-up para definir Laje 1, 2, 3…</p>
          ) : (
            <ul className="space-y-2 text-sm text-slate-700">
              {slabs.map((slab, index) => (
                <li key={`${slab.name}-${index}`} className="rounded-lg border border-slate-200 px-3 py-2">
                  <strong>{slab.name || `Laje ${index + 1}`}</strong>
                  <span className="text-slate-500">
                    {" · "}{slab.floor || "Sem piso"}
                    {" · "}{roundStructuralQty(Number(slab.areaM2 ?? 0)).toFixed(2)} m²
                    {" · "}{roundStructuralQty(slab.thicknessCm).toFixed(2)} cm
                    {" · "}{roundStructuralQty(Number(slab.topSteelWeightKg ?? 0) + Number(slab.bottomSteelWeightKg ?? 0)).toFixed(2)} kg
                  </span>
                </li>
              ))}
            </ul>
          )}
          <DecimalField
            label="Aço total nas lajes (kg)"
            value={summary.slabsSteelWeightKg ?? 0}
            onChange={(value) => patchSummary({ slabsSteelWeightKg: value }, true)}
            hint="Pode sobrescrever a soma das lajes se o mapa trouxer um total diferent"
          />
        </FamilyCard>

        <FamilyCard
          id="escadas"
          title="5. Escadas"
          subtitle="Se existirem escadas no projecto estrutural — quantidade e aço separado do total"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="font-medium text-slate-800">Quantidade de escadas</span>
              <input
                type="number"
                min={0}
                step="1"
                className="input mt-1"
                value={summary.staircasesCount}
                onChange={(e) => patchSummary({ staircasesCount: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
              />
            </label>
            <DecimalField
              label="Aço nas escadas (kg)"
              value={summary.stairsSteelWeightKg ?? 0}
              onChange={(value) => patchSummary({ stairsSteelWeightKg: value }, true)}
              hint="Rótulos Escada 1, Escada 2… no mapa de aço"
            />
          </div>
        </FamilyCard>

        <FamilyCard
          id="compartimentos"
          title="6. Compartimentos"
          subtitle="Áreas de arquitectura — salas, WC, cozinha, etc."
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-slate-500">{rooms.length} compartimento(s)</p>
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
              <IconPlus className="h-3.5 w-3.5" /> Adicionar
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
        </FamilyCard>

        <FamilyCard
          id="notas"
          title="7. Notas de medição"
          subtitle="O que o leitor não captou bem — fica no pedido de regularização"
        >
          <textarea
            className="input min-h-28"
            placeholder="Ex.: faltaram pilares do anexo; laje da cobertura com 18 cm; aço da Escada 1 no mapa…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </FamilyCard>

        <section id="regularizacao" className="card scroll-mt-24 border-slate-200 bg-slate-50 p-5">
          <h2 className="text-base font-semibold text-slate-950">Regularização do leitor (último passo)</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-700">
            A equipa SIGO já pode melhorar a análise desta planta (SLA até {slaHours}h). Isto é independente de guardar as suas medições.
          </p>
          {gaps.length > 0 && (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-800">
              {gaps.map((gap) => <li key={gap}>{gap}</li>)}
            </ul>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="btn btn-secondary btn-sm" disabled={requesting || !!review} onClick={handleRequestReview}>
              {review ? "Pedido já enviado ao super admin" : requesting ? "A enviar…" : "Pedir revisão do motor"}
            </button>
            {review && (
              <span className="badge badge-brand self-center">
                Status: {review.status} · SLA {review.slaHours}h
              </span>
            )}
          </div>
        </section>
      </form>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate(`/plantas/${plant.id}`)}>
            Voltar ao resumo
          </button>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => void persist(false)}>
              {saving ? "A guardar…" : "Guardar dados"}
            </button>
            <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void persist(true)}>
              {saving ? "A guardar…" : "Guardar e manter revisão"}
            </button>
          </div>
        </div>
      </div>

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

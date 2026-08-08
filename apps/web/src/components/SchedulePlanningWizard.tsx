import { useEffect, useState, type ReactNode } from "react";
import {
  scheduleApi,
  type PlanningTrade,
  type ProjectSchedule,
  type SchedulePlanningPreview,
  type SchedulePlanningProfile,
  type SchedulePlanningQuestion,
  type SchedulePlanningSetup,
} from "../api/schedule";
import AlertBanner from "./AlertBanner";

const TRADE_LABELS: Record<PlanningTrade, string> = {
  earthworks: "Movimentos de terra / fundações",
  structure: "Estrutura",
  masonry: "Alvenarias",
  mep: "Instalações",
  finishes: "Acabamentos",
  roofing: "Cobertura",
  external: "Trabalhos exteriores",
};

type BudgetOption = { id: string; title: string; status: string };

type Props = {
  projectId: string;
  documents: BudgetOption[];
  documentId: string;
  startDate: string;
  hasExistingSchedule: boolean;
  onDocumentIdChange: (value: string) => void;
  onStartDateChange: (value: string) => void;
  beforeGenerate?: () => Promise<boolean>;
  onGenerated: (schedule: ProjectSchedule) => void;
  onClose?: () => void;
};

export default function SchedulePlanningWizard(props: Props) {
  const [setup, setSetup] = useState<SchedulePlanningSetup | null>(null);
  const [profile, setProfile] = useState<SchedulePlanningProfile | null>(null);
  const [preview, setPreview] = useState<SchedulePlanningPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.documentId || !props.startDate) {
      setSetup(null);
      setProfile(null);
      setPreview(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    scheduleApi.planningSetup(props.projectId, { budgetDocumentId: props.documentId, startDate: props.startDate })
      .then((result) => {
        if (!active) return;
        setSetup(result);
        setProfile(result.profile);
        setPreview(null);
      })
      .catch((cause) => active && setError(cause instanceof Error ? cause.message : "Erro ao carregar o Assistente de Planeamento"))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [props.projectId, props.documentId, props.startDate]);

  function updateProfile(update: (current: SchedulePlanningProfile) => SchedulePlanningProfile) {
    setProfile((current) => current ? update(current) : current);
    setPreview(null);
  }

  async function previewStrategy() {
    if (!profile) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await scheduleApi.savePlanningProfile(props.projectId, { budgetDocumentId: props.documentId, profile: { ...profile, startDate: props.startDate } });
      setProfile(saved.profile);
      const result = await scheduleApi.previewPlanning(props.projectId, { budgetDocumentId: props.documentId, startDate: props.startDate });
      setPreview(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível pré-visualizar a estratégia");
    } finally {
      setSaving(false);
    }
  }

  async function generateEap() {
    if (!preview?.readyToGenerate || !preview.previewFingerprint) return;
    if (props.beforeGenerate && !(await props.beforeGenerate())) return;
    setSaving(true);
    setError(null);
    try {
      const schedule = await scheduleApi.generate(props.projectId, {
        budgetDocumentId: props.documentId,
        startDate: props.startDate,
        previewFingerprint: preview.previewFingerprint,
      });
      props.onGenerated(schedule);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível gerar a EAP");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-blue-700">Assistente de Planeamento</p>
            <h3 className="mt-1 text-lg font-semibold text-slate-950">Do mapa aprovado ao plano de execução</h3>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">O BOQ define o âmbito. As respostas abaixo definem apenas a forma real de executar esse âmbito.</p>
          </div>
          {props.onClose && <button type="button" className="btn btn-ghost btn-sm" onClick={props.onClose}>Fechar</button>}
        </div>
        <Stepper stage={preview ? 3 : profile ? 2 : 1} />
      </div>

      <div className="space-y-5 p-5">
        {error && <AlertBanner tone="error" onDismiss={() => setError(null)}>{error}</AlertBanner>}

        <div className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4 md:grid-cols-[1fr_190px]">
          <div>
            <label className="label">Mapa de Quantidades aprovado</label>
            <select className="input" value={props.documentId} onChange={(event) => props.onDocumentIdChange(event.target.value)}>
              <option value="">Seleccionar...</option>
              {props.documents.filter((document) => document.status === "aprovado").map((document) => <option key={document.id} value={document.id}>{document.title}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Início planeado</label>
            <input className="input" type="date" value={props.startDate} onChange={(event) => props.onStartDateChange(event.target.value)} />
          </div>
        </div>

        {loading && <p className="text-sm text-slate-500">A analisar o mapa aprovado…</p>}

        {setup && profile && !loading && (
          <>
            <div className="flex flex-wrap gap-2 text-xs text-slate-600">
              <Pill>{setup.context.measuredItemCount} linhas medidas</Pill>
              <Pill>{setup.context.floors} piso(s)</Pill>
              <Pill>{setup.context.supportsFloorPlanning ? "Metadados seguros para repartição" : "Hierarquia contratual preservada"}</Pill>
              {setup.context.detectedRoofKind !== "unknown" && <Pill>Cobertura: {setup.context.detectedRoofKind === "sheet" ? "chapa/telha" : "laje"}</Pill>}
            </div>

            {setup.validationErrors.length > 0 && <AlertBanner tone="warning"><ul className="list-disc pl-5">{setup.validationErrors.map((message) => <li key={message}>{message}</li>)}</ul></AlertBanner>}

            <div className="space-y-4">
              {setup.questions.map((question) => <QuestionCard key={question.key} question={question} profile={profile} context={setup.context} updateProfile={updateProfile} />)}
            </div>

            <div className="flex justify-end border-t border-slate-100 pt-4">
              <button type="button" className="btn btn-primary" disabled={saving} onClick={previewStrategy}>{saving ? "A validar…" : "Pré-visualizar estratégia"}</button>
            </div>
          </>
        )}

        {preview && <PreviewPanel preview={preview} saving={saving} hasExistingSchedule={props.hasExistingSchedule} onBack={() => setPreview(null)} onGenerate={generateEap} />}
      </div>
    </div>
  );
}

function QuestionCard({ question, profile, context, updateProfile }: {
  question: SchedulePlanningQuestion;
  profile: SchedulePlanningProfile;
  context: SchedulePlanningSetup["context"];
  updateProfile: (update: (current: SchedulePlanningProfile) => SchedulePlanningProfile) => void;
}) {
  if (question.kind === "zones" && profile.locationStrategy !== "floors_zones") return null;
  if ((question.kind === "floor_labels" || question.kind === "shares") && profile.locationStrategy === "boq") return null;
  return (
    <section className="rounded-xl border border-slate-200 p-4">
      <div className="mb-3"><p className="text-sm font-semibold text-slate-900">{question.label}</p><p className="mt-1 text-xs leading-relaxed text-slate-500">{question.help}</p></div>
      {question.kind === "choice" && question.options && <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{question.options.map((option) => {
        const current = question.key === "locationStrategy" ? profile.locationStrategy : question.key === "sequencePolicy" ? profile.sequencePolicy : profile.roofKindOverride;
        return <button key={option.value} type="button" className={`rounded-lg border p-3 text-left text-sm font-semibold ${current === option.value ? "border-blue-400 bg-blue-50 text-blue-900" : "border-slate-200 text-slate-800"}`} onClick={() => updateProfile((value) => {
          if (question.key === "locationStrategy") return { ...value, locationStrategy: option.value as SchedulePlanningProfile["locationStrategy"] };
          if (question.key === "sequencePolicy") return { ...value, sequencePolicy: option.value as SchedulePlanningProfile["sequencePolicy"] };
          return { ...value, roofKindOverride: option.value as "sheet" | "slab" };
        })}>{option.label}</button>;
      })}</div>}

      {question.kind === "floor_labels" && <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{profile.floorLabels.map((label, index) => <label key={`floor-label-${index}`} className="text-xs text-slate-500">Piso {index}<input className="input mt-1" value={label} onChange={(event) => updateProfile((value) => ({ ...value, floorLabels: value.floorLabels.map((row, i) => i === index ? event.target.value : row) }))} /></label>)}</div>}
      {question.kind === "shares" && <div><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{profile.floorLabels.map((label, index) => <label key={`${label}-${index}`} className="text-xs text-slate-500">{label}<div className="relative mt-1"><input className="input pr-8" type="number" min="0" max="100" step="0.1" placeholder="%" value={profile.floorShares ? (profile.floorShares[index] * 100).toFixed(2).replace(/\.00$/, "") : ""} onChange={(event) => updateProfile((value) => {
        const next = value.floorShares ? [...value.floorShares] : value.floorLabels.map(() => 0);
        next[index] = Number(event.target.value || 0) / 100;
        return { ...value, floorShares: next };
      })} /><span className="absolute right-3 top-2.5 text-xs text-slate-400">%</span></div></label>)}</div><button type="button" className="mt-2 text-xs font-semibold text-blue-700 hover:underline" onClick={() => updateProfile((value) => ({ ...value, floorShares: null }))}>Não sei — assumir uniforme e marcar como hipótese</button></div>}

      {question.kind === "zones" && <div className="space-y-2">{profile.zones.map((zone, index) => <div key={zone.id} className="grid gap-2 sm:grid-cols-[1fr_130px_auto]"><input className="input" value={zone.label} onChange={(event) => updateProfile((value) => ({ ...value, zones: value.zones.map((row, i) => i === index ? { ...row, label: event.target.value } : row) }))} /><div className="relative"><input className="input pr-8" type="number" min="0" max="100" step="0.1" placeholder="%" value={zone.share === null ? "" : zone.share * 100} onChange={(event) => updateProfile((value) => ({ ...value, zones: value.zones.map((row, i) => i === index ? { ...row, share: event.target.value ? Number(event.target.value) / 100 : null } : row) }))} /><span className="absolute right-3 top-2.5 text-xs text-slate-400">%</span></div><button type="button" className="btn btn-ghost" onClick={() => updateProfile((value) => ({ ...value, zones: value.zones.filter((_, i) => i !== index) }))}>Remover</button></div>)}<button type="button" className="btn btn-secondary btn-sm" onClick={() => updateProfile((value) => ({ ...value, zones: [...value.zones, { id: `zona-${value.zones.length + 1}`, label: `Zona ${value.zones.length + 1}`, share: null }] }))}>+ Adicionar zona</button></div>}

      {question.kind === "trade_matrix" && <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-slate-500"><th className="pb-2">Especialidade</th><th className="pb-2">Trabalhadores / frente</th><th className="pb-2">Frentes simultâneas</th></tr></thead><tbody className="divide-y divide-slate-100">{context.activeTrades.map((trade) => <tr key={trade}><td className="py-2 font-medium text-slate-800">{TRADE_LABELS[trade]}</td><td className="py-2 pr-3"><input className="input w-32" type="number" min="1" max="60" placeholder="12 assumidos" value={profile.crewSizes[trade] ?? ""} onChange={(event) => updateProfile((value) => ({ ...value, crewSizes: { ...value.crewSizes, [trade]: event.target.value ? Number(event.target.value) : null } }))} /></td><td className="py-2"><input className="input w-28" type="number" min="1" max="20" placeholder="1 assumida" value={profile.tradeFronts[trade] ?? ""} onChange={(event) => updateProfile((value) => ({ ...value, tradeFronts: { ...value.tradeFronts, [trade]: event.target.value ? Math.max(1, Number(event.target.value)) : null } }))} /></td></tr>)}</tbody></table></div>}

      {question.kind === "lags" && <div className="grid gap-2 sm:grid-cols-3">{([['foundations','Fundações'],['columns','Pilares'],['slabs','Lajes']] as const).map(([key, label]) => <label key={key} className="text-xs text-slate-500">{label}<div className="relative mt-1"><input className="input pr-12" type="number" min="0" max="60" placeholder="Automático" value={profile.cureLags[key] ?? ""} onChange={(event) => updateProfile((value) => ({ ...value, cureLags: { ...value.cureLags, [key]: event.target.value ? Number(event.target.value) : null } }))} /><span className="absolute right-3 top-2.5 text-xs text-slate-400">d.u.</span></div></label>)}</div>}

      {question.kind === "integer" && <div className="max-w-xs"><input className="input" type="number" min="7" max="3650" placeholder="Sem prazo imposto" value={profile.targetDurationDays ?? ""} onChange={(event) => updateProfile((value) => ({ ...value, targetDurationDays: event.target.value ? Number(event.target.value) : null }))} /></div>}

      {question.kind === "notice" && <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{question.help}</div>}
    </section>
  );
}

function PreviewPanel({ preview, saving, hasExistingSchedule, onBack, onGenerate }: { preview: SchedulePlanningPreview; saving: boolean; hasExistingSchedule: boolean; onBack: () => void; onGenerate: () => void }) {
  return <section className="space-y-4 border-t border-slate-100 pt-5">
    <div><h4 className="text-base font-semibold text-slate-950">Pré-visualização da estratégia</h4><p className="text-sm text-slate-500">Esta é a estratégia exacta que o backend irá aceitar para geração.</p></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Card label="Organização" value={preview.strategy.locationStrategy === 'floors_zones' ? 'Piso + zona' : preview.strategy.locationStrategy === 'floors' ? 'Por piso' : 'BOQ'} /><Card label="Sequência" value={preview.strategy.sequencePolicy === 'floor_by_floor' ? 'Piso a piso' : 'Estrutura completa primeiro'} /><Card label="Prazo natural" value={`${preview.naturalDurationDays} d.u.`} /><Card label="Prazo planeado" value={`${preview.plannedDurationDays} d.u.`} note={preview.targetDurationDays ? `Meta: ${preview.targetDurationDays} d.u.` : undefined} /></div>
    <div className="grid gap-3 sm:grid-cols-3"><Metric label="Actividades" value={preview.validation.activityCount} /><Metric label="Dependências" value={preview.validation.dependencyCount} /><Metric label="Cobertura BOQ" value={`${preview.validation.coverage.plannedSourceLineItemCount}/${preview.validation.coverage.measuredSourceLineItemCount}`} /></div>
    <div className="max-h-72 overflow-auto rounded-xl border border-slate-200"><table className="w-full text-sm"><thead className="sticky top-0 bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-3 py-2">WBS</th><th className="px-3 py-2">Actividade</th><th className="px-3 py-2">Duração</th><th className="px-3 py-2">Base</th><th className="px-3 py-2">Repartição</th></tr></thead><tbody className="divide-y divide-slate-100">{preview.validation.sampleActivities.map((activity) => <tr key={`${activity.code}-${activity.name}`}><td className="px-3 py-2 font-mono text-xs font-semibold text-blue-700">{activity.code}</td><td className="px-3 py-2">{activity.name}</td><td className="px-3 py-2">{activity.durationDays} d</td><td className="px-3 py-2">{activity.durationBasis}</td><td className="px-3 py-2">{activity.allocationBasis}</td></tr>)}</tbody></table></div>
    {preview.assumptions.length > 0 && <AlertBanner tone="info"><div><p className="font-semibold">Hipóteses registadas</p><ul className="mt-1 list-disc pl-5">{preview.assumptions.map((value) => <li key={value}>{value}</li>)}</ul></div></AlertBanner>}
    {preview.warnings.length > 0 && <AlertBanner tone="warning"><div><p className="font-semibold">Avisos técnicos</p><ul className="mt-1 list-disc pl-5">{preview.warnings.slice(0, 8).map((warning, index) => <li key={`${warning.code}-${index}`}>{warning.message}</li>)}</ul></div></AlertBanner>}
    {!preview.valid && <AlertBanner tone="error"><ul className="list-disc pl-5">{preview.errors.map((value) => <li key={value}>{value}</li>)}</ul></AlertBanner>}
    <div className="flex items-center justify-between gap-3"><button type="button" className="btn btn-secondary" onClick={onBack}>Alterar estratégia</button><div className="text-right"><p className="mb-2 text-xs text-slate-500">Gerar EAP → validação automática → cronograma</p><button type="button" className="btn btn-primary" disabled={saving || !preview.readyToGenerate} onClick={onGenerate}>{saving ? 'A gerar…' : hasExistingSchedule ? 'Recriar EAP validada' : 'Gerar EAP validada'}</button></div></div>
  </section>;
}

function Stepper({ stage }: { stage: number }) { const labels = ["Mapa aprovado", "Assistente", "Pré-visualização", "Gerar EAP", "Validação", "Cronograma"]; return <div className="mt-4 grid gap-1 sm:grid-cols-3 xl:grid-cols-6">{labels.map((label, index) => <div key={label} className={`flex items-center gap-2 rounded-lg px-2 py-2 text-xs ${index + 1 <= stage ? 'bg-blue-50 font-semibold text-blue-800' : 'bg-slate-50 text-slate-400'}`}><span className={`grid h-5 w-5 place-items-center rounded-full text-[10px] ${index + 1 <= stage ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-500'}`}>{index + 1}</span><span className="truncate">{label}</span></div>)}</div>; }
function Pill({ children }: { children: ReactNode }) { return <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">{children}</span>; }
function Card({ label, value, note }: { label: string; value: string; note?: string }) { return <div className="rounded-xl border border-slate-200 p-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-sm font-semibold text-slate-950">{value}</p>{note && <p className="mt-1 text-xs text-slate-500">{note}</p>}</div>; }
function Metric({ label, value }: { label: string; value: string | number }) { return <div className="rounded-lg bg-slate-50 px-3 py-2"><p className="text-xs text-slate-500">{label}</p><p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{value}</p></div>; }

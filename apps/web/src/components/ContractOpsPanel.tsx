import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  practiceApi,
  type PracticeAddendum,
  type PracticeAddendumKind,
  type PracticeClientRevision,
  type PracticeDeliverable,
  type PracticeDeliverableStatus,
  type PracticeEngagement,
  type PracticeOpsKpis,
  type PracticePhaseStatus,
  type PracticeSchedulePhase,
} from "../api/practice";

const PHASE_STATUS_LABELS: Record<PracticePhaseStatus, string> = {
  nao_iniciado: "Não iniciado",
  em_preparacao: "Em preparação",
  em_curso: "Em curso",
  aguardando_cliente: "Aguardando cliente",
  aguardando_terceiro: "Aguardando terceiro",
  em_revisao: "Em revisão",
  concluido: "Concluído",
  suspenso: "Suspenso",
  atrasado: "Atrasado",
};

const DELIVERABLE_STATUS_LABELS: Record<PracticeDeliverableStatus, string> = {
  pendente: "Pendente",
  em_curso: "Em curso",
  entregue: "Entregue",
  em_revisao: "Em revisão",
  aprovado: "Aprovado",
  rejeitado: "Rejeitado",
};

const ADDENDUM_KIND_LABELS: Record<PracticeAddendumKind, string> = {
  trabalho_adicional: "Trabalho adicional",
  alteracao_escopo: "Alteração de escopo",
  nova_especialidade: "Nova especialidade",
  revisao_extraordinaria: "Revisão extraordinária",
  extensao_fiscalizacao: "Extensão fiscalização",
  consultoria_adicional: "Consultoria adicional",
};

const STATUS_BADGE: Record<string, string> = {
  nao_iniciado: "badge-gray",
  em_preparacao: "badge-blue",
  em_curso: "badge-blue",
  aguardando_cliente: "badge-yellow",
  aguardando_terceiro: "badge-yellow",
  em_revisao: "badge-yellow",
  concluido: "badge-green",
  suspenso: "badge-gray",
  atrasado: "badge-red",
  pendente: "badge-yellow",
  entregue: "badge-blue",
  aprovado: "badge-green",
  rejeitado: "badge-red",
  rascunho: "badge-gray",
  enviada: "badge-blue",
  aprovada: "badge-green",
  rejeitada: "badge-red",
  cancelada: "badge-red",
};

function money(value: number | string, currency = "MZN") {
  return `${Number(value).toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function daysBetween(a: string, b: string) {
  const ms = new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime();
  return Math.max(1, Math.round(ms / 86_400_000));
}

type SubTab = "cronograma" | "entregaveis" | "revisoes";

type Props = {
  engagement: PracticeEngagement;
  canManage: boolean;
  onChanged: () => void;
  onError: (message: string) => void;
};

export default function ContractOpsPanel({ engagement, canManage, onChanged, onError }: Props) {
  const [subTab, setSubTab] = useState<SubTab>("cronograma");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [schedule, setSchedule] = useState<PracticeSchedulePhase[]>([]);
  const [deliverables, setDeliverables] = useState<PracticeDeliverable[]>([]);
  const [revisions, setRevisions] = useState<PracticeClientRevision[]>([]);
  const [addenda, setAddenda] = useState<PracticeAddendum[]>([]);
  const [opsKpis, setOpsKpis] = useState<PracticeOpsKpis | null>(null);

  const [phaseForm, setPhaseForm] = useState({
    title: "",
    assigneeName: "",
    startDate: "",
    endDate: "",
    durationDays: "",
    status: "nao_iniciado" as PracticePhaseStatus,
  });

  const [deliverableForm, setDeliverableForm] = useState({
    title: "",
    phaseId: "",
    assigneeName: "",
    dueDate: "",
    version: "v1",
  });

  const [revisionForm, setRevisionForm] = useState({
    revisionDate: new Date().toISOString().slice(0, 10),
    description: "",
    assigneeName: "",
    impactDays: "0",
    impactAmount: "0",
    includedInContract: true,
    isAdditionalWork: false,
  });

  const [addendumForm, setAddendumForm] = useState({
    kind: "trabalho_adicional" as PracticeAddendumKind,
    title: "",
    description: "",
    amount: "",
    impactDays: "0",
    revisionId: "",
  });

  async function load() {
    setLoading(true);
    try {
      const detail = await practiceApi.getEngagement(engagement.id);
      setSchedule(detail.schedule ?? []);
      setDeliverables(detail.deliverables ?? []);
      setRevisions(detail.revisions ?? []);
      setAddenda(detail.addenda ?? []);
      setOpsKpis(detail.opsKpis ?? null);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Erro ao carregar produção");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engagement.id]);

  const timeline = useMemo(() => {
    const dated = schedule.filter((p) => p.startDate || p.endDate);
    if (!dated.length) return null;
    const starts = dated.map((p) => p.startDate || p.endDate!).filter(Boolean) as string[];
    const ends = dated.map((p) => p.endDate || p.startDate!).filter(Boolean) as string[];
    const min = starts.sort()[0];
    const max = ends.sort().slice(-1)[0];
    const span = daysBetween(min, max);
    return { min, max, span };
  }, [schedule]);

  async function addPhase(e: FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    setBusy(true);
    try {
      await practiceApi.addSchedulePhase(engagement.id, {
        title: phaseForm.title,
        assigneeName: phaseForm.assigneeName || null,
        startDate: phaseForm.startDate || null,
        endDate: phaseForm.endDate || null,
        durationDays: phaseForm.durationDays ? Number(phaseForm.durationDays) : null,
        status: phaseForm.status,
      });
      setPhaseForm({
        title: "",
        assigneeName: "",
        startDate: "",
        endDate: "",
        durationDays: "",
        status: "nao_iniciado",
      });
      onChanged();
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Erro ao criar fase");
    } finally {
      setBusy(false);
    }
  }

  async function importMilestones() {
    if (!canManage) return;
    setBusy(true);
    try {
      await practiceApi.importScheduleFromMilestones(engagement.id);
      onChanged();
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Erro ao importar fases");
    } finally {
      setBusy(false);
    }
  }

  async function updatePhaseStatus(id: string, status: PracticePhaseStatus) {
    if (!canManage) return;
    setBusy(true);
    try {
      await practiceApi.updateSchedulePhase(id, { status });
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Erro ao actualizar fase");
    } finally {
      setBusy(false);
    }
  }

  async function removePhase(id: string) {
    if (!canManage || !confirm("Remover esta fase do cronograma?")) return;
    setBusy(true);
    try {
      await practiceApi.deleteSchedulePhase(id);
      onChanged();
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Erro ao remover fase");
    } finally {
      setBusy(false);
    }
  }

  async function addDeliverable(e: FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    setBusy(true);
    try {
      await practiceApi.addDeliverable(engagement.id, {
        title: deliverableForm.title,
        phaseId: deliverableForm.phaseId || null,
        assigneeName: deliverableForm.assigneeName || null,
        dueDate: deliverableForm.dueDate || null,
        version: deliverableForm.version || null,
      });
      setDeliverableForm({ title: "", phaseId: "", assigneeName: "", dueDate: "", version: "v1" });
      onChanged();
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Erro ao criar entregável");
    } finally {
      setBusy(false);
    }
  }

  async function setDeliverableStatus(id: string, status: PracticeDeliverableStatus) {
    if (!canManage) return;
    setBusy(true);
    try {
      const patch: Parameters<typeof practiceApi.updateDeliverable>[1] = { status };
      if (status === "em_revisao") {
        const item = deliverables.find((d) => d.id === id);
        patch.revisionNumber = (item?.revisionNumber ?? 0) + 1;
      }
      await practiceApi.updateDeliverable(id, patch);
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Erro ao actualizar entregável");
    } finally {
      setBusy(false);
    }
  }

  async function removeDeliverable(id: string) {
    if (!canManage || !confirm("Remover entregável?")) return;
    setBusy(true);
    try {
      await practiceApi.deleteDeliverable(id);
      onChanged();
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Erro ao remover entregável");
    } finally {
      setBusy(false);
    }
  }

  async function addRevision(e: FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    setBusy(true);
    try {
      await practiceApi.addClientRevision(engagement.id, {
        revisionDate: revisionForm.revisionDate,
        description: revisionForm.description,
        assigneeName: revisionForm.assigneeName || null,
        impactDays: Number(revisionForm.impactDays || 0),
        impactAmount: Number(revisionForm.impactAmount || 0),
        includedInContract: revisionForm.includedInContract,
        isAdditionalWork: revisionForm.isAdditionalWork || !revisionForm.includedInContract,
      });
      setRevisionForm({
        revisionDate: new Date().toISOString().slice(0, 10),
        description: "",
        assigneeName: "",
        impactDays: "0",
        impactAmount: "0",
        includedInContract: true,
        isAdditionalWork: false,
      });
      onChanged();
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Erro ao registar revisão");
    } finally {
      setBusy(false);
    }
  }

  async function createAddendumFromRevision(revision: PracticeClientRevision) {
    if (!canManage) return;
    setBusy(true);
    try {
      await practiceApi.createAddendum(engagement.id, {
        kind: "trabalho_adicional",
        title: `Adenda — ${revision.description.slice(0, 80)}`,
        description: revision.description,
        amount: Number(revision.impactAmount),
        impactDays: revision.impactDays,
        revisionId: revision.id,
        assignNumber: true,
      });
      setSubTab("revisoes");
      onChanged();
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Erro ao criar adenda");
    } finally {
      setBusy(false);
    }
  }

  async function addAddendum(e: FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    setBusy(true);
    try {
      await practiceApi.createAddendum(engagement.id, {
        kind: addendumForm.kind,
        title: addendumForm.title,
        description: addendumForm.description || null,
        amount: Number(addendumForm.amount || 0),
        impactDays: Number(addendumForm.impactDays || 0),
        revisionId: addendumForm.revisionId || null,
        assignNumber: true,
      });
      setAddendumForm({
        kind: "trabalho_adicional",
        title: "",
        description: "",
        amount: "",
        impactDays: "0",
        revisionId: "",
      });
      onChanged();
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Erro ao criar adenda");
    } finally {
      setBusy(false);
    }
  }

  async function setAddendumStatus(id: string, status: PracticeAddendum["status"]) {
    if (!canManage) return;
    setBusy(true);
    try {
      await practiceApi.updateAddendum(id, { status });
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Erro ao actualizar adenda");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="border-t border-slate-200 px-4 py-6 text-sm text-slate-500">A carregar cronograma…</div>;
  }

  const tabs: { id: SubTab; label: string }[] = [
    { id: "cronograma", label: `Cronograma (${schedule.length})` },
    { id: "entregaveis", label: `Entregáveis (${deliverables.length})` },
    { id: "revisoes", label: `Revisões & adendas (${revisions.length}/${addenda.length})` },
  ];

  return (
    <div className="space-y-4 border-t border-slate-200 bg-slate-50/40 px-4 py-5 sm:px-5">
      {opsKpis && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Progresso</p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">
              {opsKpis.progressPct}% · {opsKpis.phasesDone}/{opsKpis.phasesTotal} fases
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Prazo</p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">
              {opsKpis.daysRemaining == null
                ? "Sem data fim"
                : opsKpis.daysRemaining >= 0
                  ? `${opsKpis.daysRemaining} dias restantes`
                  : `${Math.abs(opsKpis.daysRemaining)} dias em atraso`}
            </p>
            {opsKpis.contractEnd && <p className="text-[11px] text-slate-500">Fim {opsKpis.contractEnd}</p>}
          </div>
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Entregáveis</p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">
              {opsKpis.deliverablesDone}/{opsKpis.deliverablesTotal}
              {opsKpis.overduePhases > 0 ? (
                <span className="ml-2 text-xs font-medium text-rose-600">{opsKpis.overduePhases} fases atr.</span>
              ) : null}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Equipa / próximas</p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">
              {opsKpis.teamSize ?? "—"} membros
            </p>
            <p className="truncate text-[11px] text-slate-500">
              {opsKpis.nextActivities[0]
                ? `${opsKpis.nextActivities[0].kind}: ${opsKpis.nextActivities[0].title}`
                : "Sem actividades pendentes"}
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
              subTab === tab.id ? "bg-brand-500 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"
            }`}
            onClick={() => setSubTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {subTab === "cronograma" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">Fases do serviço</h3>
            {canManage && !schedule.length && (
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={importMilestones}>
                Importar das parcelas
              </button>
            )}
          </div>

          {timeline && (
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Timeline · {timeline.min} → {timeline.max}
              </p>
              <div className="space-y-2">
                {schedule.map((phase) => {
                  const status = phase.effectiveStatus ?? phase.status;
                  const start = phase.startDate || phase.endDate;
                  const end = phase.endDate || phase.startDate;
                  if (!start || !end || !timeline) {
                    return (
                      <div key={phase.id} className="flex items-center gap-2 text-xs text-slate-500">
                        <span className="w-36 truncate font-medium text-slate-700">{phase.title}</span>
                        <span className="text-slate-400">sem datas</span>
                      </div>
                    );
                  }
                  const offset = ((new Date(`${start}T00:00:00Z`).getTime() - new Date(`${timeline.min}T00:00:00Z`).getTime()) /
                    86_400_000 /
                    timeline.span) *
                    100;
                  const width = Math.max(4, (daysBetween(start, end) / timeline.span) * 100);
                  return (
                    <div key={phase.id} className="flex items-center gap-2">
                      <span className="w-36 shrink-0 truncate text-xs font-medium text-slate-700">{phase.title}</span>
                      <div className="relative h-5 flex-1 rounded bg-slate-100">
                        <div
                          className={`absolute top-0.5 h-4 rounded ${status === "atrasado" ? "bg-red-400" : status === "concluido" ? "bg-emerald-500" : "bg-brand-400"}`}
                          style={{ left: `${Math.min(96, Math.max(0, offset))}%`, width: `${Math.min(100 - offset, width)}%` }}
                          title={`${start} → ${end}`}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Fase</th>
                  <th className="px-3 py-2 font-medium">Responsável</th>
                  <th className="px-3 py-2 font-medium">Início</th>
                  <th className="px-3 py-2 font-medium">Fim</th>
                  <th className="px-3 py-2 font-medium">Dias</th>
                  <th className="px-3 py-2 font-medium">Estado</th>
                  <th className="px-3 py-2 font-medium text-right">Acção</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {schedule.map((phase) => {
                  const status = phase.effectiveStatus ?? phase.status;
                  return (
                    <tr key={phase.id}>
                      <td className="px-3 py-2 font-medium text-slate-900">{phase.title}</td>
                      <td className="px-3 py-2 text-slate-600">{phase.assigneeName ?? "—"}</td>
                      <td className="px-3 py-2 text-slate-600">{phase.startDate ?? "—"}</td>
                      <td className="px-3 py-2 text-slate-600">{phase.endDate ?? "—"}</td>
                      <td className="px-3 py-2 tabular-nums text-slate-600">{phase.durationDays ?? "—"}</td>
                      <td className="px-3 py-2">
                        {canManage ? (
                          <select
                            className="input py-1 text-xs"
                            value={phase.status}
                            disabled={busy}
                            onChange={(e) => updatePhaseStatus(phase.id, e.target.value as PracticePhaseStatus)}
                          >
                            {(Object.keys(PHASE_STATUS_LABELS) as PracticePhaseStatus[]).map((key) => (
                              <option key={key} value={key}>
                                {PHASE_STATUS_LABELS[key]}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className={`badge ${STATUS_BADGE[status] ?? "badge-gray"}`}>
                            {PHASE_STATUS_LABELS[status]}
                          </span>
                        )}
                        {status === "atrasado" && phase.status !== "atrasado" && (
                          <span className="ml-1 badge badge-red">atrasado</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {canManage && (
                          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => removePhase(phase.id)}>
                            Remover
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!schedule.length && (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-500">
                      Sem fases. Adicione ou importe das parcelas de facturação.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {canManage && (
            <form className="grid gap-2 rounded-lg border border-dashed border-slate-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-3" onSubmit={addPhase}>
              <div>
                <label className="label">Fase</label>
                <input className="input" required value={phaseForm.title} onChange={(e) => setPhaseForm((f) => ({ ...f, title: e.target.value }))} />
              </div>
              <div>
                <label className="label">Responsável</label>
                <input
                  className="input"
                  value={phaseForm.assigneeName}
                  onChange={(e) => setPhaseForm((f) => ({ ...f, assigneeName: e.target.value }))}
                />
              </div>
              <div>
                <label className="label">Estado</label>
                <select
                  className="input"
                  value={phaseForm.status}
                  onChange={(e) => setPhaseForm((f) => ({ ...f, status: e.target.value as PracticePhaseStatus }))}
                >
                  {(Object.keys(PHASE_STATUS_LABELS) as PracticePhaseStatus[]).map((key) => (
                    <option key={key} value={key}>
                      {PHASE_STATUS_LABELS[key]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Início</label>
                <input
                  className="input"
                  type="date"
                  value={phaseForm.startDate}
                  onChange={(e) => setPhaseForm((f) => ({ ...f, startDate: e.target.value }))}
                />
              </div>
              <div>
                <label className="label">Fim</label>
                <input
                  className="input"
                  type="date"
                  value={phaseForm.endDate}
                  onChange={(e) => setPhaseForm((f) => ({ ...f, endDate: e.target.value }))}
                />
              </div>
              <div>
                <label className="label">Duração (dias)</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={phaseForm.durationDays}
                  onChange={(e) => setPhaseForm((f) => ({ ...f, durationDays: e.target.value }))}
                />
              </div>
              <div className="flex items-end sm:col-span-2 lg:col-span-3">
                <button type="submit" className="btn btn-primary btn-sm ml-auto" disabled={busy}>
                  Adicionar fase
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {subTab === "entregaveis" && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-slate-900">Entregáveis por fase</h3>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Entregável</th>
                  <th className="px-3 py-2 font-medium">Fase</th>
                  <th className="px-3 py-2 font-medium">Responsável</th>
                  <th className="px-3 py-2 font-medium">Prazo</th>
                  <th className="px-3 py-2 font-medium">Versão</th>
                  <th className="px-3 py-2 font-medium">Estado</th>
                  <th className="px-3 py-2 font-medium text-right">Acção</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {deliverables.map((item) => {
                  const phaseTitle = schedule.find((p) => p.id === item.phaseId)?.title;
                  return (
                    <tr key={item.id}>
                      <td className="px-3 py-2 font-medium text-slate-900">{item.title}</td>
                      <td className="px-3 py-2 text-slate-600">{phaseTitle ?? "—"}</td>
                      <td className="px-3 py-2 text-slate-600">{item.assigneeName ?? "—"}</td>
                      <td className="px-3 py-2 text-slate-600">{item.dueDate ?? "—"}</td>
                      <td className="px-3 py-2 text-slate-600">
                        {item.version ?? "—"}
                        {item.revisionNumber > 0 ? ` · rev.${item.revisionNumber}` : ""}
                      </td>
                      <td className="px-3 py-2">
                        {canManage ? (
                          <select
                            className="input py-1 text-xs"
                            value={item.status}
                            disabled={busy}
                            onChange={(e) => setDeliverableStatus(item.id, e.target.value as PracticeDeliverableStatus)}
                          >
                            {(Object.keys(DELIVERABLE_STATUS_LABELS) as PracticeDeliverableStatus[]).map((key) => (
                              <option key={key} value={key}>
                                {DELIVERABLE_STATUS_LABELS[key]}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className={`badge ${STATUS_BADGE[item.status] ?? "badge-gray"}`}>
                            {DELIVERABLE_STATUS_LABELS[item.status]}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {canManage && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={busy}
                            onClick={() => removeDeliverable(item.id)}
                          >
                            Remover
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!deliverables.length && (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-500">
                      Sem entregáveis neste contrato.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {canManage && (
            <form className="grid gap-2 rounded-lg border border-dashed border-slate-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-3" onSubmit={addDeliverable}>
              <div className="lg:col-span-2">
                <label className="label">Entregável</label>
                <input
                  className="input"
                  required
                  value={deliverableForm.title}
                  onChange={(e) => setDeliverableForm((f) => ({ ...f, title: e.target.value }))}
                />
              </div>
              <div>
                <label className="label">Fase</label>
                <select
                  className="input"
                  value={deliverableForm.phaseId}
                  onChange={(e) => setDeliverableForm((f) => ({ ...f, phaseId: e.target.value }))}
                >
                  <option value="">— Sem fase —</option>
                  {schedule.map((phase) => (
                    <option key={phase.id} value={phase.id}>
                      {phase.title}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Responsável</label>
                <input
                  className="input"
                  value={deliverableForm.assigneeName}
                  onChange={(e) => setDeliverableForm((f) => ({ ...f, assigneeName: e.target.value }))}
                />
              </div>
              <div>
                <label className="label">Prazo</label>
                <input
                  className="input"
                  type="date"
                  value={deliverableForm.dueDate}
                  onChange={(e) => setDeliverableForm((f) => ({ ...f, dueDate: e.target.value }))}
                />
              </div>
              <div>
                <label className="label">Versão</label>
                <input
                  className="input"
                  value={deliverableForm.version}
                  onChange={(e) => setDeliverableForm((f) => ({ ...f, version: e.target.value }))}
                />
              </div>
              <div className="flex items-end sm:col-span-2 lg:col-span-3">
                <button type="submit" className="btn btn-primary btn-sm ml-auto" disabled={busy}>
                  Adicionar entregável
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {subTab === "revisoes" && (
        <div className="space-y-5">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Revisões do cliente</h3>
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Data</th>
                    <th className="px-3 py-2 font-medium">Descrição</th>
                    <th className="px-3 py-2 font-medium">Impacto</th>
                    <th className="px-3 py-2 font-medium">Âmbito</th>
                    <th className="px-3 py-2 font-medium text-right">Acção</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {revisions.map((rev) => (
                    <tr key={rev.id}>
                      <td className="px-3 py-2 text-slate-600">{rev.revisionDate}</td>
                      <td className="px-3 py-2">
                        <p className="font-medium text-slate-900">{rev.description}</p>
                        {rev.assigneeName && <p className="text-xs text-slate-500">{rev.assigneeName}</p>}
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {rev.impactDays ? `+${rev.impactDays}d` : "—"}
                        {Number(rev.impactAmount) > 0 ? ` · ${money(rev.impactAmount, engagement.currency)}` : ""}
                      </td>
                      <td className="px-3 py-2">
                        {rev.includedInContract && !rev.isAdditionalWork ? (
                          <span className="badge badge-green">No contrato</span>
                        ) : (
                          <span className="badge badge-yellow">Fora do âmbito</span>
                        )}
                        {rev.addendumId && <span className="ml-1 badge badge-blue">Adenda</span>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {canManage && !rev.addendumId && (rev.isAdditionalWork || !rev.includedInContract) && (
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={busy}
                            onClick={() => createAddendumFromRevision(rev)}
                          >
                            Criar adenda
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!revisions.length && (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-500">
                        Sem revisões registadas.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {canManage && (
              <form className="mt-3 grid gap-2 rounded-lg border border-dashed border-slate-200 bg-white p-3 sm:grid-cols-2" onSubmit={addRevision}>
                <div>
                  <label className="label">Data</label>
                  <input
                    className="input"
                    type="date"
                    required
                    value={revisionForm.revisionDate}
                    onChange={(e) => setRevisionForm((f) => ({ ...f, revisionDate: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">Responsável</label>
                  <input
                    className="input"
                    value={revisionForm.assigneeName}
                    onChange={(e) => setRevisionForm((f) => ({ ...f, assigneeName: e.target.value }))}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="label">Descrição</label>
                  <textarea
                    className="input min-h-[72px]"
                    required
                    value={revisionForm.description}
                    onChange={(e) => setRevisionForm((f) => ({ ...f, description: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">Impacto prazo (dias)</label>
                  <input
                    className="input"
                    type="number"
                    value={revisionForm.impactDays}
                    onChange={(e) => setRevisionForm((f) => ({ ...f, impactDays: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">Impacto financeiro</label>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    step="0.01"
                    value={revisionForm.impactAmount}
                    onChange={(e) => setRevisionForm((f) => ({ ...f, impactAmount: e.target.value }))}
                  />
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={revisionForm.includedInContract}
                    onChange={(e) =>
                      setRevisionForm((f) => ({
                        ...f,
                        includedInContract: e.target.checked,
                        isAdditionalWork: e.target.checked ? false : true,
                      }))
                    }
                  />
                  Incluída no contrato
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={revisionForm.isAdditionalWork || !revisionForm.includedInContract}
                    onChange={(e) =>
                      setRevisionForm((f) => ({
                        ...f,
                        isAdditionalWork: e.target.checked,
                        includedInContract: e.target.checked ? false : f.includedInContract,
                      }))
                    }
                  />
                  Trabalho adicional / fora do âmbito
                </label>
                <div className="flex items-end sm:col-span-2">
                  <button type="submit" className="btn btn-primary btn-sm ml-auto" disabled={busy}>
                    Registar revisão
                  </button>
                </div>
              </form>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Adendas</h3>
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Nº</th>
                    <th className="px-3 py-2 font-medium">Tipo</th>
                    <th className="px-3 py-2 font-medium">Título</th>
                    <th className="px-3 py-2 font-medium text-right">Valor</th>
                    <th className="px-3 py-2 font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {addenda.map((row) => (
                    <tr key={row.id}>
                      <td className="px-3 py-2 font-mono text-xs text-slate-700">{row.addendumNumber ?? "—"}</td>
                      <td className="px-3 py-2 text-slate-600">{ADDENDUM_KIND_LABELS[row.kind]}</td>
                      <td className="px-3 py-2 font-medium text-slate-900">{row.title}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(row.amount, row.currency)}</td>
                      <td className="px-3 py-2">
                        {canManage ? (
                          <select
                            className="input py-1 text-xs"
                            value={row.status}
                            disabled={busy}
                            onChange={(e) => setAddendumStatus(row.id, e.target.value as PracticeAddendum["status"])}
                          >
                            {(["rascunho", "enviada", "aprovada", "rejeitada", "cancelada"] as const).map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className={`badge ${STATUS_BADGE[row.status] ?? "badge-gray"}`}>{row.status}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!addenda.length && (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-500">
                        Sem adendas. Crie a partir de uma revisão fora do âmbito ou manualmente.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {canManage && (
              <form className="mt-3 grid gap-2 rounded-lg border border-dashed border-slate-200 bg-white p-3 sm:grid-cols-2" onSubmit={addAddendum}>
                <div>
                  <label className="label">Tipo</label>
                  <select
                    className="input"
                    value={addendumForm.kind}
                    onChange={(e) => setAddendumForm((f) => ({ ...f, kind: e.target.value as PracticeAddendumKind }))}
                  >
                    {(Object.keys(ADDENDUM_KIND_LABELS) as PracticeAddendumKind[]).map((key) => (
                      <option key={key} value={key}>
                        {ADDENDUM_KIND_LABELS[key]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Revisão origem (opcional)</label>
                  <select
                    className="input"
                    value={addendumForm.revisionId}
                    onChange={(e) => setAddendumForm((f) => ({ ...f, revisionId: e.target.value }))}
                  >
                    <option value="">—</option>
                    {revisions
                      .filter((r) => !r.addendumId)
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.revisionDate} — {r.description.slice(0, 40)}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="label">Título</label>
                  <input
                    className="input"
                    required
                    value={addendumForm.title}
                    onChange={(e) => setAddendumForm((f) => ({ ...f, title: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">Valor</label>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    step="0.01"
                    value={addendumForm.amount}
                    onChange={(e) => setAddendumForm((f) => ({ ...f, amount: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">Impacto prazo (dias)</label>
                  <input
                    className="input"
                    type="number"
                    value={addendumForm.impactDays}
                    onChange={(e) => setAddendumForm((f) => ({ ...f, impactDays: e.target.value }))}
                  />
                </div>
                <div className="flex items-end sm:col-span-2">
                  <button type="submit" className="btn btn-primary btn-sm ml-auto" disabled={busy}>
                    Criar adenda (nº automático)
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

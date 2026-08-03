import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { boqApi, type BudgetDocument, type Project } from "../api/boq";
import { scheduleApi, type ProjectSchedule, type SchedulePaper, type SchedulePrintScale, type ScheduleTask, type ScheduleTaskStatus } from "../api/schedule";
import { workingDaysInclusive, nextWorkingDay } from "@sigo/shared";
import Layout from "../components/Layout";
import LoadingState from "../components/LoadingState";
import AlertBanner from "../components/AlertBanner";
import { useConfirmDialog } from "../hooks/useConfirmDialog";
import ProjectWorkspaceNav from "../components/ProjectWorkspaceNav";
import Modal from "../components/Modal";
import PageSearch from "../components/PageSearch";
import ScheduleWorkspace from "../components/ScheduleWorkspace";
import { IconBack, IconChart, IconDownload, IconPlus, IconRefresh, IconTrash } from "../components/icons";

const STATUS_LABELS: Record<ScheduleTaskStatus, string> = {
  nao_iniciado: "Não iniciado",
  em_curso: "Em curso",
  bloqueado: "Bloqueado",
  concluido: "Concluído",
};

function today() {
  return new Date().toISOString().slice(0, 10);
}
function fmtMoney(value: number, currency: string) {
  return new Intl.NumberFormat("pt-MZ", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}
function fmtDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("pt-PT", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`))
    : "—";
}

export default function ProjectSchedulePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { confirm, dialog } = useConfirmDialog();
  const [project, setProject] = useState<Project | null>(null);
  const [documents, setDocuments] = useState<BudgetDocument[]>([]);
  const [schedule, setSchedule] = useState<ProjectSchedule | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [setupOpen, setSetupOpen] = useState(false);
  const [documentId, setDocumentId] = useState("");
  const [startDate, setStartDate] = useState(today());
  const [duration, setDuration] = useState("");
  const [manualDuration, setManualDuration] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [printPaper, setPrintPaper] = useState<SchedulePaper>("auto");
  const [printScale, setPrintScale] = useState<SchedulePrintScale>("fit");
  const [timelineZoom, setTimelineZoom] = useState<"compacto" | "normal" | "detalhe">("normal");
  const [taskQuery, setTaskQuery] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);

  async function reload() {
    if (!projectId) return;
    const [projectData, documentData, scheduleData] = await Promise.all([
      boqApi.getProject(projectId),
      boqApi.listBudgetDocuments(projectId),
      scheduleApi.get(projectId),
    ]);
    setProject(projectData);
    setDocuments(documentData.filter((document) => document.currency === projectData.currency));
    setSchedule(scheduleData);
    if (!documentId) {
      setDocumentId(
        documentData.find((document) => document.status === "aprovado" && document.currency === projectData.currency)?.id
          ?? documentData.find((document) => document.currency === projectData.currency)?.id
          ?? "",
      );
    }
    if (!scheduleData.tasks.length) setSetupOpen(true);
  }

  useEffect(() => {
    reload().catch((cause) => setError(cause instanceof Error ? cause.message : "Erro ao carregar cronograma"));
  }, [projectId]);

  async function handleGenerate(event: FormEvent) {
    event.preventDefault();
    if (!projectId || !documentId) return;
    if (schedule?.tasks.length) {
      const ok = await confirm({
        title: "Recriar cronograma?",
        message: "A linha de base actual, subactividades e dependências serão substituídas.",
        confirmLabel: "Recriar",
        danger: true,
        details: ["WBS gerada de novo a partir do mapa", "Progresso manual pode perder-se"],
      });
      if (!ok) return;
    }
    setSaving(true);
    setError(null);
    try {
      const next = await scheduleApi.generate(projectId, {
        budgetDocumentId: documentId,
        startDate,
        ...(manualDuration && duration ? { totalDurationDays: Number(duration) } : {}),
      });
      setSchedule(next);
      setSetupOpen(false);
      setSelectedId(next.tasks[0]?.id ?? null);
      setCollapsed(new Set());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Erro ao gerar cronograma");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddRoot() {
    if (!projectId) return;
    const roots = schedule?.tasks.filter((task) => !task.parentId) ?? [];
    const previous = roots.at(-1);
    const start = previous ? nextWorkingDay(previous.endDate) : schedule?.startDate ?? today();
    setSaving(true);
    setError(null);
    try {
      const task = await scheduleApi.createTask(projectId, {
        code: String(roots.length + 1),
        name: "Nova actividade principal",
        startDate: start,
        durationDays: 5,
        predecessorTaskId: previous?.id ?? null,
      });
      await reload();
      setSelectedId(task.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Erro ao criar actividade");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddSubtask() {
    if (!projectId || !schedule || !selectedId) return;
    const selected = schedule.tasks.find((task) => task.id === selectedId);
    if (!selected) return;
    const parent = selected.parentId ? schedule.tasks.find((task) => task.id === selected.parentId) : selected;
    if (!parent) return;
    const siblings = schedule.tasks.filter((task) => task.parentId === parent.id);
    const previous = siblings.at(-1);
    const start = previous ? nextWorkingDay(previous.endDate) : parent.startDate;
    setSaving(true);
    setError(null);
    try {
      const task = await scheduleApi.createTask(projectId, {
        parentId: parent.id,
        code: `${parent.code}.${siblings.length + 1}`,
        name: "Nova subactividade",
        startDate: start,
        durationDays: 5,
        predecessorTaskId: previous?.id ?? null,
      });
      setCollapsed((current) => {
        const next = new Set(current);
        next.delete(parent.id);
        return next;
      });
      await reload();
      setSelectedId(task.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Erro ao criar subactividade");
    } finally {
      setSaving(false);
    }
  }

  const selected = schedule?.tasks.find((task) => task.id === selectedId) ?? null;
  const leafTasks = schedule?.tasks.filter((task) => !task.isSummary) ?? [];
  const visibleTasks = useMemo(() => {
    const tasks = schedule?.tasks ?? [];
    const needle = taskQuery.trim().toLocaleLowerCase("pt");
    if (!needle) return tasks.filter((task) => !task.parentId || !collapsed.has(task.parentId));
    const visibleIds = new Set<string>();
    tasks.forEach((task) => {
      const text = `${task.code} ${task.name} ${task.status} ${task.notes ?? ""}`.toLocaleLowerCase("pt");
      if (!text.includes(needle)) return;
      visibleIds.add(task.id);
      if (task.parentId) visibleIds.add(task.parentId);
    });
    return tasks.filter((task) => visibleIds.has(task.id));
  }, [schedule?.tasks, collapsed, taskQuery]);

  function toggleCollapse(taskId: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }

  if (!project || !schedule) return <LoadingState fullScreen label="A carregar cronograma..." />;

  const doneCount = leafTasks.filter((t) => t.status === "concluido").length;
  const durationDays = schedule.startDate && schedule.endDate ? workingDaysInclusive(schedule.startDate, schedule.endDate) : 0;
  const progressTone = schedule.overallProgress >= 70 ? "positive" : schedule.overallProgress >= 30 ? "info" : "neutral";

  return (
    <Layout
      title={`Cronograma — ${project.name}`}
      subtitle="Planeamento, dependências e progresso da obra"
      actions={
        <>
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
            <select
              className="h-7 rounded border-0 bg-transparent px-2 text-xs font-semibold text-slate-700 outline-none"
              aria-label="Formato do PDF"
              value={printPaper}
              onChange={(event) => setPrintPaper(event.target.value as SchedulePaper)}
            >
              <option value="auto">Folha automática</option>
              <option value="A3">A3</option>
              <option value="A2">A2</option>
              <option value="A1">A1</option>
            </select>
            <span className="h-5 border-l border-slate-200" />
            <select
              className="h-7 rounded border-0 bg-transparent px-2 text-xs font-semibold text-slate-700 outline-none"
              aria-label="Escala do PDF"
              value={printScale}
              onChange={(event) => setPrintScale(event.target.value === "fit" ? "fit" : Number(event.target.value) as SchedulePrintScale)}
            >
              <option value="fit">Ajustar à folha</option>
              <option value="100">100%</option>
              <option value="85">85%</option>
              <option value="70">70%</option>
              <option value="55">55%</option>
            </select>
          </div>
          <a
            className={`btn btn-secondary btn-sm ${!schedule.tasks.length ? "pointer-events-none opacity-50" : ""}`}
            href={schedule.tasks.length ? scheduleApi.exportPdfUrl(project.id, { paper: printPaper, scale: printScale }) : undefined}
            aria-disabled={!schedule.tasks.length}
          >
            <IconDownload className="h-4 w-4" /> PDF
          </a>
          <Link className="btn btn-ghost btn-sm" to={`/projectos/${project.id}`}>
            <IconBack className="h-4 w-4" /> Projecto
          </Link>
        </>
      }
    >
      <div className="mx-auto w-full max-w-[1600px] space-y-4">
        <ProjectWorkspaceNav projectId={project.id} />
        {error && (
          <AlertBanner tone="error" onDismiss={() => setError(null)}>
            {error}
          </AlertBanner>
        )}

        {/* Hero toolbar */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="relative px-5 py-4">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(700px_160px_at_0%_0%,rgba(59,130,246,0.10),transparent_60%)]" />
            <div className="relative flex flex-wrap items-end justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-blue-700">Plano de execução</p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">Cronograma da obra</h2>
                <p className="mt-1 max-w-2xl text-sm text-slate-500">Gantt e folha de actividades sincronizados.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSetupOpen((v) => !v)}>
                  <IconRefresh className="h-4 w-4" /> Linha de base
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={handleAddSubtask} disabled={saving || !selected}>
                  <IconPlus className="h-4 w-4" /> Subactividade
                </button>
                <button type="button" className="btn btn-primary btn-sm" onClick={handleAddRoot} disabled={saving || !schedule.tasks.length}>
                  <IconPlus className="h-4 w-4" /> Actividade
                </button>
                {selected && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditorOpen(true)}>
                    Detalhes
                  </button>
                )}
              </div>
            </div>
          </div>

          {schedule.tasks.length > 0 && (
            <div className="grid grid-cols-2 border-t border-slate-100 lg:grid-cols-4">
              <Stat
                label="Execução física"
                value={`${schedule.overallProgress.toFixed(1)}%`}
                note={`${doneCount}/${leafTasks.length} concluídas`}
                bar={schedule.overallProgress}
                tone={progressTone}
              />
              <Stat
                label="Duração"
                value={`${durationDays} d`}
                note={`${fmtDate(schedule.startDate)} — ${fmtDate(schedule.endDate)}`}
              />
              <Stat label="Valor planeado" value={fmtMoney(schedule.plannedValue, project.currency)} note="Sem dupla contagem" />
              <Stat label="Valor medido" value={fmtMoney(schedule.executedValue, project.currency)} note="Autos aprovados" />
            </div>
          )}
        </div>

        {setupOpen && (
          <form onSubmit={handleGenerate} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
            <div className="grid gap-4 md:grid-cols-[minmax(260px,1fr)_180px_auto] items-end">
              <div>
                <label className="label">Mapa de Quantidades</label>
                <select className="input" required value={documentId} onChange={(e) => setDocumentId(e.target.value)}>
                  <option value="">Seleccionar...</option>
                  {documents.map((document) => (
                    <option key={document.id} value={document.id}>
                      {document.title} · {document.status}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Início planeado</label>
                <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <button className="btn btn-primary" disabled={saving || !documentId}>
                <IconChart className="h-4 w-4" />
                {schedule.tasks.length ? "Recriar WBS" : "Gerar cronograma"}
              </button>
            </div>
            <p className="text-xs text-slate-500">A duração é calculada pelas composições; use prazo próprio apenas quando necessário.</p>
            {!manualDuration ? (
              <button type="button" className="text-xs font-semibold text-blue-700 hover:underline" onClick={() => setManualDuration(true)}>
                Substituir por prazo próprio
              </button>
            ) : (
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="label">Prazo total (dias úteis)</label>
                  <input className="input w-40" type="number" min="7" value={duration} onChange={(e) => setDuration(e.target.value)} />
                </div>
                <button
                  type="button"
                  className="text-xs font-semibold text-slate-500 hover:underline"
                  onClick={() => {
                    setManualDuration(false);
                    setDuration("");
                  }}
                >
                  Voltar ao automático
                </button>
              </div>
            )}
          </form>
        )}

        {schedule.tasks.length > 0 && schedule.startDate && schedule.endDate && (
          <>
            <PageSearch
              value={taskQuery}
              onChange={setTaskQuery}
              placeholder="Pesquisar WBS, nome, estado…"
              resultLabel={`${visibleTasks.length} visível(is)`}
            />

            {/* Mobile list */}
            <div className="space-y-2 md:hidden">
              {visibleTasks.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(task.id);
                    setEditorOpen(true);
                  }}
                  className={`w-full rounded-xl border px-3 py-3 text-left ${
                    selectedId === task.id ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-mono text-[11px] font-bold text-blue-700">{task.code}</span>
                      <p className={`mt-0.5 truncate text-sm ${task.isSummary ? "font-semibold" : "font-medium"} text-slate-900`}>
                        {task.name}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {fmtDate(task.startDate)} — {fmtDate(task.endDate)} · {task.durationDays}d · {task.progress.toFixed(0)}%
                      </p>
                    </div>
                    {task.isSummary && (
                      <button
                        type="button"
                        className="shrink-0 rounded border border-slate-300 px-2 py-1 text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleCollapse(task.id);
                        }}
                      >
                        {collapsed.has(task.id) ? "▸" : "▾"}
                      </button>
                    )}
                  </div>
                </button>
              ))}
            </div>

            <div className="hidden md:block">
              <ScheduleWorkspace
                tasks={schedule.tasks}
                visibleTasks={visibleTasks}
                scheduleStart={schedule.startDate}
                scheduleEnd={schedule.endDate}
                selectedId={selectedId}
                collapsed={collapsed}
                timelineZoom={timelineZoom}
                onTimelineZoom={setTimelineZoom}
                onSelect={(id) => {
                  setSelectedId(id);
                }}
                onToggleCollapse={toggleCollapse}
                onExpandAll={() => setCollapsed(new Set())}
                onCollapsePhases={() => setCollapsed(new Set(schedule.tasks.filter((t) => t.isSummary).map((t) => t.id)))}
                onChanged={reload}
                onError={setError}
              />
            </div>

            {selected && editorOpen && (
              <TaskEditor
                task={selected}
                tasks={schedule.tasks}
                onClose={() => setEditorOpen(false)}
                onSaved={async () => {
                  setEditorOpen(false);
                  await reload();
                }}
                onDeleted={async () => {
                  setEditorOpen(false);
                  setSelectedId(null);
                  await reload();
                }}
                setError={setError}
                confirm={confirm}
              />
            )}
          </>
        )}

        {!schedule.tasks.length && !setupOpen && (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
            <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-blue-50 text-blue-600">
              <IconChart className="h-7 w-7" />
            </div>
            <h3 className="text-lg font-semibold text-slate-950">Do orçamento ao plano de obra</h3>
            <p className="mx-auto mt-2 max-w-lg text-sm text-slate-500">
              Gere a WBS a partir do mapa, edite na folha tipo MS Project e acompanhe no Gantt com linha de base e progresso real.
            </p>
            <button type="button" onClick={() => setSetupOpen(true)} className="btn btn-primary mt-6">
              Configurar cronograma
            </button>
          </div>
        )}
        {dialog}
      </div>
    </Layout>
  );
}

function Stat({
  label,
  value,
  note,
  bar,
  tone = "neutral",
}: {
  label: string;
  value: string;
  note: string;
  bar?: number;
  tone?: "neutral" | "positive" | "info";
}) {
  const barColor = tone === "positive" ? "bg-emerald-500" : tone === "info" ? "bg-blue-500" : "bg-slate-400";
  return (
    <div className="border-slate-100 px-5 py-3.5 max-lg:border-b lg:border-r lg:last:border-r-0 odd:max-lg:border-r">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-bold tabular-nums tracking-tight text-slate-950">{value}</p>
      {bar != null && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-100">
          <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(100, Math.max(0, bar))}%` }} />
        </div>
      )}
      <p className="mt-1.5 text-[11px] text-slate-500">{note}</p>
    </div>
  );
}

type EditorForm = {
  code: string;
  name: string;
  parentId: string;
  startDate: string;
  durationDays: string;
  status: ScheduleTaskStatus;
  manualProgress: string;
  predecessorTaskId: string;
  dependencyType: string;
  lagDays: string;
  notes: string;
};

function formFromTask(task: ScheduleTask): EditorForm {
  return {
    code: task.code,
    name: task.name,
    parentId: task.parentId ?? "",
    startDate: task.startDate,
    durationDays: String(task.durationDays),
    status: task.status,
    manualProgress: String(Math.round(task.progress)),
    predecessorTaskId: task.predecessorTaskId ?? "",
    dependencyType: task.dependencyType ?? "FS",
    lagDays: String(task.lagDays ?? 0),
    notes: task.notes ?? "",
  };
}

function TaskEditor({
  task,
  tasks,
  onClose,
  onSaved,
  onDeleted,
  setError,
  confirm,
}: {
  task: ScheduleTask;
  tasks: ScheduleTask[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  onDeleted: () => Promise<void>;
  setError: (value: string | null) => void;
  confirm: ReturnType<typeof useConfirmDialog>["confirm"];
}) {
  const [form, setForm] = useState<EditorForm>(() => formFromTask(task));
  const [saving, setSaving] = useState(false);
  useEffect(() => setForm(formFromTask(task)), [task.id]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await scheduleApi.updateTask(task.id, {
        ...form,
        parentId: form.parentId || null,
        durationDays: Number(form.durationDays),
        manualProgress: task.isSummary ? null : Number(form.manualProgress),
        status: form.status,
        predecessorTaskId: form.predecessorTaskId || null,
        dependencyType: form.dependencyType as "FS" | "SS" | "FF" | "SF",
        lagDays: Number(form.lagDays) || 0,
      });
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Erro ao actualizar actividade");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    const ok = await confirm({
      title: "Eliminar actividade?",
      message: `Remover “${task.name}” do cronograma.`,
      confirmLabel: "Eliminar",
      danger: true,
      details: task.isSummary ? ["As subactividades desta fase também serão eliminadas"] : undefined,
    });
    if (!ok) return;
    setSaving(true);
    try {
      await scheduleApi.deleteTask(task.id);
      await onDeleted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Erro ao eliminar actividade");
    } finally {
      setSaving(false);
    }
  }

  const parentOptions = tasks.filter((item) => !item.parentId && item.id !== task.id);
  return (
    <Modal
      title={task.name}
      subtitle={`${task.isSummary ? "Fase-resumo" : task.parentId ? "Subactividade" : "Actividade"} · WBS ${task.code}`}
      onClose={onClose}
      maxWidth="max-w-5xl"
    >
      <form onSubmit={save}>
        <div className="mb-4 flex justify-end">
          <button type="button" onClick={remove} className="btn btn-ghost btn-sm text-red-600">
            <IconTrash className="h-4 w-4" /> Eliminar
          </button>
        </div>
        {task.isSummary && (
          <div className="mb-5 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            <strong>Fase calculada pelas subactividades.</strong> Edite apenas código e nome; datas e progresso agregam-se sozinhos.
          </div>
        )}
        <div className="grid gap-5 lg:grid-cols-[1.08fr_.92fr]">
          <fieldset className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <legend className="px-2 text-xs font-bold uppercase tracking-[.08em] text-slate-500">Estrutura e execução</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Código WBS</label>
                <input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
              </div>
              <div>
                <label className="label">Nível na WBS</label>
                <select
                  className="input"
                  disabled={task.isSummary}
                  value={form.parentId}
                  onChange={(e) => setForm({ ...form, parentId: e.target.value })}
                >
                  <option value="">Actividade principal</option>
                  {parentOptions.map((item) => (
                    <option key={item.id} value={item.id}>
                      Sob {item.code} · {item.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="label">Nome</label>
                <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label className="label">Início</label>
                <input
                  className="input"
                  type="date"
                  disabled={task.isSummary}
                  value={form.startDate}
                  onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Duração (dias úteis)</label>
                <input
                  className="input"
                  type="number"
                  min="1"
                  disabled={task.isSummary}
                  value={form.durationDays}
                  onChange={(e) => setForm({ ...form, durationDays: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Estado</label>
                <select
                  className="input"
                  disabled={task.isSummary}
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value as ScheduleTaskStatus })}
                >
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Progresso manual (%)</label>
                <input
                  className="input"
                  type="number"
                  min="0"
                  max="100"
                  disabled={task.isSummary}
                  value={form.manualProgress}
                  onChange={(e) => setForm({ ...form, manualProgress: e.target.value })}
                />
              </div>
            </div>
          </fieldset>
          <fieldset className="rounded-xl border border-slate-200 p-4">
            <legend className="px-2 text-xs font-bold uppercase tracking-[.08em] text-slate-500">Dependência</legend>
            <div className="space-y-3">
              <div>
                <label className="label">Predecessora</label>
                <select
                  className="input"
                  value={form.predecessorTaskId}
                  onChange={(e) => setForm({ ...form, predecessorTaskId: e.target.value })}
                >
                  <option value="">Sem dependência</option>
                  {tasks
                    .filter((item) => item.id !== task.id)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.code} · {item.name}
                      </option>
                    ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Relação</label>
                  <select className="input" value={form.dependencyType} onChange={(e) => setForm({ ...form, dependencyType: e.target.value })}>
                    <option value="FS">Fim → Início</option>
                    <option value="SS">Início → Início</option>
                    <option value="FF">Fim → Fim</option>
                    <option value="SF">Início → Fim</option>
                  </select>
                </div>
                <div>
                  <label className="label">Folga / atraso</label>
                  <input
                    className="input"
                    type="number"
                    min={-365}
                    max={365}
                    value={form.lagDays}
                    onChange={(e) => setForm({ ...form, lagDays: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="label">Notas</label>
                <textarea
                  className="input min-h-24 resize-y py-3"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Acesso, equipa, aprovação..."
                />
              </div>
            </div>
          </fieldset>
        </div>
        <div className="mt-5 flex flex-col-reverse gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-500">Diário e autos podem substituir o progresso manual.</p>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn btn-secondary flex-1 sm:flex-none">
              Cancelar
            </button>
            <button className="btn btn-primary flex-1 sm:flex-none" disabled={saving}>
              {saving ? "A guardar..." : "Guardar"}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

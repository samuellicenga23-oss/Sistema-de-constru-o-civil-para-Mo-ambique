import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { boqApi, type BudgetDocument, type Project } from "../api/boq";
import { scheduleApi, type ProjectSchedule, type ScheduleTask, type ScheduleTaskStatus } from "../api/schedule";
import Layout from "../components/Layout";
import { MetricCard } from "../components/WorkspaceUI";
import ProjectWorkspaceNav from "../components/ProjectWorkspaceNav";
import { IconBack, IconChart, IconDownload, IconPlus, IconRefresh, IconTrash } from "../components/icons";

const DAY_MS = 86_400_000;
const STATUS_LABELS: Record<ScheduleTaskStatus, string> = { nao_iniciado: "Não iniciado", em_curso: "Em curso", bloqueado: "Bloqueado", concluido: "Concluído" };
const STATUS_COLORS: Record<ScheduleTaskStatus, string> = { nao_iniciado: "bg-slate-400", em_curso: "bg-blue-600", bloqueado: "bg-red-500", concluido: "bg-emerald-600" };
const PROGRESS_SOURCE_LABELS: Record<ScheduleTask["progressSource"], string> = {
  autos: "autos aprovados",
  diario: "diário de obra",
  manual: "actualização manual",
  planeamento: "planeamento",
  subactividades: "subactividades",
};

function today() { return new Date().toISOString().slice(0, 10); }
function fmtMoney(value: number, currency: string) { return new Intl.NumberFormat("pt-MZ", { style: "currency", currency, maximumFractionDigits: 0 }).format(value); }
function fmtDate(value: string | null) { return value ? new Intl.DateTimeFormat("pt-PT", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`)) : "—"; }
function daysBetween(start: string, end: string) { return Math.max(1, Math.round((new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) / DAY_MS) + 1); }
function dayOffset(start: string, end: string) { return Math.max(0, Math.round((new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) / DAY_MS)); }
function nextWorkingDay(date: string) {
  const value = new Date(`${date}T00:00:00Z`);
  do value.setUTCDate(value.getUTCDate() + 1); while (value.getUTCDay() === 0);
  return value.toISOString().slice(0, 10);
}

export default function ProjectSchedulePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [documents, setDocuments] = useState<BudgetDocument[]>([]);
  const [schedule, setSchedule] = useState<ProjectSchedule | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [setupOpen, setSetupOpen] = useState(false);
  const [documentId, setDocumentId] = useState("");
  const [startDate, setStartDate] = useState(today());
  const [duration, setDuration] = useState("180");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    if (!documentId) setDocumentId(documentData.find((document) => document.status === "aprovado" && document.currency === projectData.currency)?.id ?? documentData.find((document) => document.currency === projectData.currency)?.id ?? "");
    if (!scheduleData.tasks.length) setSetupOpen(true);
  }

  useEffect(() => { reload().catch((cause) => setError(cause instanceof Error ? cause.message : "Erro ao carregar cronograma")); }, [projectId]);

  async function handleGenerate(event: FormEvent) {
    event.preventDefault();
    if (!projectId || !documentId) return;
    if (schedule?.tasks.length && !window.confirm("Recriar substitui o cronograma actual, as subactividades e a linha de base. Continuar?")) return;
    setSaving(true); setError(null);
    try {
      const next = await scheduleApi.generate(projectId, { budgetDocumentId: documentId, startDate, totalDurationDays: Number(duration) });
      setSchedule(next); setSetupOpen(false); setSelectedId(next.tasks[0]?.id ?? null); setCollapsed(new Set());
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao gerar cronograma"); } finally { setSaving(false); }
  }

  async function handleAddRoot() {
    if (!projectId) return;
    const roots = schedule?.tasks.filter((task) => !task.parentId) ?? [];
    const previous = roots.at(-1);
    const start = previous ? nextWorkingDay(previous.endDate) : schedule?.startDate ?? today();
    setSaving(true); setError(null);
    try {
      const task = await scheduleApi.createTask(projectId, {
        code: String(roots.length + 1), name: "Nova actividade principal", startDate: start, durationDays: 5,
        predecessorTaskId: previous?.id ?? null,
      });
      await reload(); setSelectedId(task.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao criar actividade"); } finally { setSaving(false); }
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
    setSaving(true); setError(null);
    try {
      const task = await scheduleApi.createTask(projectId, {
        parentId: parent.id,
        code: `${parent.code}.${siblings.length + 1}`,
        name: "Nova subactividade",
        startDate: start,
        durationDays: 5,
        predecessorTaskId: previous?.id ?? null,
      });
      setCollapsed((current) => { const next = new Set(current); next.delete(parent.id); return next; });
      await reload(); setSelectedId(task.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao criar subactividade"); } finally { setSaving(false); }
  }

  const selected = schedule?.tasks.find((task) => task.id === selectedId) ?? null;
  const leafTasks = schedule?.tasks.filter((task) => !task.isSummary) ?? [];
  const visibleTasks = useMemo(() => schedule?.tasks.filter((task) => !task.parentId || !collapsed.has(task.parentId)) ?? [], [schedule?.tasks, collapsed]);
  const timeline = useMemo(() => {
    if (!schedule?.startDate || !schedule.endDate) return null;
    const totalDays = daysBetween(schedule.startDate, schedule.endDate);
    const width = Math.max(920, totalDays * 5.2);
    const markers: Array<{ label: string; left: number }> = [];
    const cursor = new Date(`${schedule.startDate}T00:00:00Z`); cursor.setUTCDate(1); cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    while (cursor.toISOString().slice(0, 10) <= schedule.endDate) {
      markers.push({ label: cursor.toLocaleDateString("pt-PT", { month: "short", year: "2-digit", timeZone: "UTC" }), left: dayOffset(schedule.startDate, cursor.toISOString().slice(0, 10)) / totalDays * 100 });
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return { width, totalDays, markers };
  }, [schedule?.startDate, schedule?.endDate]);

  function toggleCollapse(taskId: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId); else next.add(taskId);
      return next;
    });
  }

  if (!project || !schedule) return <div className="min-h-screen grid place-items-center text-slate-400">A carregar cronograma...</div>;

  return <Layout title={`Cronograma — ${project.name}`} subtitle="Planeamento WBS ligado ao orçamento, diário de obra, compras e autos de medição" actions={<><a className="btn btn-secondary btn-sm" href={schedule.tasks.length ? scheduleApi.exportPdfUrl(project.id) : undefined} aria-disabled={!schedule.tasks.length}><IconDownload className="h-4 w-4" /> PDF A3</a><Link className="btn btn-ghost btn-sm" to={`/projectos/${project.id}`}><IconBack className="h-4 w-4" /> Projecto</Link></>}>
    <div className="max-w-[1600px] space-y-5">
      <ProjectWorkspaceNav projectId={project.id} />
      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-lg font-semibold text-slate-950">Plano de execução</h2><p className="text-sm text-slate-500">Capítulos organizam a obra; subactividades recebem prazo, dependência e progresso real.</p></div>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-secondary btn-sm" onClick={() => setSetupOpen((value) => !value)}><IconRefresh className="h-4 w-4" /> Linha de base</button>
          <button className="btn btn-secondary btn-sm" onClick={handleAddSubtask} disabled={saving || !selected}><IconPlus className="h-4 w-4" /> Subactividade</button>
          <button className="btn btn-primary btn-sm" onClick={handleAddRoot} disabled={saving || !schedule.tasks.length}><IconPlus className="h-4 w-4" /> Actividade principal</button>
        </div>
      </div>

      {setupOpen && <form onSubmit={handleGenerate} className="card card-pad grid gap-4 md:grid-cols-[minmax(260px,1fr)_180px_160px_auto] items-end">
        <div><label className="label">Mapa de Quantidades de referência</label><select className="input" required value={documentId} onChange={(event) => setDocumentId(event.target.value)}><option value="">Seleccionar...</option>{documents.map((document) => <option key={document.id} value={document.id}>{document.title} · {document.status}</option>)}</select></div>
        <div><label className="label">Início planeado</label><input className="input" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></div>
        <div><label className="label">Prazo (dias úteis)</label><input className="input" type="number" min="7" value={duration} onChange={(event) => setDuration(event.target.value)} /></div>
        <button className="btn btn-primary" disabled={saving || !documentId}><IconChart className="h-4 w-4" /> {schedule.tasks.length ? "Recriar WBS e linha de base" : "Gerar cronograma"}</button>
      </form>}

      {schedule.tasks.length > 0 && <>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Execução física" value={`${schedule.overallProgress.toFixed(1)}%`} note={`${leafTasks.filter((task) => task.status === "concluido").length} de ${leafTasks.length} tarefas executáveis concluídas`} />
          <MetricCard label="Período" value={`${daysBetween(schedule.startDate!, schedule.endDate!)} dias`} note={`${fmtDate(schedule.startDate)} — ${fmtDate(schedule.endDate)}`} />
          <MetricCard label="Valor planeado" value={fmtMoney(schedule.plannedValue, project.currency)} note="Sem dupla contagem dos resumos" />
          <MetricCard label="Valor medido" value={fmtMoney(schedule.executedValue, project.currency)} note="Autos aprovados" />
        </div>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
            <span><strong className="text-slate-900">WBS activa:</strong> {schedule.tasks.filter((task) => !task.parentId).length} actividades principais · {schedule.tasks.filter((task) => task.parentId).length} subactividades</span>
            <span>Seleccione uma linha para editar ou criar uma subactividade.</span>
          </div>
          <div className="overflow-x-auto">
            <div style={{ width: 500 + timeline!.width }}>
              <div className="grid border-b border-slate-200 bg-slate-950 text-white" style={{ gridTemplateColumns: `500px ${timeline!.width}px` }}>
                <div className="grid grid-cols-[70px_1fr_74px_62px] items-center px-3 py-3 text-[11px] font-semibold uppercase tracking-wide"><span>WBS</span><span>Actividade</span><span>Duração</span><span>Exec.</span></div>
                <div className="relative border-l border-slate-700">{timeline!.markers.map((marker) => <span key={marker.label} className="absolute top-0 h-full border-l border-slate-600 px-2 py-3 text-[10px] uppercase tracking-wide" style={{ left: `${marker.left}%` }}>{marker.label}</span>)}</div>
              </div>
              {visibleTasks.map((task) => {
                const left = dayOffset(schedule.startDate!, task.startDate) / timeline!.totalDays * 100;
                const width = Math.max(1.2, daysBetween(task.startDate, task.endDate) / timeline!.totalDays * 100);
                const baselineLeft = task.baselineStartDate ? dayOffset(schedule.startDate!, task.baselineStartDate) / timeline!.totalDays * 100 : left;
                const baselineWidth = task.baselineStartDate && task.baselineEndDate ? daysBetween(task.baselineStartDate, task.baselineEndDate) / timeline!.totalDays * 100 : width;
                return <div key={task.id} role="button" tabIndex={0} onClick={() => setSelectedId(task.id)} onKeyDown={(event) => { if (event.key === "Enter") setSelectedId(task.id); }} className={`grid h-16 w-full cursor-pointer border-b text-left transition ${task.isSummary ? "border-slate-200 bg-slate-100/80" : "border-slate-100"} ${selectedId === task.id ? "ring-2 ring-inset ring-orange-400" : "hover:bg-orange-50/50"}`} style={{ gridTemplateColumns: `500px ${timeline!.width}px` }}>
                  <div className="grid grid-cols-[70px_1fr_74px_62px] items-center px-3">
                    <span className={`font-semibold ${task.isSummary ? "text-slate-950" : "text-blue-700"}`}>{task.code}</span>
                    <span className={`min-w-0 ${task.parentId ? "pl-7" : ""}`}>
                      <span className="flex items-center gap-2">
                        {task.isSummary && <button type="button" className="grid h-6 w-6 shrink-0 place-items-center rounded border border-slate-300 bg-white text-xs" aria-label={collapsed.has(task.id) ? "Mostrar subactividades" : "Ocultar subactividades"} onClick={(event) => { event.stopPropagation(); toggleCollapse(task.id); }}>{collapsed.has(task.id) ? "›" : "⌄"}</button>}
                        {!task.isSummary && task.parentId && <i className="h-px w-4 shrink-0 bg-slate-300" />}
                        <strong className={`block truncate text-sm ${task.isSummary ? "font-bold text-slate-950" : "font-medium text-slate-900"}`}>{task.name}</strong>
                      </span>
                      <small className={`block text-[11px] text-slate-500 ${task.parentId ? "pl-6" : task.isSummary ? "pl-8" : ""}`}>{fmtDate(task.startDate)} · {STATUS_LABELS[task.status]} · {PROGRESS_SOURCE_LABELS[task.progressSource]}</small>
                    </span>
                    <span className="text-xs tabular-nums text-slate-600">{task.durationDays} dias</span>
                    <span className="text-xs font-semibold tabular-nums text-slate-800">{task.progress.toFixed(0)}%</span>
                  </div>
                  <div className="relative border-l border-slate-200">
                    {timeline!.markers.map((marker) => <i key={marker.label} className="absolute inset-y-0 border-l border-dashed border-slate-200" style={{ left: `${marker.left}%` }} />)}
                    <span className={`absolute rounded bg-slate-300 ${task.isSummary ? "top-[17px] h-1" : "top-[19px] h-1"}`} style={{ left: `${baselineLeft}%`, width: `${baselineWidth}%` }} />
                    <span className={`absolute overflow-hidden rounded-md ${STATUS_COLORS[task.status]} bg-opacity-30 ${task.isSummary ? "top-[25px] h-3" : "top-[27px] h-5"}`} style={{ left: `${left}%`, width: `${width}%` }}><i className={`block h-full ${STATUS_COLORS[task.status]}`} style={{ width: `${Math.min(100, task.progress)}%` }} /></span>
                  </div>
                </div>;
              })}
            </div>
          </div>
        </section>

        {selected && <TaskEditor task={selected} tasks={schedule.tasks} onSaved={reload} onDeleted={async () => { setSelectedId(null); await reload(); }} setError={setError} />}
      </>}
      {!schedule.tasks.length && !setupOpen && <div className="card card-pad py-14 text-center"><IconChart className="mx-auto mb-3 h-10 w-10 text-blue-600" /><h3 className="text-lg font-semibold">Transforme o orçamento num plano executável</h3><p className="mx-auto mt-2 max-w-xl text-sm text-slate-500">O SIGA cria a WBS com actividades e subactividades, distribui o prazo pelo peso financeiro e estabelece a linha de base. Depois, Diário e Autos alimentam o progresso real.</p><button onClick={() => setSetupOpen(true)} className="btn btn-primary mt-5">Configurar cronograma</button></div>}
    </div>
  </Layout>;
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
    notes: task.notes ?? "",
  };
}

function TaskEditor({ task, tasks, onSaved, onDeleted, setError }: { task: ScheduleTask; tasks: ScheduleTask[]; onSaved: () => Promise<void>; onDeleted: () => Promise<void>; setError: (value: string | null) => void }) {
  const [form, setForm] = useState<EditorForm>(() => formFromTask(task));
  const [saving, setSaving] = useState(false);
  useEffect(() => setForm(formFromTask(task)), [task.id]);

  async function save(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(null);
    try {
      await scheduleApi.updateTask(task.id, {
        ...form,
        parentId: form.parentId || null,
        durationDays: Number(form.durationDays),
        manualProgress: task.isSummary ? null : Number(form.manualProgress),
        status: form.status,
        predecessorTaskId: form.predecessorTaskId || null,
        dependencyType: form.dependencyType as "FS" | "SS" | "FF" | "SF",
      });
      await onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao actualizar actividade"); } finally { setSaving(false); }
  }

  async function remove() {
    const detail = task.isSummary ? " As respectivas subactividades também serão eliminadas." : "";
    if (!window.confirm(`Eliminar a actividade “${task.name}”?${detail}`)) return;
    setSaving(true);
    try { await scheduleApi.deleteTask(task.id); await onDeleted(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao eliminar actividade"); } finally { setSaving(false); }
  }

  const parentOptions = tasks.filter((item) => !item.parentId && item.id !== task.id);
  return <form onSubmit={save} className="card card-pad space-y-4">
    <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-blue-700">{task.isSummary ? "Actividade principal" : task.parentId ? "Subactividade" : "Actividade"} · WBS {task.code}</p><h3 className="text-base font-semibold text-slate-950">Planeado, dependência e estado de campo</h3></div><button type="button" onClick={remove} className="btn btn-ghost btn-sm text-red-600"><IconTrash className="h-4 w-4" /> Eliminar</button></div>
    {task.isSummary && <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800"><strong>Resumo calculado automaticamente.</strong> Datas, duração, estado e progresso vêm das subactividades abaixo.</div>}
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-8">
      <div><label className="label">Código WBS</label><input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
      <div className="xl:col-span-2"><label className="label">Actividade</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
      <div><label className="label">Nível na WBS</label><select className="input" disabled={task.isSummary} value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })}><option value="">Actividade principal</option>{parentOptions.map((item) => <option key={item.id} value={item.id}>Sob {item.code} · {item.name}</option>)}</select></div>
      <div><label className="label">Início</label><input className="input" type="date" disabled={task.isSummary} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></div>
      <div><label className="label">Duração útil</label><input className="input" type="number" min="1" disabled={task.isSummary} value={form.durationDays} onChange={(e) => setForm({ ...form, durationDays: e.target.value })} /></div>
      <div><label className="label">Estado</label><select className="input" disabled={task.isSummary} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ScheduleTaskStatus })}>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      <div><label className="label">Progresso manual</label><input className="input" type="number" min="0" max="100" disabled={task.isSummary} value={form.manualProgress} onChange={(e) => setForm({ ...form, manualProgress: e.target.value })} /></div>
    </div>
    <div className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_160px_minmax(260px,2fr)_auto] items-end">
      <div><label className="label">Predecessora</label><select className="input" value={form.predecessorTaskId} onChange={(e) => setForm({ ...form, predecessorTaskId: e.target.value })}><option value="">Sem dependência</option>{tasks.filter((item) => item.id !== task.id).map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></div>
      <div><label className="label">Relação</label><select className="input" value={form.dependencyType} onChange={(e) => setForm({ ...form, dependencyType: e.target.value })}><option value="FS">Fim → Início</option><option value="SS">Início → Início</option><option value="FF">Fim → Fim</option><option value="SF">Início → Fim</option></select></div>
      <div><label className="label">Notas / restrições</label><input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Acesso, equipa, aprovação, fornecimento crítico..." /></div>
      <button className="btn btn-primary" disabled={saving}>{saving ? "A guardar..." : "Guardar actividade"}</button>
    </div>
  </form>;
}

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { boqApi, type BudgetDocument, type Project } from "../api/boq";
import { scheduleApi, type ProjectSchedule, type SchedulePaper, type SchedulePrintScale, type ScheduleTask, type ScheduleTaskStatus } from "../api/schedule";
import Layout from "../components/Layout";
import { MetricCard } from "../components/WorkspaceUI";
import ProjectWorkspaceNav from "../components/ProjectWorkspaceNav";
import Modal from "../components/Modal";
import PageSearch from "../components/PageSearch";
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
  // Vazio = duração calculada automaticamente a partir do trabalho real das composições (horas
  // de mão-de-obra ÷ equipa estimada) — nunca obrigamos o utilizador a adivinhar quantos dias a
  // obra vai demorar. Só preenche isto quem quiser substituir o cálculo por um prazo próprio.
  const [duration, setDuration] = useState("");
  const [manualDuration, setManualDuration] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [printPaper, setPrintPaper] = useState<SchedulePaper>("auto");
  const [printScale, setPrintScale] = useState<SchedulePrintScale>("fit");
  const [timelineZoom, setTimelineZoom] = useState<"compacto" | "normal" | "detalhe">("normal");
  const [taskQuery, setTaskQuery] = useState("");

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
    if (!projectId) return;
    if (!documentId) return;
    if (schedule?.tasks.length && !window.confirm("Recriar substitui o cronograma actual, as subactividades e a linha de base. Continuar?")) return;
    setSaving(true); setError(null);
    try {
      const next = await scheduleApi.generate(projectId, {
        budgetDocumentId: documentId,
        startDate,
        ...(manualDuration && duration ? { totalDurationDays: Number(duration) } : {}),
      });
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
  const timeline = useMemo(() => {
    if (!schedule?.startDate || !schedule.endDate) return null;
    const totalDays = daysBetween(schedule.startDate, schedule.endDate);
    const pixelsPerDay = { compacto: 3.2, normal: 5.2, detalhe: 8 }[timelineZoom];
    const width = Math.max(760, totalDays * pixelsPerDay);
    const markers: Array<{ label: string; left: number }> = [];
    const cursor = new Date(`${schedule.startDate}T00:00:00Z`); cursor.setUTCDate(1); cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    while (cursor.toISOString().slice(0, 10) <= schedule.endDate) {
      markers.push({ label: cursor.toLocaleDateString("pt-PT", { month: "short", year: "2-digit", timeZone: "UTC" }), left: dayOffset(schedule.startDate, cursor.toISOString().slice(0, 10)) / totalDays * 100 });
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return { width, totalDays, markers };
  }, [schedule?.startDate, schedule?.endDate, timelineZoom]);

  function toggleCollapse(taskId: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId); else next.add(taskId);
      return next;
    });
  }

  if (!project || !schedule) return <div className="min-h-screen grid place-items-center text-slate-400">A carregar cronograma...</div>;

  return <Layout title={`Cronograma — ${project.name}`} subtitle="Planeamento WBS ligado ao orçamento, diário de obra, compras e autos de medição" actions={<><div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1"><select className="h-7 rounded border-0 bg-transparent px-2 text-xs font-semibold text-slate-700 outline-none" aria-label="Formato do PDF" value={printPaper} onChange={(event) => setPrintPaper(event.target.value as SchedulePaper)}><option value="auto">Folha automática</option><option value="A3">A3</option><option value="A2">A2</option><option value="A1">A1</option></select><span className="h-5 border-l border-slate-200" /><select className="h-7 rounded border-0 bg-transparent px-2 text-xs font-semibold text-slate-700 outline-none" aria-label="Escala do PDF" value={printScale} onChange={(event) => setPrintScale(event.target.value === "fit" ? "fit" : Number(event.target.value) as SchedulePrintScale)}><option value="fit">Ajustar à folha</option><option value="100">Escala 100%</option><option value="85">Escala 85%</option><option value="70">Escala 70%</option><option value="55">Escala 55%</option></select></div><a className={`btn btn-secondary btn-sm ${!schedule.tasks.length ? "pointer-events-none opacity-50" : ""}`} href={schedule.tasks.length ? scheduleApi.exportPdfUrl(project.id, { paper: printPaper, scale: printScale }) : undefined} aria-disabled={!schedule.tasks.length}><IconDownload className="h-4 w-4" /> Exportar PDF</a><Link className="btn btn-ghost btn-sm" to={`/projectos/${project.id}`}><IconBack className="h-4 w-4" /> Projecto</Link></>}>
    <div className="mx-auto w-full max-w-[1500px] space-y-5">
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

      {setupOpen && <form onSubmit={handleGenerate} className="card card-pad space-y-4">
        <div className="grid gap-4 md:grid-cols-[minmax(260px,1fr)_180px_auto] items-end">
          <div><label className="label">Mapa de Quantidades de referência</label><select className="input" required value={documentId} onChange={(event) => setDocumentId(event.target.value)}><option value="">Seleccionar...</option>{documents.map((document) => <option key={document.id} value={document.id}>{document.title} · {document.status}</option>)}</select></div>
          <div><label className="label">Início planeado</label><input className="input" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></div>
          <button className="btn btn-primary" disabled={saving || !documentId}><IconChart className="h-4 w-4" /> {schedule.tasks.length ? "Recriar WBS e linha de base" : "Gerar cronograma"}</button>
        </div>
        <p className="text-xs text-slate-500">A duração é calculada automaticamente a partir das horas de mão-de-obra das composições e das quantidades medidas — não precisa de indicar quantos dias a obra vai demorar.</p>
        {!manualDuration ? (
          <button type="button" className="text-xs font-semibold text-blue-700 hover:underline" onClick={() => setManualDuration(true)}>Substituir por um prazo próprio</button>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <div><label className="label">Prazo total (dias úteis)</label><input className="input w-40" type="number" min="7" value={duration} onChange={(event) => setDuration(event.target.value)} /></div>
            <button type="button" className="text-xs font-semibold text-slate-500 hover:underline" onClick={() => { setManualDuration(false); setDuration(""); }}>Voltar ao cálculo automático</button>
          </div>
        )}
      </form>}

      {schedule.tasks.length > 0 && <>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Execução física" value={`${schedule.overallProgress.toFixed(1)}%`} note={`${leafTasks.filter((task) => task.status === "concluido").length} de ${leafTasks.length} tarefas executáveis concluídas`} />
          <MetricCard label="Período" value={`${daysBetween(schedule.startDate!, schedule.endDate!)} dias`} note={`${fmtDate(schedule.startDate)} — ${fmtDate(schedule.endDate)}`} />
          <MetricCard label="Valor planeado" value={fmtMoney(schedule.plannedValue, project.currency)} note="Sem dupla contagem dos resumos" />
          <MetricCard label="Valor medido" value={fmtMoney(schedule.executedValue, project.currency)} note="Autos aprovados" />
        </div>

        <PageSearch
          value={taskQuery}
          onChange={setTaskQuery}
          placeholder="Pesquisar actividade, código, estado ou nota…"
          resultLabel={`${visibleTasks.length} actividade(s) visível(is)`}
        />

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
            <div><p className="text-xs font-semibold text-slate-900">Estrutura analítica da obra</p><p className="mt-0.5 text-[11px] text-slate-500">{schedule.tasks.filter((task) => !task.parentId).length} actividades principais · {schedule.tasks.filter((task) => task.parentId).length} {schedule.tasks.filter((task) => task.parentId).length === 1 ? "subactividade executável" : "subactividades executáveis"}</p></div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button type="button" className="rounded-lg border border-slate-200 bg-white px-3 py-2 font-semibold text-slate-600 hover:border-slate-400" onClick={() => setCollapsed(new Set())}>Expandir tudo</button>
              <button type="button" className="rounded-lg border border-slate-200 bg-white px-3 py-2 font-semibold text-slate-600 hover:border-slate-400" onClick={() => setCollapsed(new Set(schedule.tasks.filter((task) => task.isSummary).map((task) => task.id)))}>Recolher fases</button>
              <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-600">Escala temporal<select className="border-0 bg-transparent py-0 text-xs font-bold text-slate-900 outline-none" value={timelineZoom} onChange={(event) => setTimelineZoom(event.target.value as typeof timelineZoom)}><option value="compacto">Compacta</option><option value="normal">Normal</option><option value="detalhe">Detalhada</option></select></label>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-2 text-[10px] font-semibold text-slate-500"><span>Seleccione o nome ou a barra para abrir os detalhes da actividade.</span><span className="flex flex-wrap gap-4"><i className="not-italic"><b className="mr-1 inline-block h-1 w-5 bg-slate-400 align-middle" /> Linha de base</i><i className="not-italic"><b className="mr-1 inline-block h-2.5 w-5 rounded bg-blue-600 align-middle" /> Execução</i><i className="not-italic"><b className="mr-1 inline-block h-2 w-5 bg-slate-900 align-middle" /> Fase-resumo</i></span></div>
          <div className="divide-y divide-slate-100 md:hidden">
            {visibleTasks.map((task) => {
              const childCount = task.isSummary ? schedule.tasks.filter((child) => child.parentId === task.id).length : 0;
              return <div key={`mobile-${task.id}`} className={`p-4 ${task.isSummary ? "bg-slate-50" : "bg-white"}`}>
                <div className="flex items-start gap-3">
                  {task.isSummary && <button type="button" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-slate-300 bg-white font-black text-slate-600" onClick={() => toggleCollapse(task.id)} aria-label={collapsed.has(task.id) ? "Mostrar subactividades" : "Ocultar subactividades"}>{collapsed.has(task.id) ? "+" : "−"}</button>}
                  <button type="button" className={`min-w-0 flex-1 text-left ${task.parentId ? "pl-4" : ""}`} onClick={() => setSelectedId(task.id)}><span className="text-xs font-bold text-blue-700">{task.code}</span><strong className={`mt-0.5 block text-sm text-slate-950 ${task.isSummary ? "uppercase" : ""}`}>{task.name}</strong><span className="mt-1 block text-xs text-slate-500">{task.isSummary ? `${childCount} subactividade${childCount === 1 ? "" : "s"}` : `${fmtDate(task.startDate)} — ${fmtDate(task.endDate)} · ${task.durationDays} d`}</span></button>
                  <button type="button" className="btn btn-secondary btn-sm shrink-0" onClick={() => setSelectedId(task.id)}>Editar</button>
                </div>
                <div className="mt-3 flex items-center gap-3"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200"><i className={`block h-full ${STATUS_COLORS[task.status]}`} style={{ width: `${Math.min(100, task.progress)}%` }} /></div><span className="w-10 text-right text-xs font-bold tabular-nums">{task.progress.toFixed(0)}%</span></div>
              </div>;
            })}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <div style={{ width: 600 + timeline!.width }}>
              <div className="sticky top-0 z-10 grid border-b border-slate-200 bg-slate-950 text-white" style={{ gridTemplateColumns: `600px ${timeline!.width}px` }}>
                <div className="grid grid-cols-[64px_minmax(260px,1fr)_82px_104px] items-center px-3 py-3 text-[10px] font-semibold uppercase tracking-[.08em]"><span>WBS</span><span>Actividade</span><span>Duração</span><span>Execução</span></div>
                <div className="relative border-l border-slate-700">{timeline!.markers.map((marker) => <span key={marker.label} className="absolute inset-y-0 border-l border-slate-600 px-2 py-3 text-[9px] font-bold uppercase tracking-wide" style={{ left: `${marker.left}%` }}>{marker.label}</span>)}</div>
              </div>
              {visibleTasks.map((task) => {
                const left = dayOffset(schedule.startDate!, task.startDate) / timeline!.totalDays * 100;
                const width = Math.max(1.2, daysBetween(task.startDate, task.endDate) / timeline!.totalDays * 100);
                const baselineLeft = task.baselineStartDate ? dayOffset(schedule.startDate!, task.baselineStartDate) / timeline!.totalDays * 100 : left;
                const baselineWidth = task.baselineStartDate && task.baselineEndDate ? daysBetween(task.baselineStartDate, task.baselineEndDate) / timeline!.totalDays * 100 : width;
                const childCount = task.isSummary ? schedule.tasks.filter((child) => child.parentId === task.id).length : 0;
                const selectedRow = selectedId === task.id;
                const rowHeight = task.isSummary ? 48 : 52;
                const currentDay = today();
                const todayVisible = currentDay >= schedule.startDate! && currentDay <= schedule.endDate!;
                const todayLeft = todayVisible ? dayOffset(schedule.startDate!, currentDay) / timeline!.totalDays * 100 : 0;
                return <div key={task.id} className={`grid w-full border-b transition ${task.isSummary ? "border-slate-200 bg-[#f2f5f8]" : "border-slate-100 bg-white hover:bg-orange-50/30"} ${selectedRow ? "shadow-[inset_4px_0_0_#ed6c22]" : ""}`} style={{ gridTemplateColumns: `600px ${timeline!.width}px`, height: rowHeight }}>
                  <div className="grid grid-cols-[64px_minmax(260px,1fr)_82px_104px] items-center px-3">
                    <span className={`text-xs font-bold tabular-nums ${task.isSummary ? "text-slate-700" : "text-blue-700"}`}>{task.code}</span>
                    <div className={`relative min-w-0 ${task.parentId ? "pl-8" : ""}`}>
                      {task.parentId && <span className="absolute -bottom-4 -top-4 left-2 w-4 border-b border-l border-slate-300" />}
                      <div className="relative flex items-center gap-2">
                        {task.isSummary && <button type="button" className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-slate-300 bg-white text-xs font-black text-slate-600 shadow-sm" aria-label={collapsed.has(task.id) ? "Mostrar subactividades" : "Ocultar subactividades"} onClick={() => toggleCollapse(task.id)}>{collapsed.has(task.id) ? "+" : "−"}</button>}
                        <button type="button" className={`min-w-0 truncate text-left text-xs ${task.isSummary ? "font-black uppercase tracking-[.025em] text-slate-950" : "font-semibold text-slate-900"}`} onClick={() => setSelectedId(task.id)}>{task.name}</button>
                      </div>
                      <p className={`relative mt-0.5 truncate text-[9px] text-slate-500 ${task.isSummary ? "pl-8" : ""}`}>{task.isSummary ? `${childCount} subactividade${childCount === 1 ? "" : "s"} · resumo automático` : `${fmtDate(task.startDate)} · ${STATUS_LABELS[task.status]} · ${PROGRESS_SOURCE_LABELS[task.progressSource]}`}</p>
                    </div>
                    <span className="text-[11px] font-semibold tabular-nums text-slate-600">{task.durationDays} d</span>
                    <div className="pr-3"><div className="flex items-center justify-between text-[10px] font-bold"><span>{task.progress.toFixed(0)}%</span><i className={`h-2 w-2 rounded-full ${STATUS_COLORS[task.status]}`} /></div><div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-200"><i className={`block h-full ${STATUS_COLORS[task.status]}`} style={{ width: `${Math.min(100, task.progress)}%` }} /></div></div>
                  </div>
                  <button type="button" aria-label={`Editar ${task.name}`} onClick={() => setSelectedId(task.id)} className={`relative block border-l border-slate-200 text-left ${selectedRow ? "bg-orange-50/40" : ""}`}>
                    {timeline!.markers.map((marker) => <i key={marker.label} className="absolute inset-y-0 border-l border-dashed border-slate-200" style={{ left: `${marker.left}%` }} />)}
                    {todayVisible && <i className="absolute inset-y-0 z-[1] border-l border-red-400" style={{ left: `${todayLeft}%` }}><span className="absolute -left-1 top-1 h-2 w-2 rounded-full bg-red-500" /></i>}
                    <span className="absolute h-1 rounded bg-slate-300" style={{ left: `${baselineLeft}%`, width: `${baselineWidth}%`, top: task.isSummary ? 15 : 14 }} />
                    {task.isSummary
                      ? <span className="absolute h-2 bg-slate-400" style={{ left: `${left}%`, width: `${width}%`, top: 23 }}><i className="block h-full bg-slate-900" style={{ width: `${Math.min(100, task.progress)}%` }} /><b className="absolute -left-1 -top-1 h-4 w-1 bg-slate-900" /><b className="absolute -right-1 -top-1 h-4 w-1 bg-slate-900" /></span>
                      : <span className={`absolute h-4 overflow-hidden rounded ${STATUS_COLORS[task.status]} bg-opacity-25`} style={{ left: `${left}%`, width: `${width}%`, top: 22 }}><i className={`block h-full ${STATUS_COLORS[task.status]}`} style={{ width: `${Math.min(100, task.progress)}%` }} /></span>}
                  </button>
                </div>;
              })}
            </div>
          </div>
        </section>

        {selected && <TaskEditor task={selected} tasks={schedule.tasks} onClose={() => setSelectedId(null)} onSaved={async () => { setSelectedId(null); await reload(); }} onDeleted={async () => { setSelectedId(null); await reload(); }} setError={setError} />}
      </>}
      {!schedule.tasks.length && !setupOpen && <div className="card card-pad py-14 text-center"><IconChart className="mx-auto mb-3 h-10 w-10 text-blue-600" /><h3 className="text-lg font-semibold">Transforme o orçamento num plano executável</h3><p className="mx-auto mt-2 max-w-xl text-sm text-slate-500">O SIGO cria a WBS com actividades e subactividades, distribui o prazo pelo peso financeiro e estabelece a linha de base. Depois, Diário e Autos alimentam o progresso real.</p><button onClick={() => setSetupOpen(true)} className="btn btn-primary mt-5">Configurar cronograma</button></div>}
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

function TaskEditor({ task, tasks, onClose, onSaved, onDeleted, setError }: { task: ScheduleTask; tasks: ScheduleTask[]; onClose: () => void; onSaved: () => Promise<void>; onDeleted: () => Promise<void>; setError: (value: string | null) => void }) {
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
  return <Modal title={task.name} subtitle={`${task.isSummary ? "Fase-resumo" : task.parentId ? "Subactividade" : "Actividade"} · WBS ${task.code}`} onClose={onClose} maxWidth="max-w-5xl"><form onSubmit={save}>
    <div className="mb-4 flex justify-end"><button type="button" onClick={remove} className="btn btn-ghost btn-sm text-red-600"><IconTrash className="h-4 w-4" /> Eliminar</button></div>
    {task.isSummary && <div className="mb-5 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800"><strong>Fase calculada pelas subactividades.</strong> O período, o estado e o progresso deste resumo são agregados automaticamente; edite apenas o código e o nome.</div>}
    <div className="grid gap-5 lg:grid-cols-[1.08fr_.92fr]">
      <fieldset className="rounded-xl border border-slate-200 bg-slate-50/70 p-4"><legend className="px-2 text-xs font-bold uppercase tracking-[.08em] text-slate-500">Estrutura e execução</legend><div className="grid gap-3 sm:grid-cols-2">
        <div><label className="label">Código WBS</label><input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
        <div><label className="label">Nível na WBS</label><select className="input" disabled={task.isSummary} value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })}><option value="">Actividade principal</option>{parentOptions.map((item) => <option key={item.id} value={item.id}>Sob {item.code} · {item.name}</option>)}</select></div>
        <div className="sm:col-span-2"><label className="label">Nome da actividade</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div><label className="label">Início planeado</label><input className="input" type="date" disabled={task.isSummary} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></div>
        <div><label className="label">Duração (dias úteis)</label><input className="input" type="number" min="1" disabled={task.isSummary} value={form.durationDays} onChange={(e) => setForm({ ...form, durationDays: e.target.value })} /></div>
        <div><label className="label">Estado no campo</label><select className="input" disabled={task.isSummary} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ScheduleTaskStatus })}>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
        <div><label className="label">Progresso manual (%)</label><input className="input" type="number" min="0" max="100" disabled={task.isSummary} value={form.manualProgress} onChange={(e) => setForm({ ...form, manualProgress: e.target.value })} /></div>
      </div></fieldset>
      <fieldset className="rounded-xl border border-slate-200 p-4"><legend className="px-2 text-xs font-bold uppercase tracking-[.08em] text-slate-500">Dependência e restrições</legend><div className="space-y-3">
        <div><label className="label">Actividade predecessora</label><select className="input" value={form.predecessorTaskId} onChange={(e) => setForm({ ...form, predecessorTaskId: e.target.value })}><option value="">Sem dependência</option>{tasks.filter((item) => item.id !== task.id).map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></div>
        <div><label className="label">Relação entre actividades</label><select className="input" value={form.dependencyType} onChange={(e) => setForm({ ...form, dependencyType: e.target.value })}><option value="FS">Fim → Início</option><option value="SS">Início → Início</option><option value="FF">Fim → Fim</option><option value="SF">Início → Fim</option></select></div>
        <div><label className="label">Notas / restrições</label><textarea className="input min-h-24 resize-y py-3" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Acesso, equipa, aprovação, fornecimento crítico..." /></div>
      </div></fieldset>
    </div>
    <div className="mt-5 flex flex-col-reverse gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-slate-500">Diário de Obra e Autos aprovados podem substituir o progresso manual.</p><div className="flex gap-2"><button type="button" onClick={onClose} className="btn btn-secondary flex-1 sm:flex-none">Cancelar</button><button className="btn btn-primary flex-1 sm:flex-none" disabled={saving}>{saving ? "A guardar..." : "Guardar alterações"}</button></div></div>
  </form></Modal>;
}

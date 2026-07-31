import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode, type UIEvent } from "react";
import type { ScheduleTask, ScheduleTaskInput, ScheduleTaskStatus } from "../api/schedule";
import { scheduleApi } from "../api/schedule";
import { workingDaysInclusive, workingDayOffset, calendarDaysInclusive } from "@sigo/shared";
import {
  formatPredecessorLabel,
  parsePredecessorInput,
  validateSchedule,
} from "../utils/scheduleValidation";

const DAY_MS = 86_400_000;
const ROW_H = 36;
const HEAD_H = 40;

const STATUS_LABELS: Record<ScheduleTaskStatus, string> = {
  nao_iniciado: "Não iniciado",
  em_curso: "Em curso",
  bloqueado: "Bloqueado",
  concluido: "Concluído",
};

const STATUS_PILL: Record<ScheduleTaskStatus, string> = {
  nao_iniciado: "bg-slate-100 text-slate-600",
  em_curso: "bg-brand-50 text-brand-700",
  bloqueado: "bg-red-50 text-red-700",
  concluido: "bg-emerald-50 text-emerald-700",
};

const BAR_FILL: Record<ScheduleTaskStatus, string> = {
  nao_iniciado: "bg-slate-400",
  em_curso: "bg-brand-500",
  bloqueado: "bg-red-500",
  concluido: "bg-emerald-500",
};

type EditCell = "name" | "duration" | "start" | "end" | "predecessors" | "progress" | "status" | "code";
type Zoom = "compacto" | "normal" | "detalhe";

type Props = {
  tasks: ScheduleTask[];
  visibleTasks: ScheduleTask[];
  scheduleStart: string;
  scheduleEnd: string;
  selectedId: string | null;
  collapsed: Set<string>;
  timelineZoom: Zoom;
  onTimelineZoom: (z: Zoom) => void;
  onSelect: (id: string) => void;
  onToggleCollapse: (id: string) => void;
  onExpandAll: () => void;
  onCollapsePhases: () => void;
  onChanged: () => Promise<void>;
  onError: (message: string | null) => void;
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function fmtDate(value: string) {
  const [y, m, d] = value.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

function CellInput({
  value,
  type = "text",
  onCommit,
  onCancel,
}: {
  value: string;
  type?: string;
  onCommit: (next: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      type={type}
      className="h-7 w-full rounded border border-blue-400 bg-white px-1.5 text-[12px] outline-none ring-2 ring-blue-100"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onCommit(draft);
        }
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
    />
  );
}

function SheetCell({
  children,
  onEdit,
  align = "left",
  className = "",
}: {
  children: ReactNode;
  onEdit?: () => void;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <td
      className={`border-b border-slate-100 px-2 align-middle ${align === "right" ? "text-right" : "text-left"} ${onEdit ? "cursor-text" : ""} ${className}`}
      style={{ height: ROW_H }}
      onDoubleClick={onEdit}
    >
      {children}
    </td>
  );
}

export default function ScheduleWorkspace({
  tasks,
  visibleTasks,
  scheduleStart,
  scheduleEnd,
  selectedId,
  collapsed,
  timelineZoom,
  onTimelineZoom,
  onSelect,
  onToggleCollapse,
  onExpandAll,
  onCollapsePhases,
  onChanged,
  onError,
}: Props) {
  const [editing, setEditing] = useState<{ id: string; cell: EditCell } | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [validationOpen, setValidationOpen] = useState(false);
  const [sheetWidth, setSheetWidth] = useState(52); // %
  const sheetScrollRef = useRef<HTMLDivElement>(null);
  const ganttScrollRef = useRef<HTMLDivElement>(null);
  const syncing = useRef<"sheet" | "gantt" | null>(null);

  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const issues = useMemo(() => validateSchedule(tasks), [tasks]);
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;

  const rowIndex = useMemo(() => {
    const map = new Map<string, number>();
    visibleTasks.forEach((t, i) => map.set(t.id, i + 1));
    return map;
  }, [visibleTasks]);

  const timeline = useMemo(() => {
    const totalWorkingDays = workingDaysInclusive(scheduleStart, scheduleEnd);
    const totalCalendarDays = calendarDaysInclusive(scheduleStart, scheduleEnd);
    const pixelsPerDay = { compacto: 5, normal: 8, detalhe: 14 }[timelineZoom];
    const width = Math.max(480, totalWorkingDays * pixelsPerDay);
    const markers: Array<{ label: string; left: number }> = [];
    const weekendBands: Array<{ left: number; width: number }> = [];
    const cursor = new Date(`${scheduleStart}T00:00:00Z`);
    const end = new Date(`${scheduleEnd}T00:00:00Z`);
    while (cursor <= end) {
      if (cursor.getUTCDay() === 0) {
        const calOffset = Math.round((cursor.getTime() - new Date(`${scheduleStart}T00:00:00Z`).getTime()) / DAY_MS);
        weekendBands.push({ left: (calOffset / totalCalendarDays) * 100, width: (1 / totalCalendarDays) * 100 });
      }
      if (cursor.getUTCDate() === 1) {
        markers.push({
          label: cursor.toLocaleDateString("pt-PT", { month: "short", year: "2-digit", timeZone: "UTC" }),
          left: (workingDayOffset(scheduleStart, cursor.toISOString().slice(0, 10)) / Math.max(1, totalWorkingDays - 1)) * 100,
        });
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    const current = today();
    const todayVisible = current >= scheduleStart && current <= scheduleEnd;
    const todayLeft = todayVisible
      ? (workingDayOffset(scheduleStart, current) / Math.max(1, totalWorkingDays - 1)) * 100
      : null;
    return { width, totalWorkingDays, markers, weekendBands, todayLeft };
  }, [scheduleStart, scheduleEnd, timelineZoom]);

  function onSheetScroll(e: UIEvent<HTMLDivElement>) {
    if (syncing.current === "gantt") return;
    syncing.current = "sheet";
    if (ganttScrollRef.current) ganttScrollRef.current.scrollTop = e.currentTarget.scrollTop;
    requestAnimationFrame(() => {
      syncing.current = null;
    });
  }

  function onGanttScroll(e: UIEvent<HTMLDivElement>) {
    if (syncing.current === "sheet") return;
    syncing.current = "gantt";
    if (sheetScrollRef.current) sheetScrollRef.current.scrollTop = e.currentTarget.scrollTop;
    requestAnimationFrame(() => {
      syncing.current = null;
    });
  }

  async function savePatch(task: ScheduleTask, patch: ScheduleTaskInput) {
    setSavingId(task.id);
    onError(null);
    try {
      await scheduleApi.updateTask(task.id, patch);
      setEditing(null);
      await onChanged();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Erro ao actualizar actividade");
    } finally {
      setSavingId(null);
    }
  }

  async function commitCell(task: ScheduleTask, cell: EditCell, raw: string) {
    const value = raw.trim();
    if (task.isSummary && !["name", "code"].includes(cell)) return setEditing(null);
    try {
      if (cell === "name") {
        if (!value || value === task.name) return setEditing(null);
        return void savePatch(task, { name: value });
      }
      if (cell === "code") {
        if (!value || value === task.code) return setEditing(null);
        return void savePatch(task, { code: value });
      }
      if (cell === "duration") {
        const days = Number(value);
        if (!Number.isFinite(days) || days < 1) throw new Error("Duração deve ser ≥ 1 dia útil");
        if (days === task.durationDays) return setEditing(null);
        return void savePatch(task, { startDate: task.startDate, durationDays: days });
      }
      if (cell === "start") {
        if (!value || value === task.startDate) return setEditing(null);
        return void savePatch(task, { startDate: value, durationDays: task.durationDays });
      }
      if (cell === "end") {
        if (!value || value === task.endDate) return setEditing(null);
        if (value < task.startDate) throw new Error("A data final não pode ser anterior ao início");
        return void savePatch(task, { startDate: task.startDate, endDate: value });
      }
      if (cell === "progress") {
        const pct = Number(value);
        if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new Error("Progresso entre 0 e 100");
        return void savePatch(task, { manualProgress: pct });
      }
      if (cell === "status") {
        if (value === task.status) return setEditing(null);
        return void savePatch(task, { status: value as ScheduleTaskStatus });
      }
      if (cell === "predecessors") {
        const parsed = parsePredecessorInput(value, tasks, task.id);
        if ("error" in parsed) throw new Error(parsed.error);
        const same =
          (parsed.predecessorTaskId ?? null) === (task.predecessorTaskId ?? null) &&
          parsed.dependencyType === (task.dependencyType ?? "FS") &&
          parsed.lagDays === (task.lagDays ?? 0);
        if (same) return setEditing(null);
        return void savePatch(task, {
          predecessorTaskId: parsed.predecessorTaskId,
          dependencyType: parsed.dependencyType,
          lagDays: parsed.lagDays,
        });
      }
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Valor inválido");
      setEditing(null);
    }
  }

  function startEdit(task: ScheduleTask, cell: EditCell) {
    onSelect(task.id);
    if (task.isSummary && !["name", "code"].includes(cell)) return;
    setEditing({ id: task.id, cell });
  }

  function focusIssue(taskId: string) {
    onSelect(taskId);
    requestAnimationFrame(() => {
      document.getElementById(`sched-row-${taskId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  // Drag resize divider
  function startResize(e: ReactMouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sheetWidth;
    function move(ev: MouseEvent) {
      const delta = ((ev.clientX - startX) / window.innerWidth) * 100;
      setSheetWidth(Math.min(70, Math.max(32, startW + delta)));
    }
    function up() {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-gradient-to-b from-slate-50 to-white px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:border-slate-300" onClick={onExpandAll}>
            Expandir
          </button>
          <button type="button" className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:border-slate-300" onClick={onCollapsePhases}>
            Recolher fases
          </button>
          <span className="mx-1 hidden h-4 w-px bg-slate-200 sm:block" />
          <label className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600">
            Escala
            <select
              className="border-0 bg-transparent text-[11px] font-bold text-slate-900 outline-none"
              value={timelineZoom}
              onChange={(e) => onTimelineZoom(e.target.value as Zoom)}
            >
              <option value="compacto">Compacta</option>
              <option value="normal">Normal</option>
              <option value="detalhe">Detalhada</option>
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="hidden items-center gap-3 text-[10px] font-medium text-slate-500 md:flex">
            <span className="inline-flex items-center gap-1"><i className="h-1.5 w-4 rounded-sm bg-slate-300" /> Linha de base</span>
            <span className="inline-flex items-center gap-1"><i className="h-2 w-4 rounded-sm bg-brand-500" /> Execução</span>
            <span className="inline-flex items-center gap-1"><i className="h-3 w-px bg-red-500" /> Hoje</span>
          </div>
          <button
            type="button"
            onClick={() => setValidationOpen((v) => !v)}
            className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold ${
              errors + warnings === 0
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-amber-200 bg-amber-50 text-amber-900"
            }`}
          >
            {errors + warnings === 0 ? "Validação OK" : `${errors} erros · ${warnings} avisos`}
          </button>
        </div>
      </div>

      {validationOpen && (
        <div className="border-b border-slate-200 bg-slate-50 px-3 py-2">
          {issues.length === 0 ? (
            <p className="text-[12px] text-emerald-800">Cronograma válido — sem problemas de lógica ou datas.</p>
          ) : (
            <ul className="max-h-24 space-y-0.5 overflow-y-auto">
              {issues.slice(0, 8).map((issue) => (
                <li key={issue.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-[11px] hover:bg-white"
                    onClick={() => issue.taskId && focusIssue(issue.taskId)}
                  >
                    <span
                      className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-bold uppercase ${
                        issue.severity === "error" ? "bg-red-100 text-red-700" : issue.severity === "warning" ? "bg-amber-100 text-amber-800" : "bg-slate-200 text-slate-600"
                      }`}
                    >
                      {issue.code}
                    </span>
                    <span className="truncate text-slate-700">
                      {issue.taskCode && <span className="mr-1 font-mono text-slate-500">{issue.taskCode}</span>}
                      {issue.message}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Split workspace */}
      <div className="relative flex min-h-[420px] max-h-[min(70vh,720px)]">
        {/* Sheet pane */}
        <div className="flex min-w-0 flex-col border-r border-slate-200" style={{ width: `${sheetWidth}%` }}>
          <div className="shrink-0 border-b border-slate-200 bg-slate-50/90 px-3 text-[10px] font-semibold uppercase tracking-wide text-slate-500" style={{ height: HEAD_H, lineHeight: `${HEAD_H}px` }}>
            Folha de tarefas · duplo clique para editar
          </div>
          <div ref={sheetScrollRef} onScroll={onSheetScroll} className="min-h-0 flex-1 overflow-auto">
            <table className="w-full min-w-[620px] table-fixed border-collapse text-[12px]">
              <colgroup>
                <col className="w-9" />
                <col className="w-12" />
                <col />
                <col className="w-14" />
                <col className="w-[70px]" />
                <col className="w-[70px]" />
                <col className="w-[72px]" />
                <col className="w-14" />
                <col className="w-[96px]" />
              </colgroup>
              <thead className="sticky top-0 z-[1]">
                <tr className="bg-slate-100 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  <th className="border-b border-slate-200 px-1.5 py-2 text-right">#</th>
                  <th className="border-b border-slate-200 px-1.5 py-2 text-left">WBS</th>
                  <th className="border-b border-slate-200 px-1.5 py-2 text-left">Nome</th>
                  <th className="border-b border-slate-200 px-1.5 py-2 text-right">Dur.</th>
                  <th className="border-b border-slate-200 px-1.5 py-2 text-left">Início</th>
                  <th className="border-b border-slate-200 px-1.5 py-2 text-left">Fim</th>
                  <th className="border-b border-slate-200 px-1.5 py-2 text-left">Pred.</th>
                  <th className="border-b border-slate-200 px-1.5 py-2 text-right">%</th>
                  <th className="border-b border-slate-200 px-1.5 py-2 text-left">Estado</th>
                </tr>
              </thead>
              <tbody>
                {visibleTasks.map((task) => {
                  const selected = selectedId === task.id;
                  const cell = editing?.id === task.id ? editing.cell : null;
                  const predLabel = formatPredecessorLabel(task, byId);
                  return (
                    <tr
                      key={task.id}
                      id={`sched-row-${task.id}`}
                      onClick={() => onSelect(task.id)}
                      className={`${savingId === task.id ? "opacity-50" : ""} ${
                        selected ? "bg-brand-50" : task.isSummary ? "bg-slate-50" : "bg-white hover:bg-slate-50/80"
                      } ${selected ? "shadow-[inset_3px_0_0_#3b82f6]" : ""}`}
                    >
                      <SheetCell align="right" className="text-[11px] tabular-nums text-slate-400">
                        {rowIndex.get(task.id)}
                      </SheetCell>
                      <SheetCell onEdit={() => startEdit(task, "code")}>
                        {cell === "code" ? (
                          <CellInput value={task.code} onCommit={(v) => void commitCell(task, "code", v)} onCancel={() => setEditing(null)} />
                        ) : (
                          <span className={`font-mono text-[11px] font-semibold ${task.isSummary ? "text-slate-700" : "text-brand-700"}`}>{task.code}</span>
                        )}
                      </SheetCell>
                      <SheetCell onEdit={() => startEdit(task, "name")} className="!whitespace-normal">
                        {cell === "name" ? (
                          <div style={{ paddingLeft: task.parentId ? 16 : 0 }}>
                            <CellInput value={task.name} onCommit={(v) => void commitCell(task, "name", v)} onCancel={() => setEditing(null)} />
                          </div>
                        ) : (
                          <div className="flex min-w-0 items-center gap-1" style={{ paddingLeft: task.parentId ? 16 : 0 }}>
                            {task.isSummary ? (
                              <button
                                type="button"
                                className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-slate-300 bg-white text-[10px] text-slate-600 hover:border-blue-400"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onToggleCollapse(task.id);
                                }}
                              >
                                {collapsed.has(task.id) ? "▸" : "▾"}
                              </button>
                            ) : (
                              <span className="inline-block h-5 w-5 shrink-0" />
                            )}
                            <span className={`min-w-0 truncate ${task.isSummary ? "font-semibold text-slate-900" : "text-slate-700"}`} title={task.name}>
                              {task.name}
                            </span>
                          </div>
                        )}
                      </SheetCell>
                      <SheetCell align="right" onEdit={() => startEdit(task, "duration")}>
                        {cell === "duration" ? (
                          <CellInput type="number" value={String(task.durationDays)} onCommit={(v) => void commitCell(task, "duration", v)} onCancel={() => setEditing(null)} />
                        ) : (
                          <span className="tabular-nums text-slate-600">{task.durationDays}d</span>
                        )}
                      </SheetCell>
                      <SheetCell onEdit={() => startEdit(task, "start")}>
                        {cell === "start" ? (
                          <CellInput type="date" value={task.startDate} onCommit={(v) => void commitCell(task, "start", v)} onCancel={() => setEditing(null)} />
                        ) : (
                          <span className="tabular-nums text-slate-600">{fmtDate(task.startDate)}</span>
                        )}
                      </SheetCell>
                      <SheetCell onEdit={() => startEdit(task, "end")}>
                        {cell === "end" ? (
                          <CellInput type="date" value={task.endDate} onCommit={(v) => void commitCell(task, "end", v)} onCancel={() => setEditing(null)} />
                        ) : (
                          <span className="tabular-nums text-slate-600">{fmtDate(task.endDate)}</span>
                        )}
                      </SheetCell>
                      <SheetCell onEdit={() => startEdit(task, "predecessors")}>
                        {cell === "predecessors" ? (
                          <CellInput value={predLabel} onCommit={(v) => void commitCell(task, "predecessors", v)} onCancel={() => setEditing(null)} />
                        ) : (
                          <span className={`font-mono text-[11px] ${predLabel ? "text-slate-700" : "text-slate-300"}`}>{predLabel || "—"}</span>
                        )}
                      </SheetCell>
                      <SheetCell align="right" onEdit={() => startEdit(task, "progress")}>
                        {cell === "progress" ? (
                          <CellInput type="number" value={String(Math.round(task.progress))} onCommit={(v) => void commitCell(task, "progress", v)} onCancel={() => setEditing(null)} />
                        ) : (
                          <span className="font-semibold tabular-nums text-slate-700">{task.progress.toFixed(0)}%</span>
                        )}
                      </SheetCell>
                      <SheetCell onEdit={() => startEdit(task, "status")}>
                        {cell === "status" ? (
                          <select
                            autoFocus
                            className="h-7 w-full rounded border border-blue-400 bg-white px-1 text-[11px] outline-none ring-2 ring-blue-100"
                            defaultValue={task.status}
                            onClick={(e) => e.stopPropagation()}
                            onBlur={(e) => void commitCell(task, "status", e.target.value)}
                            onChange={(e) => void commitCell(task, "status", e.target.value)}
                            onKeyDown={(e) => e.key === "Escape" && setEditing(null)}
                          >
                            {Object.entries(STATUS_LABELS).map(([value, label]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                        ) : (
                          <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_PILL[task.status]}`}>
                            {STATUS_LABELS[task.status]}
                          </span>
                        )}
                      </SheetCell>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Divider */}
        <button
          type="button"
          aria-label="Redimensionar painéis"
          onMouseDown={startResize}
          className="group relative z-[2] w-1.5 shrink-0 cursor-col-resize bg-slate-100 hover:bg-brand-200"
        >
          <span className="absolute inset-y-0 -left-1 -right-1" />
        </button>

        {/* Gantt pane */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative shrink-0 overflow-hidden border-b border-slate-200 bg-slate-50" style={{ height: HEAD_H }}>
            <div className="relative h-full" style={{ width: timeline.width, minWidth: "100%" }}>
              {timeline.markers.map((m) => (
                <span
                  key={m.label}
                  className="absolute inset-y-0 border-l border-slate-200 px-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500"
                  style={{ left: `${m.left}%`, lineHeight: `${HEAD_H}px` }}
                >
                  {m.label}
                </span>
              ))}
            </div>
          </div>
          <div ref={ganttScrollRef} onScroll={onGanttScroll} className="min-h-0 flex-1 overflow-auto">
            <div style={{ width: Math.max(timeline.width, 480), minWidth: "100%" }}>
              {visibleTasks.map((task) => {
                const selected = selectedId === task.id;
                const left = (workingDayOffset(scheduleStart, task.startDate) / Math.max(1, timeline.totalWorkingDays - 1)) * 100;
                const width = Math.max(1.2, (task.durationDays / timeline.totalWorkingDays) * 100);
                const baselineLeft = task.baselineStartDate
                  ? (workingDayOffset(scheduleStart, task.baselineStartDate) / Math.max(1, timeline.totalWorkingDays - 1)) * 100
                  : left;
                const baselineWidth =
                  task.baselineStartDate && task.baselineEndDate
                    ? (workingDaysInclusive(task.baselineStartDate, task.baselineEndDate) / timeline.totalWorkingDays) * 100
                    : width;

                return (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => onSelect(task.id)}
                    className={`relative block w-full border-b border-slate-100 text-left transition ${
                      selected ? "bg-brand-50/70" : task.isSummary ? "bg-slate-50/50" : "bg-white hover:bg-slate-50/60"
                    }`}
                    style={{ height: ROW_H }}
                    aria-label={`Seleccionar ${task.name}`}
                  >
                    {timeline.weekendBands.map((band, i) => (
                      <i key={i} className="pointer-events-none absolute inset-y-0 bg-slate-100/70" style={{ left: `${band.left}%`, width: `${band.width}%` }} />
                    ))}
                    {timeline.markers.map((m) => (
                      <i key={m.label} className="pointer-events-none absolute inset-y-0 border-l border-dashed border-slate-100" style={{ left: `${m.left}%` }} />
                    ))}
                    {timeline.todayLeft != null && (
                      <i className="pointer-events-none absolute inset-y-0 z-[1] border-l-2 border-red-400" style={{ left: `${timeline.todayLeft}%` }} />
                    )}
                    {/* baseline */}
                    <span
                      className="absolute h-1 rounded-sm bg-slate-300"
                      style={{ left: `${baselineLeft}%`, width: `${baselineWidth}%`, top: task.isSummary ? 12 : 10 }}
                    />
                    {task.isSummary ? (
                      <span
                        className="absolute h-2.5 bg-slate-500"
                        style={{ left: `${left}%`, width: `${width}%`, top: 16 }}
                      >
                        <i className="block h-full bg-slate-800" style={{ width: `${Math.min(100, task.progress)}%` }} />
                        <b className="absolute -left-0.5 -top-1 h-3.5 w-1 bg-slate-800" />
                        <b className="absolute -right-0.5 -top-1 h-3.5 w-1 bg-slate-800" />
                      </span>
                    ) : (
                      <span
                        className={`absolute h-3.5 overflow-hidden rounded-md ${BAR_FILL[task.status]} bg-opacity-30 ring-1 ring-black/5`}
                        style={{ left: `${left}%`, width: `${width}%`, top: 11 }}
                      >
                        <i className={`block h-full ${BAR_FILL[task.status]}`} style={{ width: `${Math.min(100, task.progress)}%` }} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50 px-3 py-1.5 text-[10px] text-slate-500">
        <span>
          Arraste a barra central para redimensionar · Predecessores: <code className="rounded bg-white px-1 font-mono text-slate-700 ring-1 ring-slate-200">1.2FS+2</code>
        </span>
        <span className="font-medium text-slate-600">{visibleTasks.length} linhas · dias úteis seg–sáb</span>
      </div>
    </section>
  );
}

import { useMemo, useState } from "react";
import type { ScheduleTask, ScheduleTaskStatus } from "../api/schedule";
import { formatPredecessorLabel } from "../utils/scheduleValidation";
import { useScheduleSheet } from "../hooks/useScheduleSheet";
import { CellInput, SheetCell, STATUS_LABELS, STATUS_PILL, fmtDate } from "./ScheduleSheetCells";
import ModalPortal from "./ModalPortal";
import { IconClose } from "./icons";

type Props = {
  tasks: ScheduleTask[];
  byId: Map<string, ScheduleTask>;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onError: (message: string | null) => void;
};

// Popup de ecrã inteiro com TODAS as actividades do cronograma numa única folha — sem o Gantt a
// ocupar metade do espaço, e a funcionar em qualquer tamanho de ecrã (o painel embutido só
// aparece a partir do tablet). Mesma edição célula-a-célula e em massa da folha embutida.
export default function ScheduleSheetModal({ tasks, byId, onClose, onChanged, onError }: Props) {
  const [query, setQuery] = useState("");
  const [bulkShiftDays, setBulkShiftDays] = useState("1");
  const [bulkDurationInput, setBulkDurationInput] = useState("1");
  const [bulkStatusInput, setBulkStatusInput] = useState<ScheduleTaskStatus>("em_curso");

  const {
    editing,
    savingId,
    selected,
    bulkBusy,
    setEditing,
    toggleSelected,
    toggleSelectAllVisible,
    startEdit,
    commitCell,
    bulkShift,
    bulkDuration,
    bulkStatus,
    bulkDelete,
  } = useScheduleSheet(tasks, onChanged, onError);

  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("pt");
    const sorted = [...tasks].sort((a, b) => a.sortOrder - b.sortOrder);
    if (!needle) return sorted;
    return sorted.filter((t) =>
      `${t.code} ${t.name} ${STATUS_LABELS[t.status]}`.toLocaleLowerCase("pt").includes(needle),
    );
  }, [tasks, query]);

  const selectableRows = useMemo(() => rows.filter((t) => !t.isSummary), [rows]);
  const allSelected = selectableRows.length > 0 && selectableRows.every((t) => selected.has(t.id));

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex flex-col bg-white">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900">Cronograma — folha completa</h2>
            <p className="text-xs text-slate-500">{tasks.length} actividade(s) · duplo clique numa célula para editar</p>
          </div>
          <div className="flex flex-1 items-center justify-end gap-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Pesquisar WBS, nome, estado…"
              className="input input-sm w-56 max-w-full"
            />
            <button type="button" onClick={onClose} className="icon-btn-ghost" aria-label="Fechar">
              <IconClose className="h-4 w-4" />
            </button>
          </div>
        </div>

        {selected.size > 0 && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-blue-200 bg-blue-50 px-4 py-2">
            <span className="text-[11px] font-semibold text-blue-900">{selected.size} seleccionada(s)</span>
            <span className="mx-1 hidden h-4 w-px bg-blue-200 sm:block" />
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={bulkShiftDays}
                onChange={(e) => setBulkShiftDays(e.target.value)}
                className="h-7 w-14 rounded border border-slate-200 bg-white px-1.5 text-[11px]"
                title="Dias úteis (negativo adianta)"
              />
              <button type="button" disabled={bulkBusy} onClick={() => void bulkShift(Number(bulkShiftDays))} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:border-slate-300 disabled:opacity-50">
                Adiar/adiantar dias
              </button>
            </div>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min="1"
                value={bulkDurationInput}
                onChange={(e) => setBulkDurationInput(e.target.value)}
                className="h-7 w-14 rounded border border-slate-200 bg-white px-1.5 text-[11px]"
                title="Duração em dias úteis"
              />
              <button type="button" disabled={bulkBusy} onClick={() => void bulkDuration(Number(bulkDurationInput))} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:border-slate-300 disabled:opacity-50">
                Definir duração
              </button>
            </div>
            <div className="flex items-center gap-1">
              <select
                value={bulkStatusInput}
                onChange={(e) => setBulkStatusInput(e.target.value as ScheduleTaskStatus)}
                className="h-7 rounded border border-slate-200 bg-white px-1.5 text-[11px]"
              >
                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <button type="button" disabled={bulkBusy} onClick={() => void bulkStatus(bulkStatusInput)} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:border-slate-300 disabled:opacity-50">
                Aplicar estado
              </button>
            </div>
            <button type="button" disabled={bulkBusy} onClick={() => void bulkDelete()} className="rounded-md border border-red-200 bg-white px-2 py-1 text-[11px] font-semibold text-red-700 hover:border-red-300 disabled:opacity-50">
              Eliminar seleccionadas
            </button>
            <p className="w-full text-[10px] text-blue-800/80 sm:ml-auto sm:w-auto">
              "Adiar/adiantar" só se aplica a actividades sem predecessora.
            </p>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[900px] table-fixed border-collapse text-[13px]">
            <colgroup>
              <col className="w-9" />
              <col className="w-12" />
              <col className="w-16" />
              <col />
              <col className="w-20" />
              <col className="w-24" />
              <col className="w-24" />
              <col className="w-28" />
              <col className="w-16" />
              <col className="w-32" />
            </colgroup>
            <thead className="sticky top-0 z-[1] bg-slate-100">
              <tr className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <th className="border-b border-slate-200 px-2 py-2 text-center">
                  <input type="checkbox" checked={allSelected} onChange={() => toggleSelectAllVisible(rows)} className="h-3.5 w-3.5 rounded border-slate-300" aria-label="Seleccionar todas" />
                </th>
                <th className="border-b border-slate-200 px-2 py-2 text-right">#</th>
                <th className="border-b border-slate-200 px-2 py-2 text-left">WBS</th>
                <th className="border-b border-slate-200 px-2 py-2 text-left">Nome</th>
                <th className="border-b border-slate-200 px-2 py-2 text-right">Duração</th>
                <th className="border-b border-slate-200 px-2 py-2 text-left">Início</th>
                <th className="border-b border-slate-200 px-2 py-2 text-left">Fim</th>
                <th className="border-b border-slate-200 px-2 py-2 text-left">Predecessora</th>
                <th className="border-b border-slate-200 px-2 py-2 text-right">%</th>
                <th className="border-b border-slate-200 px-2 py-2 text-left">Estado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((task, index) => {
                const cell = editing?.id === task.id ? editing.cell : null;
                const predLabel = formatPredecessorLabel(task, byId);
                return (
                  <tr key={task.id} className={`${savingId === task.id ? "opacity-50" : ""} ${task.isSummary ? "bg-slate-50" : "bg-white hover:bg-slate-50/80"}`}>
                    <SheetCell align="right" className="w-9" rowH={40}>
                      {!task.isSummary && (
                        <input type="checkbox" checked={selected.has(task.id)} onChange={() => toggleSelected(task.id)} className="h-3.5 w-3.5 rounded border-slate-300" />
                      )}
                    </SheetCell>
                    <SheetCell align="right" className="text-[11px] tabular-nums text-slate-400" rowH={40}>{index + 1}</SheetCell>
                    <SheetCell onEdit={() => startEdit(task, "code")} rowH={40}>
                      {cell === "code" ? (
                        <CellInput value={task.code} onCommit={(v) => void commitCell(task, "code", v)} onCancel={() => setEditing(null)} />
                      ) : (
                        <span className={`font-mono text-[11px] font-semibold ${task.isSummary ? "text-slate-700" : "text-brand-700"}`}>{task.code}</span>
                      )}
                    </SheetCell>
                    <SheetCell onEdit={() => startEdit(task, "name")} className="!whitespace-normal" rowH={40}>
                      {cell === "name" ? (
                        <div style={{ paddingLeft: (task.wbsDepth ?? (task.parentId ? 1 : 0)) * 16 }}>
                          <CellInput value={task.name} onCommit={(v) => void commitCell(task, "name", v)} onCancel={() => setEditing(null)} />
                        </div>
                      ) : (
                        <span className={task.isSummary ? "font-semibold text-slate-900" : "text-slate-700"} style={{ paddingLeft: (task.wbsDepth ?? (task.parentId ? 1 : 0)) * 16 }}>
                          {task.name}
                        </span>
                      )}
                    </SheetCell>
                    <SheetCell align="right" onEdit={() => startEdit(task, "duration")} rowH={40}>
                      {cell === "duration" ? (
                        <CellInput type="number" step="1" value={String(task.durationDays)} onCommit={(v) => void commitCell(task, "duration", v)} onCancel={() => setEditing(null)} />
                      ) : (
                        <span className="tabular-nums text-slate-600">{task.durationDays}d</span>
                      )}
                    </SheetCell>
                    <SheetCell onEdit={() => startEdit(task, "start")} rowH={40}>
                      {cell === "start" ? (
                        <CellInput type="date" value={task.startDate} onCommit={(v) => void commitCell(task, "start", v)} onCancel={() => setEditing(null)} />
                      ) : (
                        <span className="tabular-nums text-slate-600">{fmtDate(task.startDate)}</span>
                      )}
                    </SheetCell>
                    <SheetCell onEdit={() => startEdit(task, "end")} rowH={40}>
                      {cell === "end" ? (
                        <CellInput type="date" value={task.endDate} onCommit={(v) => void commitCell(task, "end", v)} onCancel={() => setEditing(null)} />
                      ) : (
                        <span className="tabular-nums text-slate-600">{fmtDate(task.endDate)}</span>
                      )}
                    </SheetCell>
                    <SheetCell onEdit={() => startEdit(task, "predecessors")} rowH={40}>
                      {cell === "predecessors" ? (
                        <CellInput value={predLabel} onCommit={(v) => void commitCell(task, "predecessors", v)} onCancel={() => setEditing(null)} />
                      ) : (
                        <span className={`font-mono text-[11px] ${predLabel ? "text-slate-700" : "text-slate-300"}`}>{predLabel || "—"}</span>
                      )}
                    </SheetCell>
                    <SheetCell align="right" onEdit={() => startEdit(task, "progress")} rowH={40}>
                      {cell === "progress" ? (
                        <CellInput type="number" step="0.01" value={task.progress.toFixed(2)} onCommit={(v) => void commitCell(task, "progress", v)} onCancel={() => setEditing(null)} />
                      ) : (
                        <span className="font-semibold tabular-nums text-slate-700">{task.progress.toFixed(2)}%</span>
                      )}
                    </SheetCell>
                    <SheetCell onEdit={() => startEdit(task, "status")} rowH={40}>
                      {cell === "status" ? (
                        <select
                          autoFocus
                          className="h-7 w-full rounded border border-blue-400 bg-white px-1 text-[11px] outline-none ring-2 ring-blue-100"
                          defaultValue={task.status}
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
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-sm text-slate-400">
                    {query ? "Nenhuma actividade corresponde à pesquisa." : "Ainda não há actividades no cronograma."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2 text-[11px] text-slate-500">
          <span>Predecessores: <code className="rounded bg-white px-1 font-mono text-slate-700 ring-1 ring-slate-200">1.2FS+2</code></span>
          <span className="font-medium text-slate-600">{rows.length} de {tasks.length} actividade(s)</span>
        </div>
      </div>
    </ModalPortal>
  );
}

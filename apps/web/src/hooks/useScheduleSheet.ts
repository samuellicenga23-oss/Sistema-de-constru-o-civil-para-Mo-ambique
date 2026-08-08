import { useState } from "react";
import type { ScheduleTask, ScheduleTaskInput, ScheduleTaskStatus } from "../api/schedule";
import { scheduleApi } from "../api/schedule";
import { shiftWorkingDays } from "@sigo/shared";
import { parsePredecessorInput } from "../utils/scheduleValidation";

export type EditCell = "name" | "duration" | "start" | "end" | "predecessors" | "progress" | "status" | "code";

// Toda a lógica de edição célula-a-célula e de edição em massa do cronograma, partilhada entre
// a folha embutida (ScheduleWorkspace) e o popup de ecrã inteiro (ScheduleSheetModal) — para as
// duas superfícies nunca se comportarem de forma diferente perante o mesmo clique.
export function useScheduleSheet(tasks: ScheduleTask[], onChanged: () => Promise<void>, onError: (message: string | null) => void) {
  const [editing, setEditing] = useState<{ id: string; cell: EditCell } | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllVisible(visible: ScheduleTask[]) {
    const selectable = visible.filter((t) => !t.isSummary);
    const allSelected = selectable.length > 0 && selectable.every((t) => selected.has(t.id));
    setSelected(allSelected ? new Set() : new Set(selectable.map((t) => t.id)));
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
        if (!Number.isFinite(days) || days < (task.isMilestone ? 0 : 1)) {
          throw new Error(task.isMilestone ? "O marco deve ter duração igual ou superior a 0" : "Duração deve ser ≥ 1 dia útil");
        }
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

  function startEdit(task: ScheduleTask, cell: EditCell, onSelect?: (id: string) => void) {
    onSelect?.(task.id);
    if (task.isSummary && !["name", "code"].includes(cell)) return;
    setEditing({ id: task.id, cell });
  }

  async function applyBulk(patchFor: (task: ScheduleTask) => ScheduleTaskInput | null) {
    const targets = tasks.filter((t) => selected.has(t.id));
    if (!targets.length) return;
    setBulkBusy(true);
    onError(null);
    try {
      const results = await Promise.allSettled(
        targets.map((t) => {
          const patch = patchFor(t);
          return patch ? scheduleApi.updateTask(t.id, patch) : Promise.resolve(null);
        }),
      );
      const failed = results.filter((r) => r.status === "rejected");
      if (failed.length) {
        onError(`${failed.length} de ${targets.length} actividade(s) não foram actualizadas — verifique conflitos e tente novamente.`);
      }
      await onChanged();
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkShift(days: number) {
    if (!Number.isFinite(days) || days === 0) return;
    // Só se aplica a quem não tem predecessora — quem tem, recalcula sozinho quando a
    // predecessora se mexer (é exactamente para isso que a cascata de dependências serve).
    await applyBulk((task) => (task.predecessorTaskId ? null : { startDate: shiftWorkingDays(task.startDate, days), durationDays: task.durationDays }));
  }

  async function bulkDuration(days: number) {
    if (!Number.isFinite(days) || days < 1) return;
    await applyBulk((task) => ({ startDate: task.startDate, durationDays: Math.round(days) }));
  }

  async function bulkStatus(status: ScheduleTaskStatus) {
    await applyBulk(() => ({ status }));
  }

  async function bulkDelete() {
    const targets = tasks.filter((t) => selected.has(t.id));
    if (!targets.length) return;
    if (!window.confirm(`Eliminar ${targets.length} actividade(s) seleccionada(s)? Esta acção não pode ser desfeita.`)) return;
    setBulkBusy(true);
    onError(null);
    try {
      const results = await Promise.allSettled(targets.map((t) => scheduleApi.deleteTask(t.id)));
      const failed = results.filter((r) => r.status === "rejected");
      if (failed.length) onError(`${failed.length} de ${targets.length} actividade(s) não foram eliminadas.`);
      setSelected(new Set());
      await onChanged();
    } finally {
      setBulkBusy(false);
    }
  }

  return {
    editing,
    savingId,
    selected,
    bulkBusy,
    setEditing,
    setSelected,
    toggleSelected,
    toggleSelectAllVisible,
    startEdit,
    commitCell,
    bulkShift,
    bulkDuration,
    bulkStatus,
    bulkDelete,
  };
}

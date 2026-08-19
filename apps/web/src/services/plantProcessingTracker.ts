import type { PlantProcessingProgress } from "../api/plants";

export type PlantProcessingTask = {
  plantId: string;
  projectId: string;
  fileName: string;
  state: "uploading" | "processing" | "completed" | "error";
  progress: PlantProcessingProgress;
  completedAt?: string;
  expiresAt?: string;
};

export const COMPLETED_NOTICE_TTL_MS = 10_000;
const STORAGE_KEY = "sigo:plant-processing-tasks";
const listeners = new Set<() => void>();
let nowMs = () => Date.now();

function loadRaw(): unknown[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function isTask(value: unknown): value is PlantProcessingTask {
  if (!value || typeof value !== "object") return false;
  const row = value as PlantProcessingTask;
  return Boolean(row.plantId && row.projectId && row.state && row.progress);
}

function normalizeTask(value: unknown): PlantProcessingTask | null {
  if (!isTask(value)) return null;
  if (value.state !== "completed") {
    const { completedAt: _c, expiresAt: _e, ...rest } = value;
    return rest;
  }
  if (!value.completedAt || !value.expiresAt) return null;
  if (nowMs() >= Date.parse(value.expiresAt)) return null;
  return value;
}

function prune(tasks: PlantProcessingTask[]) {
  return tasks.filter((task) => task.state !== "completed" || (task.expiresAt != null && nowMs() < Date.parse(task.expiresAt)));
}

function loadTasks(): PlantProcessingTask[] {
  return prune(loadRaw().map(normalizeTask).filter((task): task is PlantProcessingTask => Boolean(task)));
}

let snapshot = loadTasks();

function publish(next: PlantProcessingTask[]) {
  snapshot = prune(next).slice(-4);
  if (typeof window !== "undefined") window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  for (const listener of listeners) listener();
}

export function getPlantProcessingTasks() {
  return snapshot;
}

export function subscribePlantProcessingTasks(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function beginPlantProcessingTask(task: Omit<PlantProcessingTask, "state" | "progress" | "completedAt" | "expiresAt">, progress: PlantProcessingProgress) {
  publish([...snapshot.filter((item) => item.plantId !== task.plantId), { ...task, state: "uploading", progress }]);
}

export function updatePlantProcessingTask(plantId: string, progress: PlantProcessingProgress) {
  const nextState: PlantProcessingTask["state"] =
    progress.processingStatus === "concluido" ? "completed"
      : progress.processingStatus === "erro" ? "error"
        : progress.processingProgress < 12 ? "uploading"
          : "processing";
  publish(snapshot.map((task) => {
    if (task.plantId !== plantId) return task;
    if (nextState === "completed") {
      const completedAt = task.completedAt ?? new Date(nowMs()).toISOString();
      return {
        ...task,
        state: "completed",
        progress,
        completedAt,
        expiresAt: task.expiresAt ?? new Date(nowMs() + COMPLETED_NOTICE_TTL_MS).toISOString(),
      };
    }
    const { completedAt: _c, expiresAt: _e, ...rest } = task;
    return { ...rest, state: nextState, progress };
  }));
}

export function failPlantProcessingTask(plantId: string, message: string) {
  publish(snapshot.map((task) => task.plantId === plantId ? {
    ...task,
    state: "error" as const,
    progress: { ...task.progress, processingStatus: "erro", processingStage: "Envio interrompido", errorMessage: message },
  } : task));
}

export function dismissPlantProcessingTask(plantId: string) {
  publish(snapshot.filter((task) => task.plantId !== plantId));
}

export function pruneExpiredPlantProcessingTasks() {
  publish(snapshot);
}

export function setPlantProcessingNowForTests(now: () => number) {
  nowMs = now;
}

export function resetPlantProcessingTasksForTests() {
  nowMs = () => Date.now();
  if (typeof window !== "undefined") window.sessionStorage.removeItem(STORAGE_KEY);
  snapshot = [];
  for (const listener of listeners) listener();
}

export function hydratePlantProcessingTasksForTests() {
  snapshot = loadTasks();
  for (const listener of listeners) listener();
}

import type { PlantProcessingProgress } from "../api/plants";

export type PlantProcessingTask = {
  plantId: string;
  projectId: string;
  fileName: string;
  state: "uploading" | "processing" | "completed" | "error";
  progress: PlantProcessingProgress;
};

const STORAGE_KEY = "sigo:plant-processing-tasks";
const listeners = new Set<() => void>();

function loadTasks(): PlantProcessingTask[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

let snapshot = loadTasks();

function publish(next: PlantProcessingTask[]) {
  snapshot = next.slice(-4);
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

export function beginPlantProcessingTask(task: Omit<PlantProcessingTask, "state" | "progress">, progress: PlantProcessingProgress) {
  publish([...snapshot.filter((item) => item.plantId !== task.plantId), { ...task, state: "uploading", progress }]);
}

export function updatePlantProcessingTask(plantId: string, progress: PlantProcessingProgress) {
  publish(snapshot.map((task) => task.plantId === plantId ? {
    ...task,
    state: progress.processingStatus === "concluido" ? "completed" : progress.processingStatus === "erro" ? "error" : progress.processingProgress < 12 ? "uploading" : "processing",
    progress,
  } : task));
}

export function failPlantProcessingTask(plantId: string, message: string) {
  publish(snapshot.map((task) => task.plantId === plantId ? {
    ...task,
    state: "error",
    progress: { ...task.progress, processingStatus: "erro", processingStage: "Envio interrompido", errorMessage: message },
  } : task));
}

export function dismissPlantProcessingTask(plantId: string) {
  publish(snapshot.filter((task) => task.plantId !== plantId));
}

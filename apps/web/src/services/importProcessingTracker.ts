import type { MeasurementImportJob, MeasurementImportPreview } from "../api/boq";

export type ImportProcessingTask = {
  jobId: string;
  documentId: string;
  projectId?: string | null;
  fileName: string;
  state: "uploading" | "processing" | "completed" | "error";
  progress: number;
  stage: string;
  errorMessage: string | null;
  preview: MeasurementImportPreview | null;
  /** Quando true, a UI deve abrir o modal de revisão. */
  openReview: boolean;
};

const STORAGE_KEY = "sigo:import-processing-tasks";
const listeners = new Set<() => void>();

function loadTasks(): ImportProcessingTask[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

let snapshot = loadTasks();

function publish(next: ImportProcessingTask[]) {
  snapshot = next.slice(-4);
  if (typeof window !== "undefined") window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  for (const listener of listeners) listener();
}

export function getImportProcessingTasks() {
  return snapshot;
}

export function subscribeImportProcessingTasks(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function beginImportProcessingTask(task: {
  jobId: string;
  documentId: string;
  projectId?: string | null;
  fileName: string;
}) {
  publish([
    ...snapshot.filter((item) => item.jobId !== task.jobId),
    {
      ...task,
      state: "uploading",
      progress: 2,
      stage: "Ficheiro recebido",
      errorMessage: null,
      preview: null,
      openReview: false,
    },
  ]);
}

export function updateImportProcessingTask(job: MeasurementImportJob) {
  publish(
    snapshot.map((task) =>
      task.jobId === job.id
        ? {
            ...task,
            state:
              job.status === "concluido"
                ? "completed"
                : job.status === "erro"
                  ? "error"
                  : job.progress < 10
                    ? "uploading"
                    : "processing",
            progress: job.progress,
            stage: job.stage,
            errorMessage: job.errorMessage,
            preview: job.preview ?? task.preview,
            openReview: job.status === "concluido" ? true : task.openReview,
          }
        : task,
    ),
  );
}

export function failImportProcessingTask(jobId: string, message: string) {
  publish(
    snapshot.map((task) =>
      task.jobId === jobId
        ? {
            ...task,
            state: "error",
            stage: "Envio interrompido",
            errorMessage: message,
            openReview: false,
          }
        : task,
    ),
  );
}

export function consumeImportReview(jobId: string) {
  publish(snapshot.map((task) => (task.jobId === jobId ? { ...task, openReview: false } : task)));
}

export function dismissImportProcessingTask(jobId: string) {
  publish(snapshot.filter((task) => task.jobId !== jobId));
}

export function getImportTask(jobId: string) {
  return snapshot.find((task) => task.jobId === jobId) ?? null;
}

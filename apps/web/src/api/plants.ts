import { request, ApiError } from "./http";

export type StructuralSummary = {
  footingsCount: number;
  footingsAvgWidthCm: number;
  footingsAvgLengthCm: number;
  footingsAvgDepthCm: number;
  columnsCount: number;
  beamsCount: number;
  beamsTotalLengthM: number;
  beamsAvgWidthCm: number;
  beamsAvgHeightCm: number;
  beamsConcreteVolumeM3: number;
  staircasesCount: number;
  slabsCount: number;
  slabsAvgThicknessCm: number;
  totalSteelWeightKg: number;
};

export type DocumentDiscipline = "arquitectura" | "estrutura" | "hidrossanitario" | "electricidade" | "outro";
export type DocumentSection = {
  discipline: DocumentDiscipline;
  label: string;
  startPage: number;
  endPage: number;
  pageCount: number;
  confidence: number;
  evidence: string[];
};
export type DocumentAnalysis = {
  pageCount: number;
  isMultiDiscipline: boolean;
  matchedTags: string[];
  sections: DocumentSection[];
};
export type PlantUploadDiscipline = "auto" | "arquitectura" | "estrutura";

export type Plant = {
  id: string;
  projectId: string;
  discipline: "arquitectura" | "estrutura";
  originalFileName: string | null;
  processingStatus: "pendente" | "processando" | "concluido" | "erro";
  processingProgress: number;
  processingStage: string | null;
  processingCurrentPage: number | null;
  processingTotalPages: number | null;
  processingStartedAt: string | null;
  processingUpdatedAt: string;
  errorMessage: string | null;
  structuralSummary: StructuralSummary | null;
  documentAnalysis: DocumentAnalysis | null;
  uploadedAt: string;
};

export type PlantProcessingProgress = Pick<
  Plant,
  "id" | "processingStatus" | "processingProgress" | "processingStage" | "processingCurrentPage" | "processingTotalPages" | "processingStartedAt" | "processingUpdatedAt" | "errorMessage"
>;

const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

// Devolve o último estado conhecido quando o polling termina (sucesso, erro, ou parado
// externamente) — quem chama pode assim esperar pelo fim real da leitura em segundo plano em
// vez de assumir que a resposta do POST já é o resultado final.
async function watchProgress(id: string, onProgress: ((progress: PlantProcessingProgress) => void) | undefined, isStopped: () => boolean): Promise<PlantProcessingProgress | null> {
  let last: PlantProcessingProgress | null = null;
  while (!isStopped()) {
    await wait(450);
    if (isStopped()) break;
    try {
      const progress = await request<PlantProcessingProgress>(`/plants/${id}/status`);
      last = progress;
      onProgress?.(progress);
      if (progress.processingStatus === "concluido" || progress.processingStatus === "erro") break;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) continue;
      break;
    }
  }
  return last;
}

export type ExtractedRoom = {
  id: string;
  name: string;
  number: string | null;
  areaM2: string;
  page: number;
  floor: string | null;
};

export type ExtractedRebarLine = {
  id: string;
  element: string;
  diameterMm: string;
  weightKg: string;
  page: number;
};

export const plantsApi = {
  list: (projectId: string) => request<Plant[]>(`/projects/${projectId}/plants`),

  upload: async (
    projectId: string,
    file: File,
    discipline: PlantUploadDiscipline = "auto",
    onProgress?: (progress: PlantProcessingProgress) => void,
    options?: { waitForCompletion?: boolean },
  ) => {
    const waitForCompletion = options?.waitForCompletion ?? false;
    const plantId = crypto.randomUUID();
    const form = new FormData();
    form.append("clientPlantId", plantId);
    form.append("discipline", discipline);
    form.append("file", file);
    onProgress?.({ id: plantId, processingStatus: "pendente", processingProgress: 3, processingStage: "A enviar o ficheiro", processingCurrentPage: null, processingTotalPages: null, processingStartedAt: new Date().toISOString(), processingUpdatedAt: new Date().toISOString(), errorMessage: null });
    let stopped = false;
    const watcher = waitForCompletion ? watchProgress(plantId, onProgress, () => stopped) : null;
    try {
      const res = await fetch(`/api/projects/${projectId}/plants`, { method: "POST", credentials: "include", body: form });
      if (!res.ok) {
        stopped = true;
        const body = await res.json().catch(() => ({}));
        throw new ApiError(res.status, body.error ?? `Erro ${res.status}`);
      }
      const plant = await res.json() as Plant;
      onProgress?.(plant);
      if (!waitForCompletion) return plant;
      const finalProgress = await watcher;
      return finalProgress ? { ...plant, ...finalProgress } : plant;
    } finally {
      stopped = true;
      if (watcher) await watcher;
    }
  },

  detail: (id: string) => request<{ plant: Plant; rooms: ExtractedRoom[]; rebarSchedules: ExtractedRebarLine[] }>(`/plants/${id}`),

  reprocess: async (id: string, onProgress?: (progress: PlantProcessingProgress) => void, options?: { waitForCompletion?: boolean }) => {
    const waitForCompletion = options?.waitForCompletion ?? true;
    let stopped = false;
    const watcher = waitForCompletion ? watchProgress(id, onProgress, () => stopped) : null;
    try {
      const plant = await request<Plant>(`/plants/${id}/reprocess`, { method: "POST" });
      onProgress?.(plant);
      if (!waitForCompletion) return plant;
      const finalProgress = await watcher;
      return finalProgress ? { ...plant, ...finalProgress } : plant;
    } finally {
      stopped = true;
      if (watcher) await watcher;
    }
  },

  status: (id: string) => request<PlantProcessingProgress>(`/plants/${id}/status`),

  updateRoomFloor: (plantId: string, roomId: string, floor: string | null) =>
    request<ExtractedRoom>(`/plants/${plantId}/rooms/${roomId}`, { method: "PATCH", body: JSON.stringify({ floor }) }),

  delete: (id: string) => request<{ ok: true }>(`/plants/${id}`, { method: "DELETE" }),
};

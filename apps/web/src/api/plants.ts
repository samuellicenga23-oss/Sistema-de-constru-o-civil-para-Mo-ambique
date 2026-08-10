import { request, ApiError } from "./http";
import { beginPlantProcessingTask, failPlantProcessingTask, updatePlantProcessingTask } from "../services/plantProcessingTracker";

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
  slabs?: StructuralSlab[];
  totalSteelWeightKg: number;
};

export type SlabRebarLayer = {
  xDiameterMm: number;
  xSpacingCm: number;
  yDiameterMm: number;
  ySpacingCm: number;
};

export type StructuralSlab = {
    name?: string;
    floor: string | null;
    areaM2?: number;
    thicknessCm: number;
    layers: Array<"inferior" | "superior" | "geral">;
    pages: number[];
    concreteClass?: string | null;
    steelGrade?: string | null;
    coverCm?: number | null;
    topRebar?: SlabRebarLayer | null;
    bottomRebar?: SlabRebarLayer | null;
    topSteelWeightKg?: number;
    bottomSteelWeightKg?: number;
    steelByDiameter?: Record<string, number>;
    notes?: string | null;
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
  identity: {
    owner: string | null;
    location: string | null;
    projectTitle: string | null;
    pages: number[];
  } | null;
};
export type DocumentIdentityConflict = {
  field: "owner" | "location" | "project_title";
  severity: "warning" | "critical";
  values: Array<{ value: string; disciplines: DocumentDiscipline[]; pages: number[] }>;
};
export type DocumentAnalysis = {
  pageCount: number;
  isMultiDiscipline: boolean;
  matchedTags: string[];
  sections: DocumentSection[];
  identityConflicts: DocumentIdentityConflict[];
  requiresIdentityConfirmation: boolean;
  identityConfirmed: boolean;
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

export type PlantReviewRequest = {
  id: string;
  plantId: string;
  projectId: string;
  companyId: string;
  reason: "erro_processamento" | "extraccao_incompleta" | "pedido_utilizador";
  status: "aberto" | "em_analise" | "resolvido";
  gaps: string[];
  progressAtFailure: number | null;
  errorMessage: string | null;
  userNotes: string | null;
  adminNotes: string | null;
  slaHours: number;
  createdAt: string;
  resolvedAt: string | null;
  plantFileName?: string | null;
  plantStatus?: Plant["processingStatus"];
  plantProgress?: number;
  projectName?: string;
  companyName?: string;
  requesterName?: string | null;
  requesterEmail?: string | null;
  pdfUrl?: string;
};

export type ManualRoomInput = {
  id?: string;
  name: string;
  number?: string | null;
  floor?: string | null;
  areaM2: number;
  perimeterM?: number | null;
  page?: number;
};

export type PlantProcessingProgress = Pick<
  Plant,
  "id" | "processingStatus" | "processingProgress" | "processingStage" | "processingCurrentPage" | "processingTotalPages" | "processingStartedAt" | "processingUpdatedAt" | "errorMessage"
>;

const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

function uploadPlantForm(url: string, form: FormData, onTransfer: (percent: number) => void): Promise<Plant> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onTransfer(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onerror = () => reject(new ApiError(0, "Falha de ligação durante o envio do PDF"));
    xhr.onload = () => {
      let body: unknown = null;
      try { body = JSON.parse(xhr.responseText); } catch { body = null; }
      if (xhr.status < 200 || xhr.status >= 300) {
        const message = body && typeof body === "object" && "error" in body ? String(body.error) : `Erro ${xhr.status}`;
        reject(new ApiError(xhr.status, message));
        return;
      }
      resolve(body as Plant);
    };
    xhr.send(form);
  });
}

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
  perimeterM: string | null;
};

export type ExtractedOpening = {
  id: string;
  plantId: string;
  kind: "porta" | "janela";
  code: string | null;
  designation: string | null;
  widthM: string | null;
  heightM: string | null;
  sillHeightM: string | null;
  quantity: number;
  floor: string | null;
  location: "interior" | "exterior" | "desconhecida";
  material: string | null;
  materialId: string | null;
  technicalSpecification: string | null;
  page: number;
  confidence: string;
  source: "quadro" | "geometria" | "manual" | "ia";
  needsConfirmation: boolean;
};

export type OpeningInput = {
  kind: "porta" | "janela";
  code?: string | null;
  designation?: string | null;
  widthM: number | null;
  heightM: number | null;
  sillHeightM?: number | null;
  quantity: number;
  floor?: string | null;
  location: "interior" | "exterior" | "desconhecida";
  material?: string | null;
  materialId?: string | null;
  technicalSpecification?: string | null;
  page?: number;
  confirmed?: boolean;
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
    const startedAt = new Date().toISOString();
    const initial: PlantProcessingProgress = { id: plantId, processingStatus: "pendente", processingProgress: 1, processingStage: "A carregar o PDF · 0%", processingCurrentPage: null, processingTotalPages: null, processingStartedAt: startedAt, processingUpdatedAt: startedAt, errorMessage: null };
    beginPlantProcessingTask({ plantId, projectId, fileName: file.name }, initial);
    onProgress?.(initial);
    try {
      const plant = await uploadPlantForm(`/api/projects/${projectId}/plants`, form, (percent) => {
        const transferProgress: PlantProcessingProgress = { ...initial, processingProgress: Math.max(1, Math.min(10, Math.round(percent / 10))), processingStage: `A carregar o PDF · ${percent}%`, processingUpdatedAt: new Date().toISOString() };
        updatePlantProcessingTask(plantId, transferProgress);
        onProgress?.(transferProgress);
      });
      updatePlantProcessingTask(plantId, plant);
      onProgress?.(plant);
      if (plant.processingStatus === "concluido" || plant.processingStatus === "erro") return plant;
      if (!waitForCompletion) return plant;
      const watcher = watchProgress(plantId, (progress) => {
        updatePlantProcessingTask(plantId, progress);
        onProgress?.(progress);
      }, () => false);
      const finalProgress = await watcher;
      return finalProgress ? { ...plant, ...finalProgress } : plant;
    } catch (error) {
      failPlantProcessingTask(plantId, error instanceof Error ? error.message : "Não foi possível carregar o PDF");
      throw error;
    }
  },

  detail: (id: string) => request<{ plant: Plant; rooms: ExtractedRoom[]; openings: ExtractedOpening[]; rebarSchedules: ExtractedRebarLine[] }>(`/plants/${id}`),

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

  updateSlabs: (plantId: string, slabs: StructuralSlab[]) =>
    request<Plant>(`/plants/${plantId}/slabs`, { method: "PUT", body: JSON.stringify({ slabs }) }),

  confirmIdentity: (plantId: string) =>
    request<Plant>(`/plants/${plantId}/confirm-identity`, { method: "POST", body: JSON.stringify({ confirmed: true }) }),

  createOpening: (plantId: string, input: OpeningInput) =>
    request<ExtractedOpening>(`/plants/${plantId}/openings`, { method: "POST", body: JSON.stringify(input) }),

  updateOpening: (plantId: string, openingId: string, input: OpeningInput) =>
    request<ExtractedOpening>(`/plants/${plantId}/openings/${openingId}`, { method: "PUT", body: JSON.stringify(input) }),

  deleteOpening: (plantId: string, openingId: string) =>
    request<{ ok: true }>(`/plants/${plantId}/openings/${openingId}`, { method: "DELETE" }),

  delete: (id: string) => request<{ ok: true }>(`/plants/${id}`, { method: "DELETE" }),

  getReviewRequest: (id: string) =>
    request<{ review: PlantReviewRequest | null; slaHours: number }>(`/plants/${id}/review-request`),

  requestEngineReview: (id: string, input?: { userNotes?: string; gaps?: string[] }) =>
    request<{ review: PlantReviewRequest; message: string; slaHours: number }>(`/plants/${id}/request-engine-review`, {
      method: "POST",
      body: JSON.stringify(input ?? {}),
    }),

  saveManualData: (id: string, input: {
    structuralSummary: StructuralSummary;
    rooms: ManualRoomInput[];
    userNotes?: string;
    requestEngineReview?: boolean;
  }) =>
    request<{
      plant: Plant;
      rooms: ExtractedRoom[];
      review: PlantReviewRequest | null;
      message: string;
      slaHours: number;
    }>(`/plants/${id}/manual-data`, { method: "PUT", body: JSON.stringify(input) }),

  listAdminReviews: (status: "aberto" | "em_analise" | "resolvido" | "todos" = "aberto") =>
    request<PlantReviewRequest[]>(`/admin/plant-reviews?status=${status}`),

  updateAdminReview: (id: string, input: { status: PlantReviewRequest["status"]; adminNotes?: string }) =>
    request<PlantReviewRequest>(`/admin/plant-reviews/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
};

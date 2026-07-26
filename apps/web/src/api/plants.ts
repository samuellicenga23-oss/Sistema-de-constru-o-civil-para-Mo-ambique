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

export type Plant = {
  id: string;
  projectId: string;
  discipline: "arquitectura" | "estrutura";
  originalFileName: string | null;
  processingStatus: "pendente" | "processando" | "concluido" | "erro";
  errorMessage: string | null;
  structuralSummary: StructuralSummary | null;
  uploadedAt: string;
};

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

  upload: async (projectId: string, file: File, discipline: "arquitectura" | "estrutura") => {
    const form = new FormData();
    form.append("file", file);
    form.append("discipline", discipline);
    const res = await fetch(`/api/projects/${projectId}/plants`, { method: "POST", credentials: "include", body: form });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(res.status, body.error ?? `Erro ${res.status}`);
    }
    return res.json() as Promise<Plant>;
  },

  detail: (id: string) => request<{ plant: Plant; rooms: ExtractedRoom[]; rebarSchedules: ExtractedRebarLine[] }>(`/plants/${id}`),

  reprocess: (id: string) => request<Plant>(`/plants/${id}/reprocess`, { method: "POST" }),

  updateRoomFloor: (plantId: string, roomId: string, floor: string | null) =>
    request<ExtractedRoom>(`/plants/${plantId}/rooms/${roomId}`, { method: "PATCH", body: JSON.stringify({ floor }) }),

  delete: (id: string) => request<{ ok: true }>(`/plants/${id}`, { method: "DELETE" }),
};

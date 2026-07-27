import { ApiError, request } from "./http";

export type SiteDiaryEntry = {
  id: string;
  projectId: string;
  date: string;
  weather: string | null;
  workersPresent: number | null;
  equipmentPresent: string | null;
  workDone: string;
  materialsReceived: string | null;
  materialsConsumed: string | null;
  visitors: string | null;
  inspectorInstructions: string | null;
  incidents: string | null;
  decisions: string | null;
  entryTime: string | null;
  exitTime: string | null;
  photoUrls: string[];
  createdAt: string;
  taskProgress: Array<{ id: string; scheduleTaskId: string; taskName: string; taskCode: string; progressPercent: number; notes: string | null }>;
  consumptions: Array<{ id: string; materialId: string; materialName: string; unit: string; quantity: number; notes: string | null }>;
};

export type SiteDiaryEntryInput = {
  date: string;
  weather?: string;
  workersPresent?: number;
  equipmentPresent?: string;
  workDone: string;
  materialsReceived?: string;
  materialsConsumed?: string;
  visitors?: string;
  inspectorInstructions?: string;
  incidents?: string;
  decisions?: string;
  entryTime?: string;
  exitTime?: string;
  taskProgress?: Array<{ taskId: string; progressPercent: number; notes?: string }>;
  consumptions?: Array<{ materialId: string; quantity: number; notes?: string }>;
};

export const siteDiaryApi = {
  list: (projectId: string) => request<SiteDiaryEntry[]>(`/projects/${projectId}/site-diary`),
  create: (projectId: string, data: SiteDiaryEntryInput) =>
    request<SiteDiaryEntry>(`/projects/${projectId}/site-diary`, { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: Partial<SiteDiaryEntryInput>) =>
    request<SiteDiaryEntry>(`/site-diary/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  delete: (id: string) => request<{ ok: true }>(`/site-diary/${id}`, { method: "DELETE" }),
  uploadPhoto: async (id: string, file: File): Promise<SiteDiaryEntry> => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`/api/site-diary/${id}/photos`, { method: "POST", credentials: "include", body: form });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(res.status, body.error ?? `Erro ${res.status}`);
    }
    return res.json();
  },
  deletePhoto: (id: string, url: string) => request<SiteDiaryEntry>(`/site-diary/${id}/photos?url=${encodeURIComponent(url)}`, { method: "DELETE" }),
  exportPdfUrl: (id: string) => `/api/site-diary/${id}/export.pdf`,
};

import { ApiError } from "./http";

export type QuickCalcLine = { name: string; quantity: number; unit: string; unitPrice?: number; totalPrice?: number; currency?: "MZN" | "USD"; priceSource?: string };
export type QuickCalcResult = { title: string; reference?: string; inputsSummary: string[]; lines: QuickCalcLine[]; notes?: string[] };

export const quickCalcApi = {
  exportPdf: async (result: QuickCalcResult): Promise<Blob> => {
    const res = await fetch("/api/quick-calc/export.pdf", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(res.status, body.error ?? `Erro ${res.status}`);
    }
    return res.blob();
  },
};

// Descarrega um Blob como ficheiro — usado para o PDF do Cálculo Rápido, que vem directamente
// no corpo da resposta (sem URL própria como os exports ligados a um documento).
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

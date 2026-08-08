import { env } from "../env.js";
import type { FiscalDocumentFacts } from "./procurementFiscalControl.js";

export type FiscalExtractionResult = {
  status: "extracted" | "manual_required" | "failed";
  provider: string | null;
  confidence: number | null;
  facts: FiscalDocumentFacts | null;
  message?: string;
};

/**
 * Adapter opcional. O SIGO não depende de OCR para funcionar e nunca usa a resposta deste
 * serviço para aprovar automaticamente uma factura. Quando configurado, o serviço recebe
 * o documento em base64 e deve devolver { facts, confidence?, provider? }.
 */
export async function extractFiscalDocument(args: {
  buffer: Buffer;
  mimeType: string;
  filename: string;
}): Promise<FiscalExtractionResult> {
  if (!env.fiscalExtractorUrl) {
    return { status: "manual_required", provider: null, confidence: null, facts: null, message: "Extractor fiscal não configurado" };
  }
  try {
    const response = await fetch(env.fiscalExtractorUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(env.fiscalExtractorToken ? { "x-sigo-service-token": env.fiscalExtractorToken } : {}),
      },
      body: JSON.stringify({
        filename: args.filename,
        mimeType: args.mimeType,
        contentBase64: args.buffer.toString("base64"),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return { status: "failed", provider: "external", confidence: null, facts: null, message: `Extractor respondeu HTTP ${response.status}` };
    const payload = await response.json() as { facts?: FiscalDocumentFacts; confidence?: number; provider?: string };
    if (!payload.facts || typeof payload.facts !== "object") return { status: "failed", provider: payload.provider ?? "external", confidence: payload.confidence ?? null, facts: null, message: "Resposta sem facts" };
    return {
      status: "extracted",
      provider: payload.provider ?? "external",
      confidence: Number.isFinite(payload.confidence) ? Number(payload.confidence) : null,
      facts: payload.facts,
    };
  } catch (cause) {
    return { status: "failed", provider: "external", confidence: null, facts: null, message: cause instanceof Error ? cause.message : "Falha de extracção" };
  }
}

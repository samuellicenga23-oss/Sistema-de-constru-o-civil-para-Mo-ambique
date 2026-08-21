import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { priceZones, projects } from "../db/schema.js";

/** Nota regional para RFQ/OC — contexto de entrega moçambicano sem inventar logística. */
export async function buildProcurementRegionalNote(projectId: string): Promise<string | null> {
  const [project] = await db
    .select({
      provincia: projects.provincia,
      distrito: projects.distrito,
      bairro: projects.bairro,
      zoneId: projects.zoneId,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) return null;

  let zoneName: string | null = null;
  if (project.zoneId) {
    const [zone] = await db.select({ name: priceZones.name, province: priceZones.province, district: priceZones.district })
      .from(priceZones).where(eq(priceZones.id, project.zoneId)).limit(1);
    zoneName = zone?.name ?? null;
  }

  const parts = [
    project.provincia ? `Província: ${project.provincia}` : null,
    project.distrito ? `Distrito: ${project.distrito}` : null,
    project.bairro ? `Bairro: ${project.bairro}` : null,
    zoneName ? `Zona de preço: ${zoneName}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

export function resolvePaymentTermsCode(paymentTerms: string | null | undefined): string | null {
  const text = String(paymentTerms ?? "").toLowerCase();
  if (!text.trim()) return "30_dias";
  if (/\b60\b/.test(text)) return "60_dias";
  if (/\b30\b/.test(text)) return "30_dias";
  return "30_dias";
}

export function resolveLeadTimeDays(supplier: {
  defaultLeadTimeDays: number | null;
  leadTimeByZone: Record<string, number> | null;
  zoneId?: string | null;
}, zoneId?: string | null): number | null {
  const key = zoneId ?? supplier.zoneId ?? null;
  if (key && supplier.leadTimeByZone?.[key] != null) return supplier.leadTimeByZone[key];
  return supplier.defaultLeadTimeDays;
}

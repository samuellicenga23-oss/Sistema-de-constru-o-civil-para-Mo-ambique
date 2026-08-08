import { eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { budgetDocuments, lineItems, measurementCertificates, projects } from "../db/schema.js";
import { getCompositionLabourQuantitiesV2 as getCompositionLabourQuantities } from "./costEngineV2.js";
import { getCertificateDetail } from "./measurementEngine.js";
import { CONSTRUCTION_PHASES, mapToPhase, phaseLabel, type PhaseKey } from "./phaseMapping.js";

export type PhaseLabourLine = {
  labourCategoryId: string;
  name: string;
  plannedHours: number;
  periodHours: number;
  cumulativeHours: number;
  hourlyRate: number;
  periodCost: number;
  cumulativeCost: number;
  currency: string;
};

export type LabourByPhaseResult = {
  currency: string;
  ivaRate: number;
  phases: Array<{
    key: PhaseKey;
    label: string;
    labour: PhaseLabourLine[];
    itemsWithoutComposition: Array<{ code: string | null; description: string; periodQty: number; unit: string | null }>;
    periodHours: number;
    cumulativeHours: number;
    periodCost: number;
    cumulativeCost: number;
  }>;
  grandPeriodHours: number;
  grandCumulativeHours: number;
  grandPeriodCost: number;
  grandCumulativeCost: number;
};

export async function computeLabourByPhase(certificateId: string, companyId: string): Promise<LabourByPhaseResult | null> {
  const [context] = await db
    .select({ document: budgetDocuments, project: projects })
    .from(measurementCertificates)
    .innerJoin(budgetDocuments, eq(measurementCertificates.budgetDocumentId, budgetDocuments.id))
    .innerJoin(projects, eq(measurementCertificates.projectId, projects.id))
    .where(eq(measurementCertificates.id, certificateId))
    .limit(1);
  if (!context || context.project.companyId !== companyId) return null;
  const detail = await getCertificateDetail(certificateId);
  if (!detail) return null;

  const itemIds = detail.lines.map((line) => line.lineItemId);
  const itemRows = itemIds.length
    ? await db.select({ id: lineItems.id, compositionId: lineItems.compositionId }).from(lineItems).where(inArray(lineItems.id, itemIds))
    : [];
  const compositionByItem = new Map(itemRows.map((row) => [row.id, row.compositionId]));
  const resourceCache = new Map<string, Awaited<ReturnType<typeof getCompositionLabourQuantities>>>();
  const buckets = new Map<PhaseKey, Map<string, PhaseLabourLine>>();
  const unmapped = new Map<PhaseKey, LabourByPhaseResult["phases"][number]["itemsWithoutComposition"]>();

  for (const line of detail.lines) {
    const phaseKey = mapToPhase(line.sectionName, [line.sectionName], line.description);
    const compositionId = compositionByItem.get(line.lineItemId);
    if (!compositionId) {
      if (line.periodQty > 0 || line.cumulativeQty > 0) {
        const rows = unmapped.get(phaseKey) ?? [];
        rows.push({ code: line.code, description: line.description, periodQty: line.periodQty, unit: line.unit });
        unmapped.set(phaseKey, rows);
      }
      continue;
    }
    if (!resourceCache.has(compositionId)) {
      resourceCache.set(compositionId, await getCompositionLabourQuantities(compositionId, companyId, context.project.zoneId));
    }
    const bucket = buckets.get(phaseKey) ?? new Map<string, PhaseLabourLine>();
    for (const resource of resourceCache.get(compositionId)!) {
      const plannedHours = (line.budgetedQty ?? 0) * resource.hoursPerUnit;
      const periodHours = line.periodQty * resource.hoursPerUnit;
      const cumulativeHours = line.cumulativeQty * resource.hoursPerUnit;
      const existing = bucket.get(resource.familyKey) ?? {
        labourCategoryId: resource.labourCategoryId,
        name: resource.name,
        plannedHours: 0,
        periodHours: 0,
        cumulativeHours: 0,
        hourlyRate: resource.hourlyRate,
        periodCost: 0,
        cumulativeCost: 0,
        currency: resource.currency,
      };
      existing.plannedHours += plannedHours;
      existing.periodHours += periodHours;
      existing.cumulativeHours += cumulativeHours;
      existing.periodCost += periodHours * resource.hourlyRate;
      existing.cumulativeCost += cumulativeHours * resource.hourlyRate;
      existing.labourCategoryId = resource.labourCategoryId || existing.labourCategoryId;
      existing.name = resource.name || existing.name;
      existing.hourlyRate = resource.hourlyRate;
      bucket.set(resource.familyKey, existing);
    }
    buckets.set(phaseKey, bucket);
  }

  const phases = CONSTRUCTION_PHASES.map((phase) => {
    const labour = Array.from(buckets.get(phase.key)?.values() ?? []).sort((a, b) => b.periodHours - a.periodHours || a.name.localeCompare(b.name, "pt"));
    return {
      key: phase.key,
      label: phaseLabel(phase.key),
      labour,
      itemsWithoutComposition: unmapped.get(phase.key) ?? [],
      periodHours: labour.reduce((sum, line) => sum + line.periodHours, 0),
      cumulativeHours: labour.reduce((sum, line) => sum + line.cumulativeHours, 0),
      periodCost: labour.reduce((sum, line) => sum + line.periodCost, 0),
      cumulativeCost: labour.reduce((sum, line) => sum + line.cumulativeCost, 0),
    };
  }).filter((phase) => phase.labour.length > 0 || phase.itemsWithoutComposition.length > 0);

  return {
    currency: context.document.currency,
    ivaRate: Number(context.document.ivaRate),
    phases,
    grandPeriodHours: phases.reduce((sum, phase) => sum + phase.periodHours, 0),
    grandCumulativeHours: phases.reduce((sum, phase) => sum + phase.cumulativeHours, 0),
    grandPeriodCost: phases.reduce((sum, phase) => sum + phase.periodCost, 0),
    grandCumulativeCost: phases.reduce((sum, phase) => sum + phase.cumulativeCost, 0),
  };
}

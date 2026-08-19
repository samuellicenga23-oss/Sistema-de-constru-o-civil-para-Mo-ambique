import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { budgetDocuments, budgetSections, lineItems } from "../db/schema.js";
import { calculateBudgetTotals } from "./budgetTotals.js";

export type RevisionDiffItem = {
  key: string;
  code: string | null;
  description: string;
  previousQuantity: number | null;
  quantity: number | null;
  previousUnitPrice: number | null;
  unitPrice: number | null;
  previousTotal: number;
  total: number;
  delta: number;
  deltaPct: number | null;
  quantityEffect: number;
  priceEffect: number;
};

function num(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function decomposePriceQuantity(previousQuantity: number | null, previousPrice: number | null, quantity: number | null, price: number | null) {
  const q0 = previousQuantity ?? 0;
  const p0 = previousPrice ?? 0;
  const q1 = quantity ?? 0;
  const p1 = price ?? 0;
  const previousTotal = q0 * p0;
  const total = q1 * p1;
  const quantityEffect = p0 * (q1 - q0);
  const priceEffect = q1 * (p1 - p0);
  const delta = total - previousTotal;
  const deltaPct = previousTotal === 0 ? (total === 0 ? 0 : null) : (delta / previousTotal) * 100;
  return { previousTotal, total, delta, deltaPct, quantityEffect, priceEffect };
}

function itemKey(item: { code: string | null; description: string; unit: string | null }) {
  return (item.code?.trim() || `${item.description}|${item.unit ?? ""}`).toLocaleLowerCase("pt");
}

async function documentItems(documentId: string) {
  const sections = await db.select().from(budgetSections).where(eq(budgetSections.documentId, documentId));
  const items = sections.length
    ? await db.select().from(lineItems).where(inArray(lineItems.sectionId, sections.map((section) => section.id)))
    : [];
  return items.filter((item) => item.kind === "item");
}

export async function findPreviousBudgetDocument(documentId: string) {
  const [current] = await db.select().from(budgetDocuments).where(eq(budgetDocuments.id, documentId)).limit(1);
  if (!current) return { current: null, previous: null };
  const revision = Number(current.revision);
  if (!Number.isFinite(revision) || revision <= 0) return { current, previous: null };
  const family = current.sourceMeasurementDocumentId
    ? and(
        eq(budgetDocuments.projectId, current.projectId),
        eq(budgetDocuments.documentType, current.documentType),
        eq(budgetDocuments.sourceMeasurementDocumentId, current.sourceMeasurementDocumentId),
      )
    : and(eq(budgetDocuments.projectId, current.projectId), eq(budgetDocuments.documentType, current.documentType));
  const related = await db.select().from(budgetDocuments).where(family);
  const previous = related.find((row) => row.revision === String(revision - 1) && row.id !== current.id) ?? null;
  return { current, previous };
}

export async function compareBudgetRevisions(documentId: string) {
  const { current, previous } = await findPreviousBudgetDocument(documentId);
  if (!current) return null;
  const currentRates = {
    siteCostsRate: Number(current.siteCostsRate),
    indirectCostsRate: Number(current.indirectCostsRate),
    contingenciasRate: Number(current.contingenciasRate),
    profitMarginRate: Number(current.profitMarginRate),
    ivaRate: Number(current.ivaRate),
  };
  if (!previous) {
    const currentItems = await documentItems(current.id);
    const currentSubtotal = currentItems.reduce((sum, item) => sum + (num(item.quantity) ?? 0) * (num(item.unitPrice) ?? 0), 0);
    const currentTotal = calculateBudgetTotals(currentSubtotal, currentRates).total;
    return {
      previous: null,
      current: { id: current.id, title: current.title, revision: current.revision },
      previousTotal: 0,
      currentTotal,
      delta: currentTotal,
      items: [] as RevisionDiffItem[],
    };
  }
  const [currentItems, previousItems] = await Promise.all([documentItems(current.id), documentItems(previous.id)]);
  const previousByKey = new Map(previousItems.map((item) => [itemKey(item), item]));
  const seen = new Set<string>();
  const items: RevisionDiffItem[] = [];
  for (const item of currentItems) {
    const key = itemKey(item);
    seen.add(key);
    const before = previousByKey.get(key);
    const qty = num(item.quantity);
    const price = num(item.unitPrice);
    const prevQty = num(before?.quantity);
    const prevPrice = num(before?.unitPrice);
    const parts = decomposePriceQuantity(prevQty, prevPrice, qty, price);
    items.push({
      key,
      code: item.code,
      description: item.description,
      previousQuantity: prevQty,
      quantity: qty,
      previousUnitPrice: prevPrice,
      unitPrice: price,
      ...parts,
    });
  }
  for (const item of previousItems) {
    const key = itemKey(item);
    if (seen.has(key)) continue;
    const parts = decomposePriceQuantity(num(item.quantity), num(item.unitPrice), 0, 0);
    items.push({
      key,
      code: item.code,
      description: item.description,
      previousQuantity: num(item.quantity),
      quantity: null,
      previousUnitPrice: num(item.unitPrice),
      unitPrice: null,
      ...parts,
    });
  }
  items.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const previousSubtotal = previousItems.reduce((sum, item) => sum + (num(item.quantity) ?? 0) * (num(item.unitPrice) ?? 0), 0);
  const currentSubtotal = currentItems.reduce((sum, item) => sum + (num(item.quantity) ?? 0) * (num(item.unitPrice) ?? 0), 0);
  const previousTotal = calculateBudgetTotals(previousSubtotal, {
    siteCostsRate: Number(previous.siteCostsRate),
    indirectCostsRate: Number(previous.indirectCostsRate),
    contingenciasRate: Number(previous.contingenciasRate),
    profitMarginRate: Number(previous.profitMarginRate),
    ivaRate: Number(previous.ivaRate),
  }).total;
  const currentTotal = calculateBudgetTotals(currentSubtotal, currentRates).total;
  return {
    previous: { id: previous.id, title: previous.title, revision: previous.revision },
    current: { id: current.id, title: current.title, revision: current.revision },
    previousTotal,
    currentTotal,
    delta: currentTotal - previousTotal,
    items,
  };
}

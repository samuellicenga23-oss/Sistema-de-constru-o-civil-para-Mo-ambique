import { eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { budgetDocuments, budgetSections, lineItems } from "../db/schema.js";
import { calculateBudgetTotals } from "./budgetTotals.js";
import { technicalDescription } from "./technicalDescriptions.js";
import { enrichLineItemTechnicalSpecs } from "./specEnrichment.js";

export type LineItemNode = {
  id: string;
  sectionId: string;
  parentId: string | null;
  kind: "capitulo" | "grupo" | "item" | "nota";
  code: string | null;
  description: string;
  technicalSpecification: string | null;
  unit: string | null;
  quantity: number | null;
  unitPrice: number | null;
  sellingUnitPrice: number | null;
  compositionId: string | null;
  origin: "manual" | "planta" | "composicao";
  sortOrder: number;
  totalPrice: number; // calculado on-the-fly: item = quantidade*preço; capítulo/grupo = soma dos filhos
  sellingTotalPrice: number;
  children: LineItemNode[];
};

export type SectionNode = {
  id: string;
  name: string;
  sortOrder: number;
  items: LineItemNode[];
  total: number;
  sellingTotal: number;
};

export type BudgetDocumentSummary = {
  document: typeof budgetDocuments.$inferSelect;
  sections: SectionNode[];
  subtotal1: number;
  siteCosts: number;
  indirectCosts: number;
  sellingSubtotal: number;
  unitPriceFactor: number;
  contingencias: number;
  profitMargin: number;
  subtotal2: number;
  iva: number;
  total: number;
};

function clientNode(node: LineItemNode): LineItemNode {
  return {
    ...node,
    unitPrice: node.sellingUnitPrice,
    totalPrice: node.sellingTotalPrice,
    children: node.children.map(clientNode),
  };
}

/**
 * Remove a decomposição comercial da resposta destinada ao perfil Visualizador.
 * O preço contratual continua exacto, mas custos directos, estaleiro, indirectos
 * e margem não ficam recuperáveis pela interface nem pela resposta JSON.
 */
export function hideInternalPricing(summary: BudgetDocumentSummary): BudgetDocumentSummary {
  return {
    ...summary,
    document: {
      ...summary.document,
      siteCostsRate: "0",
      indirectCostsRate: "0",
      profitMarginRate: "0",
    },
    sections: summary.sections.map((section) => ({
      ...section,
      total: section.sellingTotal,
      items: section.items.map(clientNode),
    })),
    subtotal1: summary.sellingSubtotal,
    siteCosts: 0,
    indirectCosts: 0,
    profitMargin: 0,
    unitPriceFactor: 1,
  };
}

function splitDescription(description: string): { label: string; embeddedSpec: string | null } {
  const marker = "\n\n— Especificação técnica —\n";
  const idx = description.indexOf(marker);
  if (idx === -1) return { label: technicalDescription(description), embeddedSpec: null };
  return {
    label: technicalDescription(description.slice(0, idx).trim()),
    embeddedSpec: description.slice(idx + marker.length).trim() || null,
  };
}

function buildTree(flatItems: (typeof lineItems.$inferSelect)[], techSpecs: Map<string, string | null>): LineItemNode[] {
  const byId = new Map<string, LineItemNode>();
  for (const item of flatItems) {
    const { label, embeddedSpec } = splitDescription(item.description);
    byId.set(item.id, {
      ...item,
      description: label,
      technicalSpecification: embeddedSpec ?? techSpecs.get(item.id) ?? null,
      quantity: item.quantity !== null ? Number(item.quantity) : null,
      unitPrice: item.unitPrice !== null ? Number(item.unitPrice) : null,
      sellingUnitPrice: null,
      totalPrice: 0,
      sellingTotalPrice: 0,
      children: [],
    } as LineItemNode);
  }

  const roots: LineItemNode[] = [];
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  function sortRecursive(nodes: LineItemNode[]) {
    nodes.sort((a, b) => a.sortOrder - b.sortOrder);
    for (const n of nodes) sortRecursive(n.children);
  }
  sortRecursive(roots);

  // Preço total: item = quantidade × preço unitário; capítulo/grupo = soma recursiva dos filhos; nota = 0.
  function computeTotal(node: LineItemNode): number {
    if (node.kind === "item") {
      node.totalPrice = (node.quantity ?? 0) * (node.unitPrice ?? 0);
    } else if (node.kind === "nota") {
      node.totalPrice = 0;
    } else {
      node.totalPrice = node.children.reduce((sum, c) => sum + computeTotal(c), 0);
    }
    return node.totalPrice;
  }
  for (const root of roots) computeTotal(root);

  return roots;
}

export async function getBudgetDocumentSummary(documentId: string): Promise<BudgetDocumentSummary | null> {
  const [document] = await db.select().from(budgetDocuments).where(eq(budgetDocuments.id, documentId)).limit(1);
  if (!document) return null;

  const sections = await db
    .select()
    .from(budgetSections)
    .where(eq(budgetSections.documentId, documentId))
    .orderBy(budgetSections.sortOrder);

  const sectionIds = sections.map((s) => s.id);
  const allItems = sectionIds.length
    ? await db.select().from(lineItems).where(inArray(lineItems.sectionId, sectionIds))
    : [];

  const projectId = document.projectId;
  const techSpecs = await enrichLineItemTechnicalSpecs(allItems, projectId);

  const sectionNodes: SectionNode[] = sections.map((section) => {
    const items = buildTree(allItems.filter((i) => i.sectionId === section.id), techSpecs);
    const total = items.reduce((sum, i) => sum + i.totalPrice, 0);
    return { id: section.id, name: section.name, sortOrder: section.sortOrder, templateKey: section.templateKey, items, total, sellingTotal: 0 };
  });

  const subtotal1 = sectionNodes.reduce((sum, s) => sum + s.total, 0);
  const totals = calculateBudgetTotals(subtotal1, {
    siteCostsRate: Number(document.siteCostsRate),
    indirectCostsRate: Number(document.indirectCostsRate),
    contingenciasRate: Number(document.contingenciasRate),
    profitMarginRate: Number(document.profitMarginRate),
    ivaRate: Number(document.ivaRate),
  });

  function applySellingPrices(node: LineItemNode): number {
    if (node.kind === "item") {
      node.sellingUnitPrice = (node.unitPrice ?? 0) * totals.unitPriceFactor;
      node.sellingTotalPrice = (node.quantity ?? 0) * node.sellingUnitPrice;
    } else if (node.kind === "nota") {
      node.sellingUnitPrice = null;
      node.sellingTotalPrice = 0;
    } else {
      node.sellingUnitPrice = null;
      node.sellingTotalPrice = node.children.reduce((sum, child) => sum + applySellingPrices(child), 0);
    }
    return node.sellingTotalPrice;
  }

  for (const section of sectionNodes) {
    section.sellingTotal = section.items.reduce((sum, item) => sum + applySellingPrices(item), 0);
  }

  return { document, sections: sectionNodes, ...totals };
}

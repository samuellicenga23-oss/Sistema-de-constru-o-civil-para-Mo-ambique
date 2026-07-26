import { eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { budgetDocuments, budgetSections, lineItems } from "../db/schema.js";

export type LineItemNode = {
  id: string;
  sectionId: string;
  parentId: string | null;
  kind: "capitulo" | "grupo" | "item" | "nota";
  code: string | null;
  description: string;
  unit: string | null;
  quantity: number | null;
  unitPrice: number | null;
  compositionId: string | null;
  origin: "manual" | "planta" | "composicao";
  sortOrder: number;
  totalPrice: number; // calculado on-the-fly: item = quantidade*preço; capítulo/grupo = soma dos filhos
  children: LineItemNode[];
};

export type SectionNode = {
  id: string;
  name: string;
  sortOrder: number;
  items: LineItemNode[];
  total: number;
};

export type BudgetDocumentSummary = {
  document: typeof budgetDocuments.$inferSelect;
  sections: SectionNode[];
  subtotal1: number;
  contingencias: number;
  subtotal2: number;
  iva: number;
  total: number;
};

function buildTree(flatItems: (typeof lineItems.$inferSelect)[]): LineItemNode[] {
  const byId = new Map<string, LineItemNode>();
  for (const item of flatItems) {
    byId.set(item.id, {
      ...item,
      quantity: item.quantity !== null ? Number(item.quantity) : null,
      unitPrice: item.unitPrice !== null ? Number(item.unitPrice) : null,
      totalPrice: 0,
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

  const sectionNodes: SectionNode[] = sections.map((section) => {
    const items = buildTree(allItems.filter((i) => i.sectionId === section.id));
    const total = items.reduce((sum, i) => sum + i.totalPrice, 0);
    return { id: section.id, name: section.name, sortOrder: section.sortOrder, items, total };
  });

  const subtotal1 = sectionNodes.reduce((sum, s) => sum + s.total, 0);
  const contingencias = subtotal1 * Number(document.contingenciasRate);
  const subtotal2 = subtotal1 + contingencias;
  const iva = subtotal2 * Number(document.ivaRate);
  const total = subtotal2 + iva;

  return { document, sections: sectionNodes, subtotal1, contingencias, subtotal2, iva, total };
}

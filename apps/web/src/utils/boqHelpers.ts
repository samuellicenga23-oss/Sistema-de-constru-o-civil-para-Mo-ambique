import type { LineItemNode } from "../api/boq";

export type UnpricedItemRef = {
  id: string;
  code: string | null;
  description: string;
  sectionName: string;
};

export function isItemMissingPrice(node: LineItemNode): boolean {
  return node.kind === "item" && node.unitPrice == null && !node.compositionId;
}

export function collectUnpricedItems(items: LineItemNode[], sectionName: string): UnpricedItemRef[] {
  const out: UnpricedItemRef[] = [];
  function walk(nodes: LineItemNode[]) {
    for (const node of nodes) {
      if (isItemMissingPrice(node)) {
        out.push({ id: node.id, code: node.code, description: node.description, sectionName });
      }
      walk(node.children);
    }
  }
  walk(items);
  return out;
}

/** Mantém capítulos/grupos que contêm pelo menos um item sem preço. */
export function filterTreeToUnpricedOnly(items: LineItemNode[]): LineItemNode[] {
  const result: LineItemNode[] = [];
  for (const node of items) {
    if (node.kind === "item") {
      if (isItemMissingPrice(node)) result.push(node);
      continue;
    }
    const children = filterTreeToUnpricedOnly(node.children);
    if (children.length > 0) result.push({ ...node, children });
  }
  return result;
}

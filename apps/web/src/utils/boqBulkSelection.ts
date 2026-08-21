import type { LineItemNode, SectionNode } from "../api/boq";

export function collectBoqItems(sections: SectionNode[]): LineItemNode[] {
  const out: LineItemNode[] = [];
  function walk(nodes: LineItemNode[]) {
    for (const node of nodes) {
      if (node.kind === "item") out.push(node);
      walk(node.children);
    }
  }
  for (const section of sections) walk(section.items);
  return out;
}

export function exportBoqSelectionCsv(items: LineItemNode[]): string {
  const header = "codigo,descricao,unidade,quantidade";
  const rows = items.map((item) => {
    const code = csvCell(item.code ?? "");
    const description = csvCell(item.description);
    const unit = csvCell(item.unit ?? "");
    const quantity = item.quantity == null ? "" : String(item.quantity);
    return `${code},${description},${unit},${quantity}`;
  });
  return [header, ...rows].join("\n");
}

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function downloadTextFile(filename: string, content: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob(["\uFEFF", content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

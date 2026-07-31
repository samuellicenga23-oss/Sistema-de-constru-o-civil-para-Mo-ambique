import puppeteer from "puppeteer";
import type { BudgetDocumentSummary, LineItemNode, SectionNode } from "./boqEngine.js";

function money(value: number) {
  return value.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Gera as linhas <tr> de um nó e dos seus filhos, recursivamente.
// Lição do projecto ADIN: nunca usar CSS Grid/multi-column para conteúdo que pagina no
// Puppeteer — só <table> nativa sequencial pagina correctamente (thead repete-se).
function renderNodeRows(node: LineItemNode, depth: number): string {
  const indent = depth * 16;
  const isChapterLike = node.kind === "capitulo" || node.kind === "grupo";
  const rowClass = isChapterLike ? "chapter-row" : node.kind === "nota" ? "note-row" : "";

  const row = `
    <tr class="${rowClass}">
      <td class="code">${escapeHtml(node.code ?? "")}</td>
      <td style="padding-left:${indent}px">${escapeHtml(node.description)}</td>
      <td class="num">${node.kind === "item" ? escapeHtml(node.unit ?? "") : ""}</td>
      <td class="num">${node.kind === "item" ? (node.quantity ?? 0) : ""}</td>
      <td class="num">${node.kind === "item" ? money(node.sellingUnitPrice ?? node.unitPrice ?? 0) : ""}</td>
      <td class="num">${node.kind !== "nota" ? money(node.sellingTotalPrice) : ""}</td>
    </tr>`;

  const childRows = node.children.map((c) => renderNodeRows(c, depth + 1)).join("");
  return row + childRows;
}

function renderSection(section: SectionNode): string {
  const chapterBlocks = section.items
    .map((topNode) => {
      const rows = renderNodeRows(topNode, 0);
      const subtotal =
        topNode.kind === "capitulo" && topNode.children.length > 0
          ? `<tr class="subtotal-row"><td></td><td>SUB-TOTAL ${escapeHtml(topNode.code ?? "")}</td><td></td><td></td><td></td><td class="num">${money(topNode.sellingTotalPrice)}</td></tr>`
          : "";
      return rows + subtotal;
    })
    .join("");

  return `
    <h2>${escapeHtml(section.name)}</h2>
    <table>
      <thead>
        <tr><th>ITEM</th><th>DESCRIÇÃO</th><th>UN</th><th>QUANT.</th><th>PREÇO UNIT.</th><th>PREÇO TOTAL</th></tr>
      </thead>
      <tbody>
        ${chapterBlocks}
        <tr class="total-row"><td></td><td>TOTAL ${escapeHtml(section.name.toUpperCase())}</td><td></td><td></td><td></td><td class="num">${money(section.sellingTotal)}</td></tr>
      </tbody>
    </table>`;
}

function buildHtml(summary: BudgetDocumentSummary): string {
  const { document, sections, sellingSubtotal, contingencias, subtotal2, iva, total } = summary;
  const sectionsHtml = sections.map(renderSection).join("");

  return `<!doctype html>
<html lang="pt">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #1e1b4b; margin: 24px; }
  h1 { font-size: 16px; margin: 0 0 4px; }
  h2 { font-size: 13px; margin: 18px 0 6px; color: #312e81; }
  .header { display: flex; justify-content: space-between; border-bottom: 2px solid #312e81; padding-bottom: 8px; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  th, td { border-bottom: 1px solid #e5e7eb; padding: 3px 6px; text-align: left; }
  th { background: #eef2ff; font-size: 10px; }
  td.code { width: 50px; color: #6b7280; }
  td.num, th.num { text-align: right; }
  .num { text-align: right; }
  .chapter-row { font-weight: bold; }
  .note-row { font-style: italic; color: #6b7280; }
  .subtotal-row { font-weight: bold; background: #f5f5ff; }
  .total-row { font-weight: bold; background: #e0e7ff; }
  .resumo { margin-top: 24px; page-break-before: always; }
  .resumo table { width: 60%; margin-left: auto; }
  .resumo .grand-total td { font-size: 14px; font-weight: bold; border-top: 2px solid #312e81; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <h1>${escapeHtml(document.title)}</h1>
      <div>Revisão: ${escapeHtml(document.revision ?? "-")} ${document.fileNumber ? `· Nº ${escapeHtml(document.fileNumber)}` : ""}</div>
    </div>
    <div>${document.currency}</div>
  </div>

  ${sectionsHtml}

  <div class="resumo">
    <h2>RESUMO</h2>
    <table>
      ${sections
        .map((s) => `<tr><td>${escapeHtml(s.name)}</td><td class="num">${money(s.sellingTotal)}</td></tr>`)
        .join("")}
      <tr><td>Trabalhos</td><td class="num">${money(sellingSubtotal)}</td></tr>
      <tr><td>Contingências (${(Number(document.contingenciasRate) * 100).toFixed(0)}%)</td><td class="num">${money(contingencias)}</td></tr>
      <tr><td>Base tributável</td><td class="num">${money(subtotal2)}</td></tr>
      <tr><td>IVA (${(Number(document.ivaRate) * 100).toFixed(0)}%)</td><td class="num">${money(iva)}</td></tr>
      <tr class="grand-total"><td>VALOR TOTAL</td><td class="num">${money(total)} ${document.currency}</td></tr>
    </table>
  </div>
</body>
</html>`;
}

export async function buildBudgetDocumentPdf(summary: BudgetDocumentSummary): Promise<Buffer> {
  const browser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(buildHtml(summary), { waitUntil: "networkidle0" });
    const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "15mm", bottom: "15mm", left: "12mm", right: "12mm" } });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

function renderMeasurementNodeRows(node: LineItemNode, depth: number): string {
  const isHeading = node.kind === "capitulo" || node.kind === "grupo";
  return `<tr class="${isHeading ? "chapter-row" : node.kind === "nota" ? "note-row" : ""}">
    <td class="code">${escapeHtml(node.code ?? "")}</td>
    <td style="padding-left:${depth * 16}px">${escapeHtml(node.description)}</td>
    <td class="num">${node.kind === "item" ? escapeHtml(node.unit ?? "") : ""}</td>
    <td class="num">${node.kind === "item" ? node.quantity ?? 0 : ""}</td>
  </tr>${node.children.map((child) => renderMeasurementNodeRows(child, depth + 1)).join("")}`;
}

export async function buildMeasurementDocumentPdf(summary: BudgetDocumentSummary): Promise<Buffer> {
  const sections = summary.sections.map((section) => `
    <h2>${escapeHtml(section.name)}</h2>
    <table>
      <thead><tr><th>ITEM</th><th>DESCRIÇÃO</th><th>UN</th><th>QUANTIDADE</th></tr></thead>
      <tbody>${section.items.map((node) => renderMeasurementNodeRows(node, 0)).join("")}</tbody>
    </table>`).join("");
  const html = `<!doctype html><html lang="pt"><head><meta charset="utf-8" /><style>
    *{box-sizing:border-box} body{font-family:Arial,sans-serif;font-size:11px;color:#172033;margin:24px}
    h1{font-size:17px;margin:0 0 3px} h2{font-size:13px;margin:18px 0 6px}
    .header{border-bottom:2px solid #172033;padding-bottom:8px;margin-bottom:12px}
    table{width:100%;border-collapse:collapse} thead{display:table-header-group} tr{break-inside:avoid}
    th,td{border-bottom:1px solid #dfe3e8;padding:4px 6px;text-align:left}
    th{background:#f1f4f7;font-size:10px}.code{width:55px;color:#64748b}.num{text-align:right}
    .chapter-row{font-weight:bold;background:#f8fafc}.note-row{font-style:italic;color:#64748b}
  </style></head><body><div class="header"><h1>Mapa de Medições e Quantidades</h1>
  <div>${escapeHtml(summary.document.title)} · revisão ${escapeHtml(summary.document.revision ?? "-")}</div></div>${sections}</body></html>`;
  const browser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "15mm", bottom: "15mm", left: "12mm", right: "12mm" } });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

import puppeteer from "puppeteer";
import type { BudgetDocumentSummary, LineItemNode, SectionNode } from "./boqEngine.js";
import type { CompanyBrand } from "./companyBrand.js";
import {
  escapeHtml,
  pdfChromeStyles,
  pdfFooterHtml,
  pdfLetterheadHtml,
} from "./documentChrome.js";

function money(value: number) {
  return value.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

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
    <h2 class="doc-section">${escapeHtml(section.name)}</h2>
    <table>
      <thead>
        <tr><th class="doc-th">ITEM</th><th class="doc-th">DESCRIÇÃO</th><th class="doc-th">UN</th><th class="doc-th">QUANT.</th><th class="doc-th">PREÇO UNIT.</th><th class="doc-th">PREÇO TOTAL</th></tr>
      </thead>
      <tbody>
        ${chapterBlocks}
        <tr class="total-row"><td></td><td>TOTAL ${escapeHtml(section.name.toUpperCase())}</td><td></td><td></td><td></td><td class="num">${money(section.sellingTotal)}</td></tr>
      </tbody>
    </table>`;
}

function buildHtml(summary: BudgetDocumentSummary, brand: CompanyBrand): string {
  const { document, sections, sellingSubtotal, contingencias, subtotal2, iva, total } = summary;
  const accent = brand.primaryColor || "#ED6C22";
  const sectionsHtml = sections.map(renderSection).join("");
  const subtitle = [
    document.revision ? `Revisão ${document.revision}` : null,
    document.fileNumber ? `Nº ${document.fileNumber}` : null,
    document.currency,
  ]
    .filter(Boolean)
    .join(" · ");

  return `<!doctype html>
<html lang="pt">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #14213d; margin: 22px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  th, td { border-bottom: 1px solid #e5e7eb; padding: 3px 6px; text-align: left; }
  th { font-size: 10px; }
  td.code { width: 50px; color: #6b7280; }
  .num { text-align: right; }
  .chapter-row { font-weight: bold; }
  .note-row { font-style: italic; color: #6b7280; }
  .subtotal-row { font-weight: bold; background: #f8fafc; }
  .total-row { font-weight: bold; background: #f1f5f9; }
  .resumo { margin-top: 24px; page-break-before: always; }
  .resumo table { width: 60%; margin-left: auto; }
  .resumo .grand-total td { font-size: 14px; font-weight: bold; border-top: 2px solid ${escapeHtml(accent)}; }
  ${pdfChromeStyles(accent)}
</style>
</head>
<body>
  ${pdfLetterheadHtml(brand, { title: document.title, subtitle })}
  ${sectionsHtml}
  <div class="resumo">
    <h2 class="doc-section">RESUMO</h2>
    <table>
      ${sections
        .map((s) => `<tr><td>${escapeHtml(s.name)}</td><td class="num">${money(s.sellingTotal)}</td></tr>`)
        .join("")}
      <tr><td>Trabalhos</td><td class="num">${money(sellingSubtotal)}</td></tr>
      <tr><td>Contingências (${(Number(document.contingenciasRate) * 100).toFixed(2)}%)</td><td class="num">${money(contingencias)}</td></tr>
      <tr><td>Base tributável</td><td class="num">${money(subtotal2)}</td></tr>
      <tr><td>IVA (${(Number(document.ivaRate) * 100).toFixed(2)}%)</td><td class="num">${money(iva)}</td></tr>
      <tr class="grand-total"><td>VALOR TOTAL</td><td class="num">${money(total)} ${document.currency}</td></tr>
    </table>
  </div>
  ${pdfFooterHtml(brand, "Orçamento / mapa de quantidades")}
</body>
</html>`;
}

export async function buildBudgetDocumentPdf(summary: BudgetDocumentSummary, brand: CompanyBrand): Promise<Buffer> {
  const browser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(buildHtml(summary, brand), { waitUntil: "networkidle0" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "14mm", bottom: "16mm", left: "12mm", right: "12mm" },
    });
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

export async function buildMeasurementDocumentPdf(summary: BudgetDocumentSummary, brand: CompanyBrand): Promise<Buffer> {
  const accent = brand.primaryColor || "#ED6C22";
  const sections = summary.sections
    .map(
      (section) => `
    <h2 class="doc-section">${escapeHtml(section.name)}</h2>
    <table>
      <thead><tr><th class="doc-th">ITEM</th><th class="doc-th">DESCRIÇÃO</th><th class="doc-th">UN</th><th class="doc-th">QUANTIDADE</th></tr></thead>
      <tbody>${section.items.map((node) => renderMeasurementNodeRows(node, 0)).join("")}</tbody>
    </table>`,
    )
    .join("");
  const html = `<!doctype html><html lang="pt"><head><meta charset="utf-8" /><style>
    *{box-sizing:border-box} body{font-family:Arial,sans-serif;font-size:11px;color:#14213d;margin:22px}
    table{width:100%;border-collapse:collapse} thead{display:table-header-group} tr{break-inside:avoid}
    th,td{border-bottom:1px solid #dfe3e8;padding:4px 6px;text-align:left}
    th{font-size:10px}.code{width:55px;color:#64748b}.num{text-align:right}
    .chapter-row{font-weight:bold;background:#f8fafc}.note-row{font-style:italic;color:#64748b}
    ${pdfChromeStyles(accent)}
  </style></head><body>
  ${pdfLetterheadHtml(brand, {
    title: "Mapa de Medições e Quantidades",
    subtitle: `${summary.document.title} · revisão ${summary.document.revision ?? "-"}`,
  })}
  ${sections}
  ${pdfFooterHtml(brand, "Medições")}
  </body></html>`;
  const browser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "14mm", bottom: "16mm", left: "12mm", right: "12mm" },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

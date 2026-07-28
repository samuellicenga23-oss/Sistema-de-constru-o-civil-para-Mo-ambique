import puppeteer from "puppeteer";
import type { QuickCalcResult } from "@sigo/shared";

function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmt(n: number) {
  return n.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
}

function buildHtml(result: QuickCalcResult): string {
  const generatedAt = new Date().toLocaleString("pt-MZ");
  const inputsHtml = result.inputsSummary.map((i) => `<li>${escapeHtml(i)}</li>`).join("");
  const hasPrices = result.lines.some((line) => line.totalPrice !== undefined);
  const rowsHtml = result.lines
    .map((l) => `<tr><td>${escapeHtml(l.name)}${l.priceSource ? `<small>${escapeHtml(l.priceSource)}</small>` : ""}</td><td class="num">${fmt(l.quantity)}</td><td>${escapeHtml(l.unit)}</td>${hasPrices ? `<td class="num">${l.unitPrice !== undefined ? fmt(l.unitPrice) : "—"}</td><td class="num total">${l.totalPrice !== undefined ? `${fmt(l.totalPrice)} ${escapeHtml(l.currency ?? "")}` : "—"}</td>` : ""}</tr>`)
    .join("");
  const notesHtml = (result.notes ?? []).map((n) => `<li>${escapeHtml(n)}</li>`).join("");

  return `<!doctype html>
<html lang="pt">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #1e1b4b; margin: 28px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { color: #6b7280; font-size: 11px; margin-bottom: 18px; }
  h2 { font-size: 13px; margin: 18px 0 8px; color: #312e81; }
  ul { margin: 0 0 4px; padding-left: 18px; }
  li { margin-bottom: 2px; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 16px; }
  th, td { border-bottom: 1px solid #e5e7eb; padding: 6px 8px; text-align: left; }
  th { background: #eef2ff; font-size: 11px; }
  td.num, th.num { text-align: right; }
  td small { display: block; color: #6b7280; font-size: 9px; margin-top: 2px; }
  td.total { font-weight: 700; }
  .notes { color: #6b7280; font-size: 10.5px; }
</style>
</head>
<body>
  <h1>${escapeHtml(result.title)}</h1>
  ${result.reference ? `<div class="meta">${escapeHtml(result.reference)}</div>` : ""}
  <div class="meta">SIGO — Cálculo Rápido · gerado em ${generatedAt}</div>

  <h2>Dados usados</h2>
  <ul>${inputsHtml}</ul>

  <h2>Quantidades</h2>
  <table>
    <thead><tr><th>Material</th><th class="num">Quantidade</th><th>Unidade</th>${hasPrices ? '<th class="num">Preço unit.</th><th class="num">Total</th>' : ""}</tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>

  ${notesHtml ? `<h2>Notas</h2><ul class="notes">${notesHtml}</ul>` : ""}
</body>
</html>`;
}

export async function buildQuickCalcPdf(result: QuickCalcResult): Promise<Buffer> {
  const browser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(buildHtml(result), { waitUntil: "networkidle0" });
    const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "15mm", bottom: "15mm", left: "15mm", right: "15mm" } });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

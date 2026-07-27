import puppeteer from "puppeteer";
import type { MaterialsByPhaseResult, PhaseReport } from "./materialsByPhase.js";

function fmt(n: number) {
  return n.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
}

function money(n: number, currency: string) {
  return `${n.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderPhase(phase: PhaseReport, currency: string): string {
  const materialRows = phase.materials
    .map(
      (m) => `<tr>
        <td>${escapeHtml(m.name)}</td>
        <td class="num">${fmt(m.quantity)}</td>
        <td>${escapeHtml(m.unit)}</td>
        <td>${m.purchasePackageLabel && m.purchaseQty !== null ? `${m.purchaseQty} × ${escapeHtml(m.purchasePackageLabel)}` : "—"}</td>
        <td class="num">${money(m.value, m.currency)}</td>
      </tr>`
    )
    .join("");

  const unmatchedRows = phase.itemsWithoutComposition
    .map(
      (i) => `<tr class="manual-row">
        <td>${escapeHtml(i.code ?? "")} ${escapeHtml(i.description)}</td>
        <td class="num">${fmt(i.quantity)}</td>
        <td>${escapeHtml(i.unit ?? "")}</td>
        <td>${i.barsInfo ? `${i.barsInfo.barsNeeded} varões de ${fmt(i.barsInfo.barLengthM)}m (Ø${i.barsInfo.diameterMm}mm)` : "sem composição"}</td>
        <td class="num">${money(i.value, currency)}</td>
      </tr>`
    )
    .join("");

  const hasRows = phase.materials.length > 0 || phase.itemsWithoutComposition.length > 0;

  return `
    <h2>${escapeHtml(phase.label)} <span class="phase-total">${money(phase.valueTotal, currency)}</span></h2>
    ${
      hasRows
        ? `<table>
             <thead><tr><th>Material</th><th class="num">Quantidade</th><th>Unidade</th><th>Unidade de compra</th><th class="num">Valor</th></tr></thead>
             <tbody>${materialRows}${unmatchedRows}</tbody>
           </table>`
        : `<p class="empty">Sem materiais explodidos nesta fase.</p>`
    }`;
}

function buildHtml(documentTitle: string, result: MaterialsByPhaseResult): string {
  const generatedAt = new Date().toLocaleString("pt-MZ");
  const phasesHtml = result.phases.map((p) => renderPhase(p, result.currency)).join("");

  return `<!doctype html>
<html lang="pt">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #1e1b4b; margin: 24px; }
  h1 { font-size: 16px; margin: 0 0 4px; }
  .meta { color: #6b7280; font-size: 11px; margin-bottom: 12px; }
  .grand-total { font-size: 13px; font-weight: bold; color: #312e81; margin-bottom: 18px; }
  h2 { font-size: 13px; margin: 20px 0 6px; color: #312e81; page-break-after: avoid; display: flex; justify-content: space-between; }
  .phase-total { font-size: 12px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  th, td { border-bottom: 1px solid #e5e7eb; padding: 4px 6px; text-align: left; }
  th { background: #eef2ff; font-size: 10px; }
  td.num, th.num { text-align: right; }
  .empty { color: #9ca3af; font-style: italic; margin: 4px 0 0; }
  .manual-row { color: #92400e; font-style: italic; }
</style>
</head>
<body>
  <h1>Materiais por Fase — ${escapeHtml(documentTitle)}</h1>
  <div class="meta">SIGA · gerado em ${generatedAt}</div>
  <div class="grand-total">Valor total dos materiais: ${money(result.grandTotal, result.currency)}</div>
  ${phasesHtml || `<p class="empty">Nenhum item medido ainda — sem materiais a listar.</p>`}
</body>
</html>`;
}

export async function buildMaterialsByPhasePdf(documentTitle: string, result: MaterialsByPhaseResult): Promise<Buffer> {
  const browser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(buildHtml(documentTitle, result), { waitUntil: "networkidle0" });
    const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "15mm", bottom: "15mm", left: "12mm", right: "12mm" } });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

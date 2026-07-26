import puppeteer from "puppeteer";
import type { siteDiaryEntries, projects } from "../db/schema.js";

type SiteDiaryEntry = typeof siteDiaryEntries.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;

function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function field(label: string, value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  return `<div class="field"><span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(String(value))}</span></div>`;
}

function buildHtml(entry: SiteDiaryEntry, project: ProjectRow): string {
  const generatedAt = new Date().toLocaleString("pt-MZ");
  return `<!doctype html>
<html lang="pt">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #1e1b4b; margin: 28px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { color: #6b7280; font-size: 11px; margin-bottom: 18px; }
  h2 { font-size: 13px; margin: 18px 0 8px; color: #312e81; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
  .field { margin-bottom: 6px; }
  .field .label { font-weight: bold; margin-right: 6px; }
  .field .value { white-space: pre-wrap; }
  .grid { display: flex; gap: 24px; flex-wrap: wrap; }
  .grid .field { min-width: 160px; }
</style>
</head>
<body>
  <h1>Diário de Obra — ${escapeHtml(project.name)}</h1>
  <div class="meta">SIGO · Registo de ${escapeHtml(entry.date)} · gerado em ${generatedAt}</div>

  <h2>Condições do dia</h2>
  <div class="grid">
    ${field("Condições meteorológicas", entry.weather)}
    ${field("Trabalhadores presentes", entry.workersPresent)}
    ${field("Hora de entrada", entry.entryTime)}
    ${field("Hora de saída", entry.exitTime)}
  </div>
  ${field("Equipamentos presentes", entry.equipmentPresent)}

  <h2>Trabalhos executados</h2>
  ${field("", entry.workDone)}

  <h2>Materiais</h2>
  ${field("Recebidos", entry.materialsReceived)}
  ${field("Consumidos", entry.materialsConsumed)}

  <h2>Ocorrências</h2>
  ${field("Visitas", entry.visitors)}
  ${field("Instruções do fiscal", entry.inspectorInstructions)}
  ${field("Acidentes / interrupções / problemas", entry.incidents)}
  ${field("Decisões tomadas", entry.decisions)}

  ${entry.photoUrls.length ? `<h2>Fotografias anexadas</h2><div class="field">${entry.photoUrls.length} fotografia(s) — consultar no sistema</div>` : ""}
</body>
</html>`;
}

export async function buildSiteDiaryPdf(entry: SiteDiaryEntry, project: ProjectRow): Promise<Buffer> {
  const browser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(buildHtml(entry, project), { waitUntil: "networkidle0" });
    const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "15mm", bottom: "15mm", left: "15mm", right: "15mm" } });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

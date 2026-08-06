import puppeteer from "puppeteer";
import type { siteDiaryEntries, projects } from "../db/schema.js";
import type { CompanyBrand } from "./companyBrand.js";
import { escapeHtml, pdfChromeStyles, pdfFooterHtml, pdfLetterheadHtml } from "./documentChrome.js";

type SiteDiaryEntry = typeof siteDiaryEntries.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;

function field(label: string, value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  return `<div class="field"><span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(String(value))}</span></div>`;
}

type DiaryLinks = {
  progress: Array<{ code: string; name: string; progressPercent: number; notes: string | null }>;
  consumptions: Array<{ name: string; quantity: number; unit: string; notes: string | null }>;
};

function buildHtml(entry: SiteDiaryEntry, project: ProjectRow, brand: CompanyBrand, links?: DiaryLinks): string {
  const accent = brand.primaryColor || "#ED6C22";
  const generatedAt = new Date().toLocaleString("pt-MZ");
  return `<!doctype html>
<html lang="pt">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #14213d; margin: 24px; }
  .field { margin-bottom: 6px; }
  .field .label { font-weight: bold; margin-right: 6px; }
  .field .value { white-space: pre-wrap; }
  .grid { display: flex; gap: 24px; flex-wrap: wrap; }
  .grid .field { min-width: 160px; }
  ${pdfChromeStyles(accent)}
</style>
</head>
<body>
  ${pdfLetterheadHtml(brand, {
    title: "Diário de Obra",
    subtitle: `${project.name} · ${entry.date}`,
    metaRight: `Gerado em ${generatedAt}`,
  })}

  <h2 class="doc-section">Condições do dia</h2>
  <div class="grid">
    ${field("Condições meteorológicas", entry.weather)}
    ${field("Trabalhadores presentes", entry.workersPresent)}
    ${field("Hora de entrada", entry.entryTime)}
    ${field("Hora de saída", entry.exitTime)}
  </div>
  ${field("Equipamentos presentes", entry.equipmentPresent)}

  <h2 class="doc-section">Trabalhos executados</h2>
  ${field("", entry.workDone)}
  ${links?.progress.length ? `<div class="field"><span class="label">Progresso do cronograma</span>${links.progress.map((item) => `<div class="value">${escapeHtml(item.code)} · ${escapeHtml(item.name)} — <strong>${item.progressPercent.toFixed(2)}%</strong>${item.notes ? ` · ${escapeHtml(item.notes)}` : ""}</div>`).join("")}</div>` : ""}

  <h2 class="doc-section">Materiais</h2>
  ${field("Recebidos", entry.materialsReceived)}
  ${field("Consumidos", entry.materialsConsumed)}
  ${links?.consumptions.length ? `<div class="field"><span class="label">Saídas de stock ligadas ao registo</span>${links.consumptions.map((item) => `<div class="value">${escapeHtml(item.name)} — <strong>${item.quantity.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${escapeHtml(item.unit)}</strong></div>`).join("")}</div>` : ""}

  <h2 class="doc-section">Ocorrências</h2>
  ${field("Visitas", entry.visitors)}
  ${field("Instruções do fiscal", entry.inspectorInstructions)}
  ${field("Acidentes / interrupções / problemas", entry.incidents)}
  ${field("Decisões tomadas", entry.decisions)}

  ${entry.photoUrls.length ? `<h2 class="doc-section">Fotografias anexadas</h2><div class="field">${entry.photoUrls.length} fotografia(s) — consultar no sistema</div>` : ""}
  ${pdfFooterHtml(brand, "Diário de obra")}
</body>
</html>`;
}

export async function buildSiteDiaryPdf(
  entry: SiteDiaryEntry,
  project: ProjectRow,
  links?: DiaryLinks,
  brand?: CompanyBrand,
): Promise<Buffer> {
  const resolvedBrand =
    brand ??
    ({
      name: "Empresa",
      brandName: null,
      logoUrl: null,
      nuit: null,
      address: null,
      phone: null,
      email: null,
      website: null,
      bankDetails: null,
      documentFooter: null,
      primaryColor: "#ED6C22",
    } satisfies CompanyBrand);
  const browser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(buildHtml(entry, project, resolvedBrand, links), { waitUntil: "networkidle0" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "14mm", bottom: "16mm", left: "14mm", right: "14mm" },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

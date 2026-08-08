import puppeteer from "puppeteer";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { measurementCertificateFieldLines, projects } from "../db/schema.js";
import { loadCompanyBrand, type CompanyBrand } from "./companyBrand.js";
import { escapeHtml, pdfChromeStyles, pdfFooterHtml, pdfLetterheadHtml } from "./documentChrome.js";
import { calculateMeasurementPartial, type MeasurementFormulaType } from "./measurementFormulaEngine.js";
import { getCertificateDetail } from "./measurementEngine.js";

function qty(value: number) {
  return value.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function location(row: {
  block: string | null;
  floor: string | null;
  zone: string | null;
  room: string | null;
  axis: string | null;
  element: string | null;
}) {
  return [row.block, row.floor, row.zone, row.room, row.axis, row.element].filter(Boolean).join(" / ") || "—";
}

function formulaLabel(type: string) {
  const labels: Record<string, string> = {
    legacy_product: "Legado",
    direct: "Qtd. directa",
    count: "Contagem",
    length: "Comprimento",
    area: "Área",
    wall_area: "Área vertical",
    perimeter: "Perímetro",
    volume: "Volume",
    section_length: "Secção × comp.",
    weight: "Peso",
    reinforcement: "Aço",
    percentage: "% de base",
  };
  return labels[type] ?? type;
}

export async function buildCertificateFieldMeasurementPdf(certificateId: string, companyId: string): Promise<{ buffer: Buffer; filename: string } | null> {
  const detail = await getCertificateDetail(certificateId);
  if (!detail) return null;

  const [project] = await db
    .select({ name: projects.name, client: projects.client })
    .from(projects)
    .where(eq(projects.id, detail.certificate.projectId))
    .limit(1);
  const brand = await loadCompanyBrand(companyId);
  const lineIds = detail.lines.map((line) => line.id);
  const fieldRows = lineIds.length
    ? await db
        .select()
        .from(measurementCertificateFieldLines)
        .where(and(
          inArray(measurementCertificateFieldLines.certificateLineId, lineIds),
          eq(measurementCertificateFieldLines.isActive, true),
        ))
        .orderBy(measurementCertificateFieldLines.sortOrder, measurementCertificateFieldLines.createdAt)
    : [];

  const fieldsByLine = new Map<string, typeof fieldRows>();
  for (const row of fieldRows) {
    const list = fieldsByLine.get(row.certificateLineId) ?? [];
    list.push(row);
    fieldsByLine.set(row.certificateLineId, list);
  }

  const sectionsHtml = detail.lines
    .filter((line) => (fieldsByLine.get(line.id)?.length ?? 0) > 0 || line.periodQty > 0)
    .map((line) => {
      const fields = fieldsByLine.get(line.id) ?? [];
      const fieldRowsHtml = fields.length
        ? fields.map((row) => {
            const calc = calculateMeasurementPartial({
              formulaType: row.formulaType as MeasurementFormulaType,
              sign: Number(row.sign),
              count: Number(row.count),
              length: row.length == null ? null : Number(row.length),
              width: row.width == null ? null : Number(row.width),
              height: row.height == null ? null : Number(row.height),
              directQuantity: row.directQuantity == null ? null : Number(row.directQuantity),
              coefficient: Number(row.coefficient ?? 1),
              unitWeight: row.unitWeight == null ? null : Number(row.unitWeight),
              diameterMm: row.diameterMm == null ? null : Number(row.diameterMm),
              baseQuantity: row.baseQuantity == null ? null : Number(row.baseQuantity),
              percentage: row.percentage == null ? null : Number(row.percentage),
            });
            const evidence = Array.isArray(row.evidenceUrls) ? row.evidenceUrls.filter(Boolean) : [];
            return `<tr class="${Number(row.sign) < 0 ? "deduction" : ""}">
              <td>${escapeHtml(row.description || formulaLabel(row.formulaType))}</td>
              <td>${escapeHtml(location(row))}</td>
              <td>${escapeHtml(formulaLabel(row.formulaType))}${Number(row.sign) < 0 ? " · dedução" : ""}</td>
              <td class="expr">${escapeHtml(calc.expression)}</td>
              <td class="num">${qty(calc.partial)}</td>
              <td>${evidence.length ? escapeHtml(evidence.join("; ")) : "—"}</td>
            </tr>`;
          }).join("")
        : `<tr class="empty"><td colspan="6">Sem memória de campo — quantidade do período introduzida directamente.</td></tr>`;

      return `
        <section class="item-block">
          <header>
            <div>
              <strong>${escapeHtml(line.code ?? "—")} · ${escapeHtml(line.description)}</strong>
              <div class="meta">${escapeHtml(line.sectionName)} · ${escapeHtml(line.unit ?? "")}</div>
            </div>
            <div class="totals">
              <div>Período: <strong>${qty(line.periodQty)} ${escapeHtml(line.unit ?? "")}</strong></div>
              <div>Acumulado: <strong>${qty(line.cumulativeQty)}</strong></div>
            </div>
          </header>
          <table>
            <thead>
              <tr>
                <th>Descrição</th><th>Localização</th><th>Fórmula</th><th>Expressão</th><th>Parcial</th><th>Evidências</th>
              </tr>
            </thead>
            <tbody>${fieldRowsHtml}</tbody>
          </table>
        </section>`;
    })
    .join("");

  const periodLabel = [
    detail.certificate.periodStartDate ? `${detail.certificate.periodStartDate} —` : "Até",
    detail.certificate.periodDate,
  ].join(" ");

  const html = buildHtml({
    brand,
    projectName: project?.name ?? "Obra",
    clientName: project?.client,
    certificateNumber: detail.certificate.number,
    status: detail.certificate.status,
    periodLabel,
    notes: detail.certificate.notes,
    body: sectionsHtml || `<p class="empty-doc">Este auto ainda não tem linhas com quantidade ou memória de campo.</p>`,
  });

  const browser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "12mm", bottom: "14mm", left: "10mm", right: "10mm" },
    });
    const safeProject = (project?.name ?? "obra").replace(/[^\p{L}\p{N}\- ]/gu, "").trim() || "obra";
    return {
      buffer: Buffer.from(pdf),
      filename: `Folha-medicao-campo-Auto-${detail.certificate.number}-${safeProject}.pdf`,
    };
  } finally {
    await browser.close();
  }
}

function buildHtml(args: {
  brand: CompanyBrand;
  projectName: string;
  clientName: string | null | undefined;
  certificateNumber: number;
  status: string;
  periodLabel: string;
  notes: string | null;
  body: string;
}) {
  const accent = args.brand.primaryColor || "#ED6C22";
  const subtitle = [
    `Auto n.º ${args.certificateNumber}`,
    args.periodLabel,
    args.status,
    args.clientName ? `Cliente ${args.clientName}` : null,
  ].filter(Boolean).join(" · ");

  return `<!doctype html>
<html lang="pt">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10.5px; color: #14213d; margin: 18px; }
  .item-block { margin: 0 0 14px; break-inside: avoid; }
  .item-block header { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 6px; padding-bottom: 4px; border-bottom: 1px solid #dbe3ee; }
  .item-block .meta { color: #64748b; margin-top: 2px; }
  .item-block .totals { text-align: right; white-space: nowrap; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 2px; }
  thead { display: table-header-group; }
  th, td { border-bottom: 1px solid #e5e7eb; padding: 4px 5px; text-align: left; vertical-align: top; }
  th { font-size: 9px; text-transform: uppercase; letter-spacing: .04em; color: #64748b; background: #f8fafc; }
  .num { text-align: right; font-variant-numeric: tabular-nums; font-weight: 700; }
  .expr { font-family: Consolas, monospace; font-size: 9.5px; color: #334155; }
  .deduction td { color: #b42318; }
  .empty td, .empty-doc { color: #64748b; font-style: italic; }
  .notes { margin-top: 16px; padding: 10px; background: #f8fafc; border-radius: 8px; }
  ${pdfChromeStyles(accent)}
</style>
</head>
<body>
  ${pdfLetterheadHtml(args.brand, {
    title: "Folha de medição de campo",
    subtitle: `${args.projectName} · ${subtitle}`,
  })}
  ${args.body}
  ${args.notes ? `<div class="notes"><strong>Notas do auto</strong><div>${escapeHtml(args.notes)}</div></div>` : ""}
  ${pdfFooterHtml(args.brand, "Folha de medição de campo · Auto de Medição")}
</body>
</html>`;
}

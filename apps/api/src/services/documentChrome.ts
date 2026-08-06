/**
 * Identidade visual partilhada para todos os documentos exportados (PDF + Excel).
 * Usa os dados da empresa em sessão — nunca a marca genérica «SIGO» como remetente.
 */
import ExcelJS from "exceljs";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { env } from "../env.js";
import { logoDataUri, type CompanyBrand } from "./companyBrand.js";

export function brandDisplayName(brand: CompanyBrand): string {
  return (brand.brandName?.trim() || brand.name?.trim() || "Empresa").slice(0, 200);
}

export function brandMetaParts(brand: CompanyBrand): string[] {
  return [
    brand.nuit ? `NUIT ${brand.nuit}` : null,
    brand.address,
    brand.phone,
    brand.email,
    brand.website ?? null,
  ].filter((v): v is string => Boolean(v && String(v).trim()));
}

export function brandMetaLine(brand: CompanyBrand): string {
  return brandMetaParts(brand).join(" · ");
}

export function brandFooterText(brand: CompanyBrand, context?: string): string {
  const base = brand.documentFooter?.trim() || `Documento emitido por ${brandDisplayName(brand)}`;
  return context ? `${base} · ${context}` : base;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function resolveLogoPath(logoUrl: string | null): string | null {
  if (!logoUrl) return null;
  const cleaned = logoUrl.split("?")[0];
  const candidates = [
    cleaned.startsWith("/uploads/logos/") ? path.resolve(env.uploadsDir, "logos", path.basename(cleaned)) : null,
    cleaned.startsWith("uploads/logos/") ? path.resolve(env.uploadsDir, "logos", path.basename(cleaned)) : null,
    path.isAbsolute(cleaned) ? cleaned : null,
    path.resolve(env.uploadsDir, "logos", path.basename(cleaned)),
  ].filter(Boolean) as string[];
  return candidates.find((p) => existsSync(p)) ?? null;
}

export function logoFileForExcel(logoUrl: string | null): { buffer: Buffer; extension: "png" | "jpeg" | "gif" } | null {
  const filePath = resolveLogoPath(logoUrl);
  if (!filePath) return null;
  try {
    const buffer = readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const extension = ext === ".png" ? "png" : ext === ".gif" ? "gif" : "jpeg";
    return { buffer, extension };
  } catch {
    return null;
  }
}

/** CSS partilhado do cabeçalho/rodapé PDF (cores da empresa). */
export function pdfChromeStyles(accent: string): string {
  const color = escapeHtml(accent || "#ED6C22");
  return `
  .doc-top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;border-bottom:3px solid ${color};padding-bottom:14px;margin-bottom:16px}
  .doc-brand{display:flex;align-items:center;gap:12px;min-width:0}
  .doc-logo{max-height:52px;max-width:140px;object-fit:contain}
  .doc-brand-name{font-weight:800;font-size:18px;letter-spacing:.2px;color:#14213d;line-height:1.2}
  .doc-brand-meta{color:#667085;margin-top:4px;font-size:10px;line-height:1.45}
  .doc-title-block{text-align:right;flex-shrink:0}
  .doc-title{font-size:20px;font-weight:800;color:${color};letter-spacing:.3px;margin:0}
  .doc-subtitle{color:#667085;margin-top:4px;font-size:11px}
  .doc-foot{margin-top:28px;padding-top:10px;border-top:1px solid #e5e7eb;font-size:9px;color:#667085;line-height:1.45}
  h2.doc-section{font-size:13px;margin:18px 0 8px;color:${color};border-bottom:1px solid #e5e7eb;padding-bottom:4px}
  th.doc-th{background:${color}14 !important}
  .doc-accent{color:${color}}
  `;
}

export function pdfLetterheadHtml(
  brand: CompanyBrand,
  opts: { title: string; subtitle?: string | null; metaRight?: string | null },
): string {
  const logo = logoDataUri(brand.logoUrl);
  const meta = brandMetaLine(brand);
  return `<div class="doc-top">
  <div class="doc-brand">
    ${logo ? `<img class="doc-logo" src="${logo}" alt=""/>` : ""}
    <div>
      <div class="doc-brand-name">${escapeHtml(brandDisplayName(brand))}</div>
      ${meta ? `<div class="doc-brand-meta">${escapeHtml(meta)}</div>` : ""}
    </div>
  </div>
  <div class="doc-title-block">
    <div class="doc-title">${escapeHtml(opts.title)}</div>
    ${opts.subtitle ? `<div class="doc-subtitle">${escapeHtml(opts.subtitle)}</div>` : ""}
    ${opts.metaRight ? `<div class="doc-subtitle">${escapeHtml(opts.metaRight)}</div>` : ""}
  </div>
</div>`;
}

export function pdfFooterHtml(brand: CompanyBrand, context?: string): string {
  return `<div class="doc-foot">${escapeHtml(brandFooterText(brand, context))}</div>`;
}

export type ExcelLetterheadOptions = {
  documentTitle: string;
  documentSubtitle?: string | null;
  revision?: string | null;
  fileNumber?: string | null;
  /** Colunas da tabela a partir da linha de cabeçalho (opcional). */
  columnHeaders?: string[];
  columnWidths?: number[];
};

/**
 * Escreve o bloco de identidade da empresa no topo da folha.
 * Devolve o índice da primeira linha livre para conteúdo (ou da linha seguinte aos headers de coluna).
 */
export async function applyExcelLetterhead(
  workbook: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet,
  brand: CompanyBrand,
  opts: ExcelLetterheadOptions,
): Promise<number> {
  const accent = (brand.primaryColor || "#ED6C22").replace("#", "").toUpperCase();
  const accentArgb = accent.length === 6 ? `FF${accent}` : "FFED6C22";
  const name = brandDisplayName(brand);
  const meta = brandMetaLine(brand);
  const logo = logoFileForExcel(brand.logoUrl);

  let contentStart = 1;

  if (logo) {
    const imageId = workbook.addImage({ buffer: logo.buffer as unknown as ExcelJS.Buffer, extension: logo.extension });
    ws.addImage(imageId, {
      tl: { col: 0, row: 0 },
      ext: { width: 96, height: 48 },
    });
    ws.getRow(1).height = 42;
    ws.getCell("B1").value = name;
    ws.getCell("B1").font = { bold: true, size: 14, color: { argb: "FF14213D" } };
    if (meta) {
      ws.getCell("B2").value = meta;
      ws.getCell("B2").font = { size: 9, color: { argb: "FF667085" } };
    }
    contentStart = 3;
  } else {
    ws.getCell("A1").value = name;
    ws.getCell("A1").font = { bold: true, size: 14, color: { argb: "FF14213D" } };
    if (meta) {
      ws.getCell("A2").value = meta;
      ws.getCell("A2").font = { size: 9, color: { argb: "FF667085" } };
      contentStart = 3;
    } else {
      contentStart = 2;
    }
  }

  const titleRow = contentStart;
  ws.getCell(`A${titleRow}`).value = opts.documentTitle;
  ws.getCell(`A${titleRow}`).font = { bold: true, size: 12, color: { argb: accentArgb } };
  let row = titleRow + 1;

  if (opts.documentSubtitle) {
    ws.getCell(`A${row}`).value = opts.documentSubtitle;
    ws.getCell(`A${row}`).font = { size: 10, color: { argb: "FF475569" } };
    row++;
  }

  if (opts.revision || opts.fileNumber) {
    const bits = [
      opts.revision ? `Revisão ${opts.revision}` : null,
      opts.fileNumber ? `Nº ${opts.fileNumber}` : null,
    ].filter(Boolean);
    ws.getCell(`A${row}`).value = bits.join(" · ");
    ws.getCell(`A${row}`).font = { size: 9, color: { argb: "FF64748B" } };
    row++;
  }

  // Linha de destaque com a cor da empresa
  const rule = ws.getRow(row);
  for (let c = 1; c <= Math.max(opts.columnHeaders?.length ?? 6, 4); c++) {
    rule.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: accentArgb } };
  }
  rule.height = 4;
  row += 2;

  if (opts.columnWidths?.length) {
    ws.columns = opts.columnWidths.map((width) => ({ width }));
  }

  if (opts.columnHeaders?.length) {
    const headerRow = ws.getRow(row);
    headerRow.values = opts.columnHeaders;
    headerRow.font = { bold: true, color: { argb: "FF14213D" } };
    headerRow.eachCell((cell) => {
      cell.border = { bottom: { style: "thin", color: { argb: accentArgb } } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
    });
    row++;
  }

  // Rodapé da folha (rodapé Excel)
  ws.headerFooter.oddFooter = `&L${brandFooterText(brand)}&R&D`;

  return row;
}

import ExcelJS from "exceljs";
import type { BudgetDocumentSummary, LineItemNode, SectionNode } from "./boqEngine.js";
import type { CompanyBrand } from "./companyBrand.js";
import { applyExcelLetterhead } from "./documentChrome.js";

const COLUMNS = ["ITEM", "DESCRIÇÃO", "UN", "QUANT.", "PREÇO UNITÁRIO", "PREÇO TOTAL"];
const COLUMN_WIDTHS = [10, 55, 8, 12, 16, 16];

// Protecção extra (não é a "CSV injection" clássica — o ExcelJS já grava strings como texto
// puro, tipo "s", que o Excel não reinterpreta como fórmula ao abrir; confirmado a inspeccionar
// o XML gerado) mas continua a ser boa prática não deixar texto livre do utilizador começar por
// um caractere que ferramentas/versões antigas do Excel possam tratar como início de fórmula.
export function sanitizeExcelText(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function sanitizeSheetName(name: string, usedNames: Set<string>): string {
  let base = name.replace(/[[\]*?/\\:]/g, "").slice(0, 31) || "Secção";
  let candidate = base;
  let i = 2;
  while (usedNames.has(candidate.toUpperCase())) {
    candidate = `${base.slice(0, 28)} ${i}`;
    i++;
  }
  usedNames.add(candidate.toUpperCase());
  return candidate;
}

function writeNode(ws: ExcelJS.Worksheet, node: LineItemNode, row: number, depth: number): number {
  const r = ws.getRow(row);
  r.getCell(1).value = node.code ?? null;
  r.getCell(2).value = sanitizeExcelText(node.description);
  r.getCell(2).alignment = { indent: depth };

  if (node.kind === "item") {
    r.getCell(3).value = node.unit ?? "";
    r.getCell(4).value = node.quantity ?? 0;
    r.getCell(5).value = node.sellingUnitPrice ?? node.unitPrice ?? 0;
    r.getCell(6).value = { formula: `D${row}*E${row}` } as ExcelJS.CellFormulaValue;
    r.getCell(4).numFmt = "#,##0.00";
    r.getCell(5).numFmt = "#,##0.00";
    r.getCell(6).numFmt = "#,##0.00";
  }
  if (node.kind === "capitulo" || node.kind === "grupo") {
    r.font = { bold: true };
  }
  if (node.kind === "nota") {
    r.font = { italic: true };
  }

  let nextRow = row + 1;
  for (const child of node.children) {
    nextRow = writeNode(ws, child, nextRow, depth + 1);
  }
  return nextRow;
}

async function writeSectionSheet(
  workbook: ExcelJS.Workbook,
  section: SectionNode,
  doc: BudgetDocumentSummary["document"],
  brand: CompanyBrand,
  usedNames: Set<string>,
) {
  const ws = workbook.addWorksheet(sanitizeSheetName(section.name, usedNames));
  let row = await applyExcelLetterhead(workbook, ws, brand, {
    documentTitle: doc.title,
    documentSubtitle: section.name.toUpperCase(),
    revision: doc.revision,
    fileNumber: doc.fileNumber,
    columnHeaders: COLUMNS,
    columnWidths: COLUMN_WIDTHS,
  });

  const chapterTotalCells: string[] = [];
  for (const topNode of section.items) {
    const startRow = row;
    row = writeNode(ws, topNode, row, 0);
    const endRow = row - 1;
    if (topNode.kind === "capitulo" && endRow > startRow) {
      const subtotalRow = ws.getRow(row);
      subtotalRow.getCell(2).value = `SUB-TOTAL ${topNode.code ?? ""}`.trim();
      subtotalRow.getCell(6).value = { formula: `SUM(F${startRow + 1}:F${endRow})` } as ExcelJS.CellFormulaValue;
      subtotalRow.getCell(6).numFmt = "#,##0.00";
      subtotalRow.font = { bold: true };
      chapterTotalCells.push(`F${row}`);
      row++;
    }
  }

  row++;
  const totalRow = ws.getRow(row);
  totalRow.getCell(2).value = `TOTAL ${section.name.toUpperCase()}`;
  totalRow.getCell(6).value = chapterTotalCells.length
    ? ({ formula: chapterTotalCells.join("+") } as ExcelJS.CellFormulaValue)
    : 0;
  totalRow.getCell(6).numFmt = "#,##0.00";
  totalRow.font = { bold: true };
  totalRow.eachCell((cell) => (cell.border = { top: { style: "thin" } }));

  return { sheetName: ws.name, totalRow: row };
}

export async function buildBudgetDocumentExcel(
  summary: BudgetDocumentSummary,
  brand: CompanyBrand,
): Promise<ExcelJS.Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = brandDisplaySafe(brand);
  workbook.company = brandDisplaySafe(brand);
  const usedNames = new Set<string>(["RESUMO"]);

  const resumo = workbook.addWorksheet("RESUMO");
  let row = await applyExcelLetterhead(workbook, resumo, brand, {
    documentTitle: summary.document.title,
    documentSubtitle: "RESUMO GERAL",
    revision: summary.document.revision,
    fileNumber: summary.document.fileNumber,
    columnHeaders: COLUMNS,
    columnWidths: COLUMN_WIDTHS,
  });

  const sectionRefs: { row: number }[] = [];
  for (const section of summary.sections) {
    const { sheetName, totalRow } = await writeSectionSheet(workbook, section, summary.document, brand, usedNames);
    const r = resumo.getRow(row);
    r.getCell(2).value = section.name;
    r.getCell(3).value = "un";
    r.getCell(4).value = 1;
    r.getCell(5).value = { formula: `'${sheetName}'!F${totalRow}` } as ExcelJS.CellFormulaValue;
    r.getCell(6).value = { formula: `D${row}*E${row}` } as ExcelJS.CellFormulaValue;
    r.getCell(5).numFmt = "#,##0.00";
    r.getCell(6).numFmt = "#,##0.00";
    sectionRefs.push({ row });
    row++;
  }

  const subtotal1Row = row;
  resumo.getRow(row).getCell(2).value = "Subtotal";
  resumo.getRow(row).getCell(6).value = sectionRefs.length
    ? ({ formula: `SUM(F${sectionRefs[0].row}:F${sectionRefs[sectionRefs.length - 1].row})` } as ExcelJS.CellFormulaValue)
    : 0;
  resumo.getRow(row).getCell(6).numFmt = "#,##0.00";
  resumo.getRow(row).font = { bold: true };
  row++;

  const contingRow = row;
  resumo.getRow(row).getCell(2).value = "Contingências";
  resumo.getRow(row).getCell(4).value = Number(summary.document.contingenciasRate);
  resumo.getRow(row).getCell(4).numFmt = "0.00%";
  resumo.getRow(row).getCell(6).value = { formula: `D${row}*F${subtotal1Row}` } as ExcelJS.CellFormulaValue;
  resumo.getRow(row).getCell(6).numFmt = "#,##0.00";
  row++;

  const subtotal2Row = row;
  resumo.getRow(row).getCell(2).value = "Base tributável";
  resumo.getRow(row).getCell(6).value = { formula: `F${subtotal1Row}+F${contingRow}` } as ExcelJS.CellFormulaValue;
  resumo.getRow(row).getCell(6).numFmt = "#,##0.00";
  resumo.getRow(row).font = { bold: true };
  row++;

  const ivaRow = row;
  resumo.getRow(row).getCell(2).value = "IVA";
  resumo.getRow(row).getCell(4).value = Number(summary.document.ivaRate);
  resumo.getRow(row).getCell(4).numFmt = "0.00%";
  resumo.getRow(row).getCell(6).value = { formula: `D${row}*F${subtotal2Row}` } as ExcelJS.CellFormulaValue;
  resumo.getRow(row).getCell(6).numFmt = "#,##0.00";
  row++;

  row++;
  resumo.getRow(row).getCell(2).value = "VALOR TOTAL";
  resumo.getRow(row).getCell(6).value = { formula: `F${subtotal2Row}+F${ivaRow}` } as ExcelJS.CellFormulaValue;
  resumo.getRow(row).getCell(6).numFmt = "#,##0.00";
  resumo.getRow(row).font = { bold: true };

  await writeMeasurementsSheet(workbook, summary, brand);

  return workbook.xlsx.writeBuffer();
}

function brandDisplaySafe(brand: CompanyBrand) {
  return brand.brandName?.trim() || brand.name?.trim() || "Empresa";
}

export async function buildMeasurementDocumentExcel(
  summary: BudgetDocumentSummary,
  brand: CompanyBrand,
): Promise<ExcelJS.Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = brandDisplaySafe(brand);
  workbook.company = brandDisplaySafe(brand);
  const ws = workbook.addWorksheet("QUANTIDADES");
  let row = await applyExcelLetterhead(workbook, ws, brand, {
    documentTitle: "MAPA DE MEDIÇÕES E QUANTIDADES",
    documentSubtitle: summary.document.title,
    revision: summary.document.revision,
    fileNumber: summary.document.fileNumber,
    columnHeaders: ["ITEM", "DESCRIÇÃO", "UN", "QUANTIDADE"],
    columnWidths: [12, 65, 10, 16],
  });

  const writeQuantityNode = (node: LineItemNode, depth: number) => {
    const current = ws.getRow(row++);
    current.getCell(1).value = node.code ?? "";
    current.getCell(2).value = sanitizeExcelText(node.description);
    current.getCell(2).alignment = { indent: depth };
    if (node.kind === "item") {
      current.getCell(3).value = node.unit ?? "";
      current.getCell(4).value = node.quantity ?? 0;
      current.getCell(4).numFmt = "#,##0.00";
    } else if (node.kind === "capitulo" || node.kind === "grupo") {
      current.font = { bold: true };
    }
    node.children.forEach((child) => writeQuantityNode(child, depth + 1));
  };

  for (const section of summary.sections) {
    const sectionRow = ws.getRow(row++);
    sectionRow.getCell(2).value = sanitizeExcelText(section.name.toUpperCase());
    sectionRow.font = { bold: true };
    section.items.forEach((node) => writeQuantityNode(node, 0));
    row++;
  }

  await writeMeasurementsSheet(workbook, summary, brand);
  return workbook.xlsx.writeBuffer();
}

/** Folha MEDIÇÕES: Nº × Comp. × Larg. × Alt. = Parcial, com fórmulas Excel. */
async function writeMeasurementsSheet(
  workbook: ExcelJS.Workbook,
  summary: BudgetDocumentSummary,
  brand: CompanyBrand,
) {
  const { getMeasurementLines } = await import("./dimensionEngine.js");

  type ItemWithSection = { sectionName: string; node: LineItemNode };
  const items: ItemWithSection[] = [];
  function collect(sectionName: string, nodes: LineItemNode[]) {
    for (const node of nodes) {
      if (node.kind === "item") items.push({ sectionName, node });
      collect(sectionName, node.children);
    }
  }
  for (const section of summary.sections) collect(section.name, section.items);

  const itemLines = await Promise.all(items.map(async (i) => ({ ...i, lines: await getMeasurementLines(i.node.id) })));
  const withMeasurements = itemLines.filter((i) => i.lines.length > 0);
  if (withMeasurements.length === 0) return;

  const ws = workbook.addWorksheet("MEDIÇÕES");
  let row = await applyExcelLetterhead(workbook, ws, brand, {
    documentTitle: "MAPA DE MEDIÇÕES",
    documentSubtitle: summary.document.title,
    revision: summary.document.revision,
    fileNumber: summary.document.fileNumber,
    columnHeaders: ["ITEM", "DESCRIÇÃO", "Nº", "COMP. (m)", "LARG. (m)", "ALT. (m)", "PARCIAL"],
    columnWidths: [10, 45, 8, 10, 10, 10, 12],
  });

  let currentSection = "";
  for (const item of withMeasurements) {
    if (item.sectionName !== currentSection) {
      currentSection = item.sectionName;
      const r = ws.getRow(row);
      r.getCell(2).value = sanitizeExcelText(currentSection.toUpperCase());
      r.font = { bold: true };
      row++;
    }

    const itemRow = ws.getRow(row);
    itemRow.getCell(1).value = item.node.code ?? "";
    itemRow.getCell(2).value = sanitizeExcelText(item.node.description);
    itemRow.font = { bold: true };
    row++;

    const firstLineRow = row;
    for (const line of item.lines) {
      const r = ws.getRow(row);
      r.getCell(2).value = line.description ? sanitizeExcelText(`   ${line.description}`) : "";
      r.getCell(3).value = Number(line.count);
      r.getCell(3).numFmt = "#,##0.00";
      if (line.length !== null) r.getCell(4).value = Number(line.length);
      if (line.width !== null) r.getCell(5).value = Number(line.width);
      if (line.height !== null) r.getCell(6).value = Number(line.height);
      for (const column of [4, 5, 6, 7]) r.getCell(column).numFmt = "#,##0.00";
      r.getCell(7).value = {
        formula: `C${row}*IF(D${row}="",1,D${row})*IF(E${row}="",1,E${row})*IF(F${row}="",1,F${row})`,
      } as ExcelJS.CellFormulaValue;
      row++;
    }

    const totalRow = ws.getRow(row);
    totalRow.getCell(2).value = `   Total (${item.node.unit ?? ""})`;
    totalRow.getCell(7).value = { formula: `SUM(G${firstLineRow}:G${row - 1})` } as ExcelJS.CellFormulaValue;
    totalRow.getCell(7).numFmt = "#,##0.00";
    totalRow.font = { bold: true };
    totalRow.eachCell((cell) => (cell.border = { top: { style: "thin" } }));
    row += 2;
  }
}

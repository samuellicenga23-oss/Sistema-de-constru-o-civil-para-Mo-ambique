import ExcelJS from "exceljs";
import type { BudgetDocumentSummary, LineItemNode, SectionNode } from "./boqEngine.js";

const COLUMNS = ["ITEM", "DESCRIÇÃO", "UN", "QUANT.", "PREÇO UNITÁRIO", "PREÇO TOTAL"];

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

function writeHeaderBlock(ws: ExcelJS.Worksheet, title: string, subtitle: string, revision: string | null, fileNumber: string | null) {
  ws.getCell("A1").value = "TÍTULO";
  ws.getCell("A2").value = sanitizeExcelText(title);
  ws.getCell("A3").value = sanitizeExcelText(subtitle);
  ws.getCell("D1").value = "REVISÃO";
  ws.getCell("E1").value = revision ?? "";
  ws.getCell("D2").value = "NO. FICHEIRO";
  ws.getCell("E2").value = fileNumber ?? "";
  ws.getRow(1).font = { bold: true };
  ws.getRow(2).font = { bold: true };

  const headerRowIndex = 5;
  const headerRow = ws.getRow(headerRowIndex);
  headerRow.values = COLUMNS;
  headerRow.font = { bold: true };
  headerRow.eachCell((cell) => {
    cell.border = { bottom: { style: "thin" } };
  });
  ws.columns = [
    { width: 10 },
    { width: 55 },
    { width: 8 },
    { width: 12 },
    { width: 16 },
    { width: 16 },
  ];
  return headerRowIndex + 1; // primeira linha livre para conteúdo
}

// Escreve um nó (e recursivamente os seus filhos), devolvendo a próxima linha livre.
function writeNode(ws: ExcelJS.Worksheet, node: LineItemNode, row: number, depth: number): number {
  const r = ws.getRow(row);
  r.getCell(1).value = node.code ?? null;
  r.getCell(2).value = sanitizeExcelText(node.description);
  r.getCell(2).alignment = { indent: depth };

  if (node.kind === "item") {
    r.getCell(3).value = node.unit ?? "";
    r.getCell(4).value = node.quantity ?? 0;
    r.getCell(5).value = node.unitPrice ?? 0;
    r.getCell(6).value = { formula: `D${row}*E${row}` } as ExcelJS.CellFormulaValue;
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

// Escreve uma secção/edifício inteiro numa folha própria; devolve o número da linha do TOTAL
// (usada pela folha RESUMO para referenciar o total desta secção por fórmula).
function writeSectionSheet(workbook: ExcelJS.Workbook, section: SectionNode, doc: BudgetDocumentSummary["document"], usedNames: Set<string>) {
  const ws = workbook.addWorksheet(sanitizeSheetName(section.name, usedNames));
  let row = writeHeaderBlock(ws, doc.title, section.name.toUpperCase(), doc.revision, doc.fileNumber);

  const chapterTotalCells: string[] = [];
  for (const topNode of section.items) {
    const startRow = row;
    row = writeNode(ws, topNode, row, 0);
    const endRow = row - 1;
    if (topNode.kind === "capitulo" && endRow > startRow) {
      const subtotalRow = ws.getRow(row);
      subtotalRow.getCell(2).value = `SUB-TOTAL ${topNode.code ?? ""}`.trim();
      subtotalRow.getCell(6).value = { formula: `SUM(F${startRow + 1}:F${endRow})` } as ExcelJS.CellFormulaValue;
      subtotalRow.font = { bold: true };
      chapterTotalCells.push(`F${row}`);
      row++;
    }
  }

  row++; // linha em branco antes do total
  const totalRow = ws.getRow(row);
  totalRow.getCell(2).value = `TOTAL ${section.name.toUpperCase()}`;
  totalRow.getCell(6).value = chapterTotalCells.length
    ? ({ formula: chapterTotalCells.join("+") } as ExcelJS.CellFormulaValue)
    : 0;
  totalRow.font = { bold: true };
  totalRow.eachCell((cell) => (cell.border = { top: { style: "thin" } }));

  return { sheetName: ws.name, totalRow: row };
}

export async function buildBudgetDocumentExcel(summary: BudgetDocumentSummary): Promise<ExcelJS.Buffer> {
  const workbook = new ExcelJS.Workbook();
  const usedNames = new Set<string>(["RESUMO"]);

  const resumo = workbook.addWorksheet("RESUMO");
  let row = writeHeaderBlock(resumo, summary.document.title, "RESUMO GERAL", summary.document.revision, summary.document.fileNumber);
  resumo.getRow(row).getCell(2).value = "RESUMO";
  resumo.getRow(row).font = { bold: true };
  row++;

  const sectionRefs: { row: number }[] = [];
  for (const section of summary.sections) {
    const { sheetName, totalRow } = writeSectionSheet(workbook, section, summary.document, usedNames);
    const r = resumo.getRow(row);
    r.getCell(2).value = section.name;
    r.getCell(3).value = "un";
    r.getCell(4).value = 1;
    r.getCell(5).value = { formula: `'${sheetName}'!F${totalRow}` } as ExcelJS.CellFormulaValue;
    r.getCell(6).value = { formula: `D${row}*E${row}` } as ExcelJS.CellFormulaValue;
    sectionRefs.push({ row });
    row++;
  }

  const subtotal1Row = row;
  resumo.getRow(row).getCell(2).value = "Subtotal";
  resumo.getRow(row).getCell(6).value = sectionRefs.length
    ? ({ formula: `SUM(F${sectionRefs[0].row}:F${sectionRefs[sectionRefs.length - 1].row})` } as ExcelJS.CellFormulaValue)
    : 0;
  resumo.getRow(row).font = { bold: true };
  row++;

  const contingRow = row;
  resumo.getRow(row).getCell(2).value = "Contingências";
  resumo.getRow(row).getCell(4).value = Number(summary.document.contingenciasRate);
  resumo.getRow(row).getCell(6).value = { formula: `D${row}*F${subtotal1Row}` } as ExcelJS.CellFormulaValue;
  row++;

  const subtotal2Row = row;
  resumo.getRow(row).getCell(2).value = "Subtotal 2";
  resumo.getRow(row).getCell(6).value = { formula: `F${contingRow}+F${subtotal1Row}` } as ExcelJS.CellFormulaValue;
  resumo.getRow(row).font = { bold: true };
  row++;

  const ivaRow = row;
  resumo.getRow(row).getCell(2).value = "IVA";
  resumo.getRow(row).getCell(4).value = Number(summary.document.ivaRate);
  resumo.getRow(row).getCell(6).value = { formula: `D${row}*F${subtotal2Row}` } as ExcelJS.CellFormulaValue;
  row++;

  row++;
  resumo.getRow(row).getCell(2).value = "VALOR TOTAL";
  resumo.getRow(row).getCell(6).value = { formula: `F${subtotal2Row}+F${ivaRow}` } as ExcelJS.CellFormulaValue;
  resumo.getRow(row).font = { bold: true };

  await writeMeasurementsSheet(workbook, summary);

  return workbook.xlsx.writeBuffer();
}

// Folha "MEDIÇÕES": mapa de medições profissional — para cada item que tem linhas de
// medição dimensionais, lista Nº × Comp. × Larg. × Alt. = Parcial, com o total do item
// como fórmula SUM sobre os parciais (a coluna Parcial também é fórmula real).
async function writeMeasurementsSheet(workbook: ExcelJS.Workbook, summary: BudgetDocumentSummary) {
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
  ws.columns = [{ width: 10 }, { width: 45 }, { width: 8 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 12 }];

  ws.getCell("A1").value = "MAPA DE MEDIÇÕES";
  ws.getRow(1).font = { bold: true, size: 12 };
  let row = 3;

  const header = ws.getRow(row);
  header.values = ["ITEM", "DESCRIÇÃO", "Nº", "COMP. (m)", "LARG. (m)", "ALT. (m)", "PARCIAL"];
  header.font = { bold: true };
  header.eachCell((cell) => (cell.border = { bottom: { style: "thin" } }));
  row++;

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
      if (line.length !== null) r.getCell(4).value = Number(line.length);
      if (line.width !== null) r.getCell(5).value = Number(line.width);
      if (line.height !== null) r.getCell(6).value = Number(line.height);
      // Parcial = Nº × (dimensões preenchidas; vazias contam como 1)
      r.getCell(7).value = {
        formula: `C${row}*IF(D${row}="",1,D${row})*IF(E${row}="",1,E${row})*IF(F${row}="",1,F${row})`,
      } as ExcelJS.CellFormulaValue;
      row++;
    }

    const totalRow = ws.getRow(row);
    totalRow.getCell(2).value = `   Total (${item.node.unit ?? ""})`;
    totalRow.getCell(7).value = { formula: `SUM(G${firstLineRow}:G${row - 1})` } as ExcelJS.CellFormulaValue;
    totalRow.font = { bold: true };
    totalRow.eachCell((cell) => (cell.border = { top: { style: "thin" } }));
    row += 2;
  }
}

import ExcelJS from "exceljs";
import type { MaterialsByPhaseResult } from "./materialsByPhase.js";
import { sanitizeExcelText } from "./excelExport.js";

export async function buildMaterialsByPhaseExcel(documentTitle: string, result: MaterialsByPhaseResult): Promise<ExcelJS.Buffer> {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet("MATERIAIS POR FASE");
  ws.columns = [{ width: 42 }, { width: 12 }, { width: 9 }, { width: 20 }, { width: 16 }];

  ws.getCell("A1").value = "MATERIAIS POR FASE";
  ws.getRow(1).font = { bold: true, size: 12 };
  ws.getCell("A2").value = sanitizeExcelText(documentTitle);
  ws.getRow(2).font = { italic: true, color: { argb: "FF6B7280" } };
  ws.getCell("A3").value = `Valor total dos materiais: ${result.grandTotal.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${result.currency}`;
  ws.getRow(3).font = { bold: true, color: { argb: "FF312E81" } };

  let row = 5;
  for (const phase of result.phases) {
    const phaseRow = ws.getRow(row);
    phaseRow.getCell(1).value = phase.label.toUpperCase();
    phaseRow.getCell(5).value = `${phase.valueTotal.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${result.currency}`;
    phaseRow.font = { bold: true };
    phaseRow.eachCell((cell) => (cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF2FF" } }));
    row++;

    const hasRows = phase.materials.length > 0 || phase.itemsWithoutComposition.length > 0;
    if (hasRows) {
      const header = ws.getRow(row);
      header.values = ["Material", "Quantidade", "Unidade", "Unidade de compra", "Valor"];
      header.font = { bold: true };
      header.eachCell((cell) => (cell.border = { bottom: { style: "thin" } }));
      row++;

      for (const m of phase.materials) {
        const r = ws.getRow(row);
        r.getCell(1).value = sanitizeExcelText(m.name);
        r.getCell(2).value = m.quantity;
        r.getCell(2).numFmt = "#,##0.000";
        r.getCell(3).value = m.unit;
        r.getCell(4).value = m.purchasePackageLabel && m.purchaseQty !== null ? `${m.purchaseQty} × ${m.purchasePackageLabel}` : "—";
        r.getCell(5).value = m.value;
        r.getCell(5).numFmt = "#,##0.00";
        row++;
      }

      for (const item of phase.itemsWithoutComposition) {
        const r = ws.getRow(row);
        r.getCell(1).value = sanitizeExcelText(`${item.code ?? ""} ${item.description}`.trim());
        r.getCell(2).value = item.quantity;
        r.getCell(2).numFmt = "#,##0.000";
        r.getCell(3).value = item.unit ?? "";
        r.getCell(4).value = item.barsInfo
          ? `${item.barsInfo.barsNeeded} varões de ${item.barsInfo.barLengthM}m (Ø${item.barsInfo.diameterMm}mm)`
          : "sem composição";
        r.getCell(5).value = item.value;
        r.getCell(5).numFmt = "#,##0.00";
        r.font = { italic: true, color: { argb: "FF92400E" } };
        row++;
      }
    } else {
      ws.getRow(row).getCell(1).value = "Sem materiais explodidos nesta fase.";
      ws.getRow(row).font = { italic: true, color: { argb: "FF9CA3AF" } };
      row++;
    }

    row++; // linha em branco entre fases
  }

  if (result.phases.length === 0) {
    ws.getRow(row).getCell(1).value = "Nenhum item medido ainda — sem materiais a listar.";
    ws.getRow(row).font = { italic: true, color: { argb: "FF9CA3AF" } };
  }

  return workbook.xlsx.writeBuffer();
}

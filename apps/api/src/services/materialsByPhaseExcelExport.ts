import ExcelJS from "exceljs";
import type { MaterialsByPhaseResult } from "./materialsByPhase.js";
import type { CompanyBrand } from "./companyBrand.js";
import { applyExcelLetterhead } from "./documentChrome.js";
import { sanitizeExcelText } from "./excelExport.js";

export async function buildMaterialsByPhaseExcel(
  documentTitle: string,
  result: MaterialsByPhaseResult,
  brand: CompanyBrand,
): Promise<ExcelJS.Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = brand.brandName || brand.name;
  workbook.company = brand.brandName || brand.name;
  const ws = workbook.addWorksheet("MATERIAIS POR FASE");

  let row = await applyExcelLetterhead(workbook, ws, brand, {
    documentTitle: "MATERIAIS POR FASE",
    documentSubtitle: documentTitle,
    columnWidths: [42, 12, 9, 20, 16],
  });

  ws.getCell(`A${row}`).value =
    `Valor total dos materiais: ${result.grandTotal.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${result.currency}`;
  ws.getRow(row).font = { bold: true };
  row += 2;

  for (const phase of result.phases) {
    const phaseRow = ws.getRow(row);
    phaseRow.getCell(1).value = phase.label.toUpperCase();
    phaseRow.getCell(5).value =
      `${phase.valueTotal.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${result.currency}`;
    phaseRow.font = { bold: true };
    phaseRow.eachCell((cell) => (cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } }));
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
        r.getCell(2).numFmt = "#,##0.00";
        r.getCell(3).value = m.unit;
        r.getCell(4).value =
          m.purchasePackageLabel && m.purchaseQty !== null ? `${m.purchaseQty} × ${m.purchasePackageLabel}` : "—";
        r.getCell(5).value = m.value;
        r.getCell(5).numFmt = "#,##0.00";
        row++;
      }

      for (const item of phase.itemsWithoutComposition) {
        const r = ws.getRow(row);
        r.getCell(1).value = sanitizeExcelText(`${item.code ?? ""} ${item.description}`.trim());
        r.getCell(2).value = item.quantity;
        r.getCell(2).numFmt = "#,##0.00";
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

    row++;
  }

  if (result.phases.length === 0) {
    ws.getRow(row).getCell(1).value = "Nenhum item medido ainda — sem materiais a listar.";
    ws.getRow(row).font = { italic: true, color: { argb: "FF9CA3AF" } };
  }

  return workbook.xlsx.writeBuffer();
}

import ExcelJS from "exceljs";
import { eq, and, inArray, isNull, or, max } from "drizzle-orm";
import { db } from "../db/index.js";
import { budgetSections, lineItems, measurementLines, costCompositions } from "../db/schema.js";
import { STANDARD_CHAPTERS } from "./boqTemplate.js";
import { computeCompositionUnitCost } from "./costEngine.js";
import { getZoneIdForSection } from "./accessControl.js";
import type { Unit } from "@sigo/shared";

const VALID_UNITS = new Set(["m", "m2", "m3", "ml", "kg", "un", "vg", "h"]);

function normalizeUnit(value: string, fallback: string): Unit {
  const u = value.trim().toLowerCase();
  if (VALID_UNITS.has(u)) return u as Unit;
  if (VALID_UNITS.has(fallback)) return fallback as Unit;
  return "un";
}

// Importação de Excel de medições — actualiza quantidades dos itens existentes pelo código e,
// opcionalmente, cria capítulos/itens novos quando o código ainda não existe no documento.

export type MeasurementImportResult = {
  itemsUpdated: number;
  itemsCreated: number;
  rowsRead: number;
  unmatched: { sheet: string; rowNumber: number; code: string; quantity: number; reason: string }[];
};

export type MeasurementImportOptions = {
  createMissing?: boolean;
};

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

const CODE_HEADERS = ["item", "codigo", "cod"];
const QTY_HEADERS = ["quant", "qtd"];
const DESC_HEADERS = ["descricao", "designacao", "desc"];
const UNIT_HEADERS = ["un", "unidade"];
const SUBTOTAL_DISCIPLINE = /^subtotal\s*-\s*(.+)$/i;

type SheetRow = {
  sheet: string;
  rowNumber: number;
  code: string;
  quantity: number;
  description: string;
  unit: string;
  scope: string;
};

const TEMPLATE_ITEM_BY_CODE = new Map(STANDARD_CHAPTERS.flatMap((c) => c.items.map((i) => [i.code, i])));
const TEMPLATE_CHAPTER_BY_CODE = new Map(STANDARD_CHAPTERS.map((c) => [c.code, c]));

function readSheetRows(sheet: ExcelJS.Worksheet): SheetRow[] {
  let headerRow = -1;
  let codeCol = -1;
  let qtyCol = -1;
  let descCol = -1;
  let unitCol = -1;

  for (let r = 1; r <= Math.min(20, sheet.rowCount); r++) {
    const row = sheet.getRow(r);
    let foundCode = -1;
    let foundQty = -1;
    let foundDesc = -1;
    let foundUnit = -1;
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const value = normalizeText(cell.value);
      if (foundCode === -1 && CODE_HEADERS.some((h) => value === h)) foundCode = colNumber;
      if (foundQty === -1 && QTY_HEADERS.some((h) => value.startsWith(h))) foundQty = colNumber;
      if (foundDesc === -1 && DESC_HEADERS.some((h) => value.startsWith(h))) foundDesc = colNumber;
      if (foundUnit === -1 && UNIT_HEADERS.some((h) => value === h)) foundUnit = colNumber;
    });
    if (foundCode !== -1 && foundQty !== -1) {
      headerRow = r;
      codeCol = foundCode;
      qtyCol = foundQty;
      descCol = foundDesc;
      unitCol = foundUnit;
      break;
    }
  }
  if (headerRow === -1) return [];

  const disciplineMarkers: { rowNumber: number; discipline: string }[] = [];
  for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    for (let c = 1; c <= 6; c++) {
      const value = row.getCell(c).value;
      if (typeof value !== "string") continue;
      const m = value.trim().match(SUBTOTAL_DISCIPLINE);
      if (m) {
        disciplineMarkers.push({ rowNumber: r, discipline: m[1].trim() });
        break;
      }
    }
  }

  function scopeFor(rowNumber: number): string {
    const next = disciplineMarkers.find((m) => m.rowNumber >= rowNumber);
    return next?.discipline ?? "";
  }

  const rows: SheetRow[] = [];
  for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const codeCell = row.getCell(codeCol).value;
    const qtyCell = row.getCell(qtyCol).value;
    const code = codeCell !== null && codeCell !== undefined ? String(codeCell).trim() : "";
    const quantity = typeof qtyCell === "number" ? qtyCell : Number(qtyCell);
    if (!code || !code.includes(".") || !Number.isFinite(quantity)) continue;

    const descCell = descCol > 0 ? row.getCell(descCol).value : null;
    const unitCell = unitCol > 0 ? row.getCell(unitCol).value : null;
    rows.push({
      sheet: sheet.name,
      rowNumber: r,
      code,
      quantity,
      description: descCell != null ? String(descCell).trim() : "",
      unit: unitCell != null ? String(unitCell).trim().toLowerCase() : "",
      scope: scopeFor(r),
    });
  }
  return rows;
}

async function nextSortOrder(sectionId: string, parentId: string | null): Promise<number> {
  const [row] = await db
    .select({ value: max(lineItems.sortOrder) })
    .from(lineItems)
    .where(and(eq(lineItems.sectionId, sectionId), parentId ? eq(lineItems.parentId, parentId) : isNull(lineItems.parentId)));
  return (row?.value ?? -1) + 1;
}

async function findCompositionIdByName(name: string, companyId: string): Promise<string | null> {
  const rows = await db
    .select({ id: costCompositions.id, companyId: costCompositions.companyId })
    .from(costCompositions)
    .where(and(eq(costCompositions.name, name), or(isNull(costCompositions.companyId), eq(costCompositions.companyId, companyId))));
  const own = rows.find((r) => r.companyId === companyId);
  const global = rows.find((r) => r.companyId === null);
  return own?.id ?? global?.id ?? null;
}

async function ensureChapter(sectionId: string, chapterCode: string): Promise<string | null> {
  const [existing] = await db
    .select()
    .from(lineItems)
    .where(and(eq(lineItems.sectionId, sectionId), eq(lineItems.code, chapterCode), eq(lineItems.kind, "capitulo")))
    .limit(1);
  if (existing) return existing.id;

  const template = TEMPLATE_CHAPTER_BY_CODE.get(chapterCode);
  const [created] = await db
    .insert(lineItems)
    .values({
      sectionId,
      parentId: null,
      kind: "capitulo",
      code: chapterCode,
      description: template?.name ?? `Capítulo ${chapterCode}`,
      sortOrder: await nextSortOrder(sectionId, null),
      origin: "manual",
    })
    .returning();
  return created.id;
}

async function createLineItemFromImport(
  sectionId: string,
  code: string,
  description: string,
  unit: string,
  companyId: string,
): Promise<string> {
  const template = TEMPLATE_ITEM_BY_CODE.get(code);
  const chapterCode = code.split(".")[0];
  const chapterId = await ensureChapter(sectionId, chapterCode);

  let compositionId: string | null = null;
  let unitPrice: string | null = null;
  let origin: "manual" | "composicao" = "manual";
  const compositionName = template?.composition;
  if (compositionName) {
    compositionId = await findCompositionIdByName(compositionName, companyId);
    if (compositionId) {
      const zoneId = await getZoneIdForSection(sectionId);
      const breakdown = await computeCompositionUnitCost(compositionId, companyId, zoneId);
      unitPrice = breakdown.unitCost.toString();
      origin = "composicao";
    }
  }

  const [item] = await db
    .insert(lineItems)
    .values({
      sectionId,
      parentId: chapterId,
      kind: "item",
      code,
      description: description || template?.description || `Item ${code}`,
      unit: normalizeUnit(unit, template?.unit ?? "un"),
      compositionId,
      unitPrice,
      sortOrder: await nextSortOrder(sectionId, chapterId),
      origin,
    })
    .returning();
  return item.id;
}

function resolveSectionId(
  row: SheetRow,
  sections: typeof budgetSections.$inferSelect[],
  sectionByNormalizedName: Map<string, string>,
): string | null {
  const fromScope = row.scope ? sectionByNormalizedName.get(normalizeText(row.scope)) : undefined;
  if (fromScope) return fromScope;
  const fromSheet = sectionByNormalizedName.get(normalizeText(row.sheet));
  if (fromSheet) return fromSheet;
  if (sections.length === 1) return sections[0].id;
  return null;
}

async function applyQuantityToItem(itemId: string, row: SheetRow) {
  await db.delete(measurementLines).where(eq(measurementLines.lineItemId, itemId));
  await db.insert(measurementLines).values({
    lineItemId: itemId,
    description: `Medição importada do Excel (folha "${row.sheet}", linha ${row.rowNumber})`,
    count: row.quantity.toFixed(2),
    sortOrder: 0,
  });
  await db.update(lineItems).set({ quantity: row.quantity.toFixed(2), origin: "manual" }).where(eq(lineItems.id, itemId));
}

export async function importMeasurementsFromExcel(
  documentId: string,
  buffer: Buffer,
  companyId: string,
  options: MeasurementImportOptions = {},
): Promise<MeasurementImportResult> {
  const createMissing = options.createMissing !== false;

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  if (workbook.worksheets.length === 0) throw new Error("O ficheiro Excel não tem nenhuma folha.");

  const rows = workbook.worksheets.flatMap(readSheetRows);
  if (rows.length === 0) {
    throw new Error(
      'Não foi possível encontrar as colunas "Item"/"Código" e "Quant." em nenhuma folha do ficheiro — confirme que o Excel tem estes cabeçalhos numa das primeiras 20 linhas de alguma folha.',
    );
  }

  const sections = await db.select().from(budgetSections).where(eq(budgetSections.documentId, documentId));
  if (sections.length === 0) throw new Error("O documento não tem secções — adicione pelo menos uma secção antes de importar.");

  const sectionIds = sections.map((s) => s.id);
  const codes = Array.from(new Set(rows.map((r) => r.code)));
  const items = await db
    .select()
    .from(lineItems)
    .where(and(inArray(lineItems.sectionId, sectionIds), inArray(lineItems.code, codes)));

  const sectionByNormalizedName = new Map(sections.map((s) => [normalizeText(s.name), s.id]));
  const itemsBySection = new Map<string, typeof items>();
  for (const item of items) {
    const list = itemsBySection.get(item.sectionId) ?? [];
    list.push(item);
    itemsBySection.set(item.sectionId, list);
  }
  const itemsByCodeAcrossSections = new Map<string, typeof items>();
  for (const item of items) {
    const list = itemsByCodeAcrossSections.get(item.code!) ?? [];
    list.push(item);
    itemsByCodeAcrossSections.set(item.code!, list);
  }

  const unmatched: MeasurementImportResult["unmatched"] = [];
  const resolved: { row: SheetRow; itemId: string; created: boolean }[] = [];

  for (const row of rows) {
    const sectionId = resolveSectionId(row, sections, sectionByNormalizedName);
    if (!sectionId) {
      unmatched.push({
        ...row,
        reason: "secção não identificada — renomeie a folha do Excel para o nome exacto da secção do documento",
      });
      continue;
    }

    const inSection = (itemsBySection.get(sectionId) ?? []).filter((i) => i.code === row.code);
    if (inSection.length === 1) {
      resolved.push({ row, itemId: inSection[0].id, created: false });
      continue;
    }
    if (inSection.length > 1) {
      unmatched.push({ ...row, reason: `código "${row.code}" duplicado na mesma secção` });
      continue;
    }

    if (createMissing) {
      const itemId = await createLineItemFromImport(sectionId, row.code, row.description, row.unit, companyId);
      const createdItem = { id: itemId, sectionId, code: row.code } as (typeof items)[number];
      const list = itemsBySection.get(sectionId) ?? [];
      list.push(createdItem);
      itemsBySection.set(sectionId, list);
      resolved.push({ row, itemId, created: true });
      continue;
    }

    const globalMatches = itemsByCodeAcrossSections.get(row.code) ?? [];
    if (globalMatches.length === 0) {
      unmatched.push({ ...row, reason: "sem item correspondente neste Mapa de Quantidades" });
    } else if (globalMatches.length > 1) {
      unmatched.push({
        ...row,
        reason: `código existe em ${globalMatches.length} secções — renomeie a folha do Excel para a secção correcta`,
      });
    } else {
      resolved.push({ row, itemId: globalMatches[0].id, created: false });
    }
  }

  const rowsByItemId = new Map<string, { row: SheetRow; itemId: string; created: boolean }[]>();
  for (const r of resolved) {
    const list = rowsByItemId.get(r.itemId) ?? [];
    list.push(r);
    rowsByItemId.set(r.itemId, list);
  }

  let itemsUpdated = 0;
  let itemsCreated = 0;
  for (const [itemId, group] of rowsByItemId) {
    if (group.length > 1) {
      const locations = group.map((g) => `folha "${g.row.sheet}" linha ${g.row.rowNumber} (${g.row.quantity})`).join("; ");
      for (const g of group) {
        unmatched.push({
          ...g.row,
          reason: `o código "${g.row.code}" aparece em mais do que um sítio a apontar para o mesmo item (${locations})`,
        });
      }
      continue;
    }
    const { row, created } = group[0];
    await applyQuantityToItem(itemId, row);
    if (created) itemsCreated++;
    else itemsUpdated++;
  }

  return { itemsUpdated, itemsCreated, rowsRead: rows.length, unmatched };
}

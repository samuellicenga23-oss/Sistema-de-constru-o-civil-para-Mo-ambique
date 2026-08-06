import ExcelJS from "exceljs";
import { eq, and, inArray, isNull, max } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { budgetSections, lineItems, measurementLines, workItemTemplates } from "../db/schema.js";
import { loadCompanyImportMemory, lookupImportMemory, rememberImportCompositionLinks } from "./importCompositionMemory.js";
import { loadWorkChapterLibrary, type TemplateChapter } from "./boqTemplate.js";
import { getZoneIdForSection } from "./accessControl.js";
import { normalizeUnit, constructionDomainsConflict, type Unit } from "@sigo/shared";
import { env } from "../env.js";
import {
  resolveOrCreateCompositionForImport,
  previewCompositionForImport,
  loadImportCompositionResources,
  type ImportResourcesCache,
  type ResolvedImportComposition,
} from "./importComposition.js";
import { mapDescriptionToSigoComposition } from "./sigoCompositionMap.js";

// Importação de Excel de medições — parse robusto (merge cells + unidades), pré-visualização
// com match híbrido e aplicação confirmada pelo utilizador.

const MAX_IMPORT_ROWS = 5_000;
const MAX_WORKSHEETS = 30;
const MAX_CODE_LEN = 30;
const MAX_CHAPTER_CODE_LEN = 10;
const MAX_QUANTITY = 1_000_000_000;
const DESC_MATCH_FLOOR = 0.85;
const MIN_DESC_LEN_FOR_FUZZY = 8;

export type ParsedExcelRow = {
  rowKey: string;
  sheet: string;
  rowNumber: number;
  code: string;
  quantity: number;
  description: string;
  unitRaw: string;
  unit: Unit;
  scope: string;
  unitPrice: number | null;
};

export type ImportMatchAction = "map" | "create" | "ignore";

export type ImportPreviewRow = ParsedExcelRow & {
  action: ImportMatchAction;
  targetCode: string | null;
  targetItemId: string | null;
  targetDescription: string | null;
  matchMethod: "code" | "description" | "ai" | "none";
  confidence: number;
  note: string | null;
  compositionName: string | null;
  compositionId: string | null;
  priceSource: "file" | "composition" | "none";
  /** Código igual ao catálogo mas descrição/domínio diferentes — só nesta medição. */
  codeCollision: boolean;
  /** Linha que o utilizador deve confirmar antes de aplicar. */
  needsReview: boolean;
  /** Ao aplicar, será criada composição nova (não existe match fiável). */
  willCreateComposition: boolean;
};

export type MeasurementImportPreview = {
  rows: ImportPreviewRow[];
  catalog: Array<{
    code: string;
    description: string;
    unit: Unit;
    itemId: string | null;
    chapterCode: string;
    compositionName?: string | null;
    compositionId?: string | null;
  }>;
  /** Catálogo de composições para o utilizador ligar manualmente na revisão. */
  compositionOptions: Array<{ id: string; name: string; category: string | null; outputUnit: string }>;
  aiUsed: boolean;
  aiError: string | null;
  rowsRead: number;
};

export type ImportApplyDecision = {
  rowKey: string;
  action: ImportMatchAction;
  targetCode?: string | null;
  targetItemId?: string | null;
  /** Override: composição escolhida pelo utilizador na revisão. */
  compositionId?: string | null;
  compositionName?: string | null;
  /** Forçar criação de composição a partir da descrição (ignorar catálogo por código). */
  forceCreateComposition?: boolean;
};

export type CreatedImportComposition = {
  id: string;
  name: string;
  itemCodes: string[];
};

export type MeasurementImportResult = {
  itemsUpdated: number;
  itemsCreated: number;
  rowsRead: number;
  templateItemsSaved: number;
  compositionsCreated: number;
  compositionsLinked: number;
  /** Composições geradas nesta importação — o utilizador deve rever rendimentos e insumos. */
  createdCompositions: CreatedImportComposition[];
  unmatched: { sheet: string; rowNumber: number; code: string; quantity: number; reason: string }[];
};

export type MeasurementImportOptions = {
  createMissing?: boolean;
  saveToCompanyTemplate?: boolean;
};

export const importApplyDecisionSchema = z.object({
  rowKey: z.string().trim().min(1).max(200),
  action: z.enum(["map", "create", "ignore"]),
  targetCode: z.string().trim().min(1).max(MAX_CODE_LEN).nullable().optional(),
  targetItemId: z.string().uuid().nullable().optional(),
  compositionId: z.string().uuid().nullable().optional(),
  compositionName: z.string().trim().max(300).nullable().optional(),
  forceCreateComposition: z.boolean().optional(),
});

export const importApplyDecisionsSchema = z.array(importApplyDecisionSchema).min(1).max(MAX_IMPORT_ROWS);

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

const CODE_HEADERS = ["item", "codigo", "cod", "ref", "referencia", "nr", "n"];
const QTY_HEADERS = ["quant", "qtd", "qty", "quantidade"];
const DESC_HEADERS = ["descricao", "designacao", "desc", "trabalho", "especificacao", "designation"];
const UNIT_HEADERS = ["unidade", "und", "unit", "um", "un"];
const PRICE_HEADERS = ["preco unitario", "preco unit", "p. unit", "punit", "unitario", "unit price"];
const TOTAL_PRICE_HEADERS = ["preco total", "valor total", "total (usd)", "total (mzn)", "total usd", "total mzn"];
const SUBTOTAL_DISCIPLINE = /^subtotal\s*-\s*(.+)$/i;
const SUMMARY_SHEET_RE = /^(resumo|summary|indice|índice|capa)$/i;

/** Normaliza códigos de cliente (1,1.1 → 1.1.1). */
export function normalizeItemCode(raw: string): string {
  return String(raw ?? "")
    .trim()
    .replace(/,/g, ".")
    .replace(/\s+/g, "")
    .slice(0, MAX_CODE_LEN);
}

function cellText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object" && value !== null && "text" in (value as object)) {
    return String((value as { text?: unknown }).text ?? "").trim();
  }
  if (typeof value === "object" && value !== null && "result" in (value as object)) {
    return String((value as { result?: unknown }).result ?? "").trim();
  }
  if (value && typeof value === "object" && Array.isArray((value as { richText?: unknown[] }).richText)) {
    return ((value as { richText: Array<{ text?: string }> }).richText ?? []).map((t) => t.text ?? "").join("").trim();
  }
  return String(value).trim();
}

/** Parse quantidades PT/EU (1.234,56) e US (1,234.56). */
export function parseQuantity(value: unknown): number {
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && "result" in (value as object)) {
    const r = (value as { result?: unknown }).result;
    if (typeof r === "number") return r;
    return parseQuantity(r);
  }
  const raw = cellText(value).replace(/\s/g, "").replace(/[^\d,.\-]/g, "");
  if (!raw || raw === "-" || raw === "." || raw === ",") return Number.NaN;

  const hasComma = raw.includes(",");
  const hasDot = raw.includes(".");
  let normalized = raw;
  if (hasComma && hasDot) {
    // O último separador é o decimal.
    if (raw.lastIndexOf(",") > raw.lastIndexOf(".")) {
      normalized = raw.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = raw.replace(/,/g, "");
    }
  } else if (hasComma) {
    const parts = raw.split(",");
    normalized = parts.length === 2 && parts[1].length <= 3 ? parts.join(".") : raw.replace(/,/g, "");
  } else if (hasDot) {
    const parts = raw.split(".");
    if (parts.length > 2) normalized = raw.replace(/\./g, "");
    else if (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3) {
      // Ambíguo 1.234 — tratar como milhares se a parte decimal tem 3 dígitos e inteiro curto
      normalized = raw.replace(/\./g, "");
    }
  }

  return Number(normalized);
}

function isValidImportQuantity(qty: number): boolean {
  return Number.isFinite(qty) && qty > 0 && qty <= MAX_QUANTITY;
}

/** Expande merges: cada célula da área recebe o valor da célula mestre. */
function buildMergedValueMap(sheet: ExcelJS.Worksheet): Map<string, unknown> {
  const map = new Map<string, unknown>();
  const merges = (sheet.model as { merges?: string[] } | undefined)?.merges ?? [];
  for (const range of merges) {
    try {
      const [start, end] = String(range).split(":");
      if (!start || !end) continue;
      const topLeft = sheet.getCell(start);
      const master = topLeft.value;
      const startCell = sheet.getCell(start);
      const endCell = sheet.getCell(end);
      const r1 = Number(startCell.row);
      const r2 = Number(endCell.row);
      const c1 = Number(startCell.col);
      const c2 = Number(endCell.col);
      for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
        for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
          map.set(`${r}:${c}`, master);
        }
      }
    } catch {
      // ignore malformed merge ranges
    }
  }
  return map;
}

function getCellValue(sheet: ExcelJS.Worksheet, row: number, col: number, merges: Map<string, unknown>): unknown {
  const key = `${row}:${col}`;
  if (merges.has(key)) return merges.get(key);
  return sheet.getRow(row).getCell(col).value;
}

function looksLikeCode(code: string): boolean {
  if (!code || code.length > MAX_CODE_LEN) return false;
  if (!/\d/.test(code)) return false;
  if (/^(subtotal|total|soma|capitulo|capítulo)/i.test(code)) return false;
  return true;
}

function chapterCodeOf(itemCode: string): string {
  const parts = itemCode.split(/[.\-\s]/).filter(Boolean);
  const code = parts[0] || itemCode;
  return code.slice(0, MAX_CHAPTER_CODE_LEN);
}

function headerMatches(value: string, headers: string[], mode: "exactOrSpace" | "prefix"): boolean {
  return headers.some((h) => {
    if (mode === "exactOrSpace") return value === h || value.startsWith(h + " ");
    // Unidades: evitar matching de "un" em "unidade" via startsWith solto em palavras longas
    if (h.length <= 2) return value === h || value.startsWith(h + " ") || value.startsWith(h + ".");
    return value === h || value.startsWith(h);
  });
}

export function readSheetRows(sheet: ExcelJS.Worksheet): ParsedExcelRow[] {
  if (SUMMARY_SHEET_RE.test(sheet.name.trim())) return [];

  const merges = buildMergedValueMap(sheet);
  let headerRow = -1;
  let codeCol = -1;
  let qtyCol = -1;
  let descCol = -1;
  let unitCol = -1;
  let priceCol = -1;
  let totalCol = -1;

  const maxScan = Math.min(40, sheet.rowCount || 40);
  for (let r = 1; r <= maxScan; r++) {
    let foundCode = -1;
    let foundQty = -1;
    let foundDesc = -1;
    let foundUnit = -1;
    let foundPrice = -1;
    let foundTotal = -1;

    const scanRow = (rowIndex: number) => {
      sheet.getRow(rowIndex).eachCell({ includeEmpty: false }, (_cell, colNumber) => {
        const value = normalizeText(getCellValue(sheet, rowIndex, colNumber, merges));
        if (foundCode === -1 && headerMatches(value, CODE_HEADERS, "exactOrSpace")) foundCode = colNumber;
        if (foundQty === -1 && headerMatches(value, QTY_HEADERS, "prefix")) foundQty = colNumber;
        if (foundDesc === -1 && headerMatches(value, DESC_HEADERS, "prefix")) foundDesc = colNumber;
        if (foundUnit === -1 && headerMatches(value, UNIT_HEADERS, "prefix")) foundUnit = colNumber;
        if (foundPrice === -1 && PRICE_HEADERS.some((h) => value === h || value.startsWith(h))) foundPrice = colNumber;
        if (foundTotal === -1 && TOTAL_PRICE_HEADERS.some((h) => value === h || value.startsWith(h))) foundTotal = colNumber;
        // Cabeçalho genérico "preço" / "valor" — só se ainda não houver coluna de unitário
        if (foundPrice === -1 && (value === "preco" || value === "valor") && foundTotal !== colNumber) {
          foundPrice = colNumber;
        }
      });
    };

    scanRow(r);
    // Cabeçalhos partidos (ex.: Preço / Unitário na linha seguinte)
    if (r < maxScan) scanRow(r + 1);

    if (foundCode !== -1 && foundQty !== -1) {
      headerRow = r;
      codeCol = foundCode;
      qtyCol = foundQty;
      descCol = foundDesc;
      unitCol = foundUnit;
      priceCol = foundPrice;
      totalCol = foundTotal;
      break;
    }
  }
  if (headerRow === -1) return [];

  const disciplineMarkers: { rowNumber: number; discipline: string }[] = [];
  for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
    for (let c = 1; c <= 8; c++) {
      const value = cellText(getCellValue(sheet, r, c, merges));
      const m = value.match(SUBTOTAL_DISCIPLINE);
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

  const rows: ParsedExcelRow[] = [];
  // Se o cabeçalho está partido em 2 linhas, começar após a segunda
  let dataStart = headerRow + 1;
  const maybeSecondHeader = normalizeText(getCellValue(sheet, headerRow + 1, codeCol, merges));
  if (
    headerMatches(maybeSecondHeader, CODE_HEADERS, "exactOrSpace") ||
    headerMatches(maybeSecondHeader, QTY_HEADERS, "prefix") ||
    PRICE_HEADERS.some((h) => maybeSecondHeader === h || maybeSecondHeader.startsWith(h)) ||
    maybeSecondHeader === "unitario" ||
    maybeSecondHeader === "total"
  ) {
    dataStart = headerRow + 2;
  }

  for (let r = dataStart; r <= sheet.rowCount; r++) {
    const rawCode = cellText(getCellValue(sheet, r, codeCol, merges));
    const code = normalizeItemCode(rawCode);
    const quantity = parseQuantity(getCellValue(sheet, r, qtyCol, merges));
    if (!looksLikeCode(code) || !isValidImportQuantity(quantity)) continue;

    const description = descCol > 0 ? cellText(getCellValue(sheet, r, descCol, merges)).slice(0, 2000) : "";
    if (/^(sub[\s\-]?total|notas?:|soma|total)\b/i.test(description)) continue;
    const unitRaw = unitCol > 0 ? cellText(getCellValue(sheet, r, unitCol, merges)).slice(0, 40) : "";
    let priceRaw = priceCol > 0 ? parseQuantity(getCellValue(sheet, r, priceCol, merges)) : Number.NaN;
    // Se o unitário veio vazio mas há total e quantidade, deriva o preço.
    if (!Number.isFinite(priceRaw) || priceRaw <= 0) {
      const totalRaw = totalCol > 0 ? parseQuantity(getCellValue(sheet, r, totalCol, merges)) : Number.NaN;
      if (Number.isFinite(totalRaw) && totalRaw > 0 && quantity > 0) {
        priceRaw = totalRaw / quantity;
      }
    }
    const unitPrice = Number.isFinite(priceRaw) && priceRaw > 0 ? priceRaw : null;
    rows.push({
      rowKey: `${sheet.name.trim()}::${r}::${code}`,
      sheet: sheet.name.trim(),
      rowNumber: r,
      code,
      quantity,
      description,
      unitRaw,
      unit: normalizeUnit(unitRaw, "un"),
      scope: scopeFor(r),
      unitPrice,
    });
  }
  return rows;
}

export async function parseMeasurementsExcel(buffer: Buffer): Promise<ParsedExcelRow[]> {
  if (buffer.length > 12 * 1024 * 1024) {
    throw new Error("O ficheiro Excel excede o limite de 12 MB.");
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  if (workbook.worksheets.length === 0) throw new Error("O ficheiro Excel não tem nenhuma folha.");
  if (workbook.worksheets.length > MAX_WORKSHEETS) {
    throw new Error(`O ficheiro tem demasiadas folhas (máx. ${MAX_WORKSHEETS}).`);
  }
  const rows = workbook.worksheets.flatMap(readSheetRows);
  if (rows.length === 0) {
    throw new Error(
      'Não foi possível encontrar colunas de código e quantidade — confirme cabeçalhos como "Item"/"Código" e "Quant." nas primeiras linhas.',
    );
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new Error(`O Excel tem demasiadas linhas de medição (máx. ${MAX_IMPORT_ROWS}).`);
  }
  return rows;
}

async function parseMeasurementsPdf(buffer: Buffer): Promise<ParsedExcelRow[]> {
  if (buffer.length > 20 * 1024 * 1024) {
    throw new Error("O PDF excede o limite de 20 MB.");
  }
  const headers: Record<string, string> = {};
  if (env.plantServiceToken) headers["X-Internal-Token"] = env.plantServiceToken;
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buffer)], { type: "application/pdf" }), "mapa.pdf");
  const res = await fetch(`${env.plantServiceUrl}/assist/boq-extract`, {
    method: "POST",
    headers,
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `Falha ao ler PDF de mapa (${res.status})`);
  }
  const body = (await res.json()) as {
    rows?: Array<{
      rowKey?: string;
      sheet?: string;
      rowNumber?: number;
      code?: string;
      quantity?: number;
      description?: string;
      unitRaw?: string;
      unit?: string;
      scope?: string;
      unitPrice?: number | null;
    }>;
    error?: string | null;
  };
  const rows = (body.rows ?? [])
    .map((row, index) => {
      const code = normalizeItemCode(row.code ?? "");
      const quantity = Number(row.quantity);
      if (!looksLikeCode(code) || !isValidImportQuantity(quantity)) return null;
      const unitRaw = String(row.unitRaw || row.unit || "un");
      return {
        rowKey: row.rowKey || `pdf::${index + 1}::${code}`,
        sheet: String(row.sheet || "PDF").slice(0, 120),
        rowNumber: Number(row.rowNumber) || index + 1,
        code,
        quantity,
        description: String(row.description || "").slice(0, 2000),
        unitRaw,
        unit: normalizeUnit(unitRaw, "un"),
        scope: String(row.scope || ""),
        unitPrice: row.unitPrice != null && Number.isFinite(Number(row.unitPrice)) ? Number(row.unitPrice) : null,
      } satisfies ParsedExcelRow;
    })
    .filter((r): r is ParsedExcelRow => r != null);

  if (!rows.length) {
    throw new Error(body.error || "Não foi possível extrair itens do PDF de mapa de quantidades.");
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new Error(`O PDF tem demasiadas linhas de medição (máx. ${MAX_IMPORT_ROWS}).`);
  }
  return rows;
}

/** Detecta Excel vs PDF pelo conteúdo (ZIP/xlsx vs %PDF). */
export async function parseMeasurementsFile(buffer: Buffer, filename = ""): Promise<ParsedExcelRow[]> {
  const lower = filename.toLowerCase();
  const isPdf =
    lower.endsWith(".pdf") ||
    buffer.subarray(0, 4).toString("utf8") === "%PDF";
  if (isPdf) return parseMeasurementsPdf(buffer);
  return parseMeasurementsExcel(buffer);
}

function flattenLibrary(library: TemplateChapter[]) {
  return library.flatMap((ch) =>
    ch.items.map((item) => ({
      code: item.code,
      description: item.description,
      unit: item.unit as Unit,
      chapterCode: ch.code,
      composition: item.composition,
      compositionId: item.compositionId ?? null,
    })),
  );
}

function scoreDescription(a: string, b: string): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  // Substring só se ambos forem suficientemente longos (evita "Betão" → tudo)
  if (na.length >= MIN_DESC_LEN_FOR_FUZZY && nb.length >= MIN_DESC_LEN_FOR_FUZZY) {
    if (na.includes(nb) || nb.includes(na)) return 0.88;
  }
  const ta = new Set(na.split(/\s+/).filter((t) => t.length > 2));
  const tb = new Set(nb.split(/\s+/).filter((t) => t.length > 2));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.max(ta.size, tb.size);
}

/** Código do catálogo SIGO não deve “roubar” a composição se a descrição do mapa for de outro domínio. */
export function catalogCompositionUntrusted(
  sourceDescription: string,
  catalogDescription: string,
  compositionName: string | null,
): boolean {
  const target = [catalogDescription, compositionName].filter(Boolean).join(" · ");
  if (constructionDomainsConflict(sourceDescription, target)) return true;
  const score = scoreDescription(sourceDescription, catalogDescription);
  // Código igual mas textos sem overlap relevante → não herdar composição do modelo.
  if (score < 0.35 && normalizeText(sourceDescription).length >= 12) return true;
  return false;
}

const CODE_COLLISION_NOTE =
  "Código igual ao catálogo SIGO — nesta medição mantém-se a descrição e composição do mapa (não a do modelo)";

export async function previewMeasurementsImport(
  documentId: string,
  buffer: Buffer,
  companyId: string,
  filename = "",
): Promise<MeasurementImportPreview> {
  const parsed = await parseMeasurementsFile(buffer, filename);
  const sections = await db.select().from(budgetSections).where(eq(budgetSections.documentId, documentId));
  if (!sections.length) throw new Error("O documento não tem secções.");

  const sectionIds = sections.map((s) => s.id);
  const docItems = await db
    .select()
    .from(lineItems)
    .where(and(inArray(lineItems.sectionId, sectionIds), eq(lineItems.kind, "item")));

  const library = await loadWorkChapterLibrary(companyId);
  const libItems = flattenLibrary(library);
  const compositionByCode = new Map(
    libItems.map((item) => [
      item.code,
      { name: item.composition ?? null, id: item.compositionId ?? null },
    ]),
  );

  const catalogMap = new Map<
    string,
    {
      code: string;
      description: string;
      unit: Unit;
      itemId: string | null;
      chapterCode: string;
      compositionName: string | null;
      compositionId: string | null;
    }
  >();
  for (const item of libItems) {
    catalogMap.set(item.code, {
      code: item.code,
      description: item.description,
      unit: item.unit,
      itemId: null,
      chapterCode: item.chapterCode,
      compositionName: item.composition ?? null,
      compositionId: item.compositionId ?? null,
    });
  }
  for (const item of docItems) {
    if (!item.code) continue;
    const fromLib = compositionByCode.get(item.code);
    catalogMap.set(item.code, {
      code: item.code,
      description: item.description,
      unit: (item.unit as Unit) ?? "un",
      itemId: item.id,
      chapterCode: chapterCodeOf(item.code),
      compositionName: fromLib?.name ?? null,
      compositionId: item.compositionId ?? fromLib?.id ?? null,
    });
  }
  const catalog = [...catalogMap.values()];

  const byCode = new Map(catalog.map((c) => [c.code, c]));

  function enrichMatch(
    row: ParsedExcelRow,
    target: {
      code: string;
      description: string;
      itemId: string | null;
      compositionName: string | null;
      compositionId: string | null;
    },
    matchMethod: ImportPreviewRow["matchMethod"],
    confidence: number,
    note: string | null,
  ): ImportPreviewRow {
    const compositionName = target.compositionName;
    const compositionId = target.compositionId;
    const filePrice = row.unitPrice != null && row.unitPrice > 0;
    let priceSource: ImportPreviewRow["priceSource"] = "none";
    let noteOut = note;
    if (filePrice) priceSource = "file";
    else if (compositionName || compositionId) {
      priceSource = "composition";
      noteOut = note
        ? `${note} · Preço via composição SIGO`
        : "Preço será calculado pela composição SIGO (o ficheiro não traz preço unitário)";
    }
    return {
      ...row,
      action: "map" as const,
      targetCode: target.code,
      targetItemId: target.itemId,
      targetDescription: target.description,
      matchMethod,
      confidence,
      note: noteOut,
      compositionName,
      compositionId,
      priceSource,
      codeCollision: false,
      needsReview: false,
      willCreateComposition: false,
    };
  }

  const rows: ImportPreviewRow[] = [];

  for (const row of parsed) {
    const exact = byCode.get(row.code);
    if (exact) {
      const untrusted = catalogCompositionUntrusted(row.description, exact.description, exact.compositionName);
      if (untrusted) {
        // Código igual: reutiliza o código nesta medição, mas descrição/composição vêm do mapa
        // (não do modelo SIGO). Se o item já existir no documento, o apply actualiza só esse item.
        const collisionRow = enrichMatch(
          row,
          {
            code: exact.code,
            description: row.description || exact.description,
            itemId: exact.itemId,
            compositionName: null,
            compositionId: null,
          },
          "code",
          0.45,
          CODE_COLLISION_NOTE,
        );
        collisionRow.codeCollision = true;
        collisionRow.needsReview = true;
        rows.push(collisionRow);
        continue;
      }
      rows.push(enrichMatch(row, exact, "code", 1, null));
      continue;
    }

    let best: (typeof catalog)[number] & { score: number } | null = null;
    for (const c of catalog) {
      if (catalogCompositionUntrusted(row.description, c.description, c.compositionName)) continue;
      const score = scoreDescription(row.description, c.description);
      if (score >= DESC_MATCH_FLOOR && (!best || score > best.score)) best = { ...c, score };
    }
    if (best) {
      const descRow = enrichMatch(row, best, "description", best.score, "Match por descrição — confirme antes de aplicar");
      descRow.needsReview = true;
      rows.push(descRow);
      continue;
    }

    rows.push({
      ...row,
      action: "create",
      targetCode: row.code,
      targetItemId: null,
      targetDescription: row.description || null,
      matchMethod: "none",
      confidence: 0,
      note: row.unitPrice
        ? "Será criado com composição (preço do ficheiro se existir)"
        : "Será criado com composição SIGO nova ou existente — preço calculado automaticamente",
      compositionName: null,
      compositionId: null,
      priceSource: row.unitPrice ? "file" : "composition",
      codeCollision: false,
      needsReview: true,
      willCreateComposition: false,
    });
  }

  // Enriquecer com composições — um único carregamento do catálogo (evita N queries).
  const compositionResources = await loadImportCompositionResources(companyId);
  const companyMemory = await loadCompanyImportMemory(companyId);
  const compositionPreviewCache = new Map<string, Awaited<ReturnType<typeof previewCompositionForImport>>>();

  for (const row of rows) {
    // Memória da empresa: preferir composição já confirmada em importações anteriores.
    if (!row.compositionId) {
      const mem = lookupImportMemory(companyMemory, row.code, row.description);
      if (mem) {
        row.compositionId = mem.compositionId;
        row.compositionName = mem.compositionName;
        row.willCreateComposition = false;
        row.priceSource = row.unitPrice ? "file" : "composition";
        row.note = row.note
          ? `${row.note} · Memória da empresa: ${mem.compositionName}`
          : `Composição da memória da empresa: ${mem.compositionName}`;
        row.needsReview = row.codeCollision || row.matchMethod === "description" || row.matchMethod === "none";
        continue;
      }
    }

    if (row.matchMethod !== "none" && row.compositionName) {
      row.codeCollision = Boolean(row.note?.includes("nesta medição mantém-se") || row.note === CODE_COLLISION_NOTE);
      row.needsReview = row.codeCollision || row.matchMethod === "description" || row.confidence < 0.7;
      row.willCreateComposition = false;
      continue;
    }
    const cacheKey = `${row.targetCode || row.code}|${normalizeText(row.description).slice(0, 80)}|${row.unit}`;
    let previewComp = compositionPreviewCache.get(cacheKey);
    if (!previewComp) {
      previewComp = await previewCompositionForImport(
        companyId,
        {
          code: row.targetCode || row.code,
          description: row.description || row.code,
          unit: row.unit,
          preferredCompositionName: row.compositionName,
          preferredCompositionId: row.compositionId,
        },
        compositionResources,
      );
      compositionPreviewCache.set(cacheKey, previewComp);
    }
    if (row.matchMethod === "none" || !row.compositionName) {
      row.compositionName = previewComp.compositionName;
      row.compositionId = previewComp.compositionId;
      row.priceSource = row.unitPrice ? "file" : "composition";
      row.willCreateComposition = !previewComp.matched;
      if (row.matchMethod === "none") {
        row.note = previewComp.matched
          ? `Composição existente: ${previewComp.compositionName}`
          : `Será criada composição nova: ${previewComp.compositionName} — verifique rendimentos e insumos no Catálogo após aplicar`;
      } else if (!row.note?.includes("descrição") && row.note !== CODE_COLLISION_NOTE) {
        row.note = previewComp.matched
          ? `Composição pela descrição: ${previewComp.compositionName}`
          : `Nova composição pela descrição: ${previewComp.compositionName}`;
      } else if (previewComp.compositionName) {
        row.note = `${row.note} · Comp.: ${previewComp.compositionName}`;
      }
    }
    row.codeCollision = row.note === CODE_COLLISION_NOTE || Boolean(row.note?.startsWith(CODE_COLLISION_NOTE));
    row.needsReview =
      row.codeCollision ||
      row.willCreateComposition ||
      row.matchMethod === "description" ||
      row.matchMethod === "none" ||
      row.confidence < 0.7;
  }

  const compositionOptions = compositionResources.compositions
    .filter((c) => normalizeText(c.category || "") !== normalizeText("Biblioteca de referência"))
    .map((c) => ({
      id: c.id,
      name: c.name,
      category: c.category ?? null,
      outputUnit: c.outputUnit,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt"));

  // Match por código/descrição/SIGO apenas — sem chamada externa (mais rápido e estável).
  return { rows, catalog, compositionOptions, aiUsed: false, aiError: null, rowsRead: parsed.length };
}

/** Extrai o snapshot estável das linhas parseadas (para apply sem re-extrair PDF). */
export function parsedRowsFromPreview(preview: MeasurementImportPreview): ParsedExcelRow[] {
  return preview.rows.map((row) => ({
    rowKey: row.rowKey,
    sheet: row.sheet,
    rowNumber: row.rowNumber,
    code: row.code,
    quantity: row.quantity,
    description: row.description,
    unitRaw: row.unitRaw,
    unit: row.unit,
    scope: row.scope,
    unitPrice: row.unitPrice,
  }));
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function nextSortOrder(tx: Tx, sectionId: string, parentId: string | null): Promise<number> {
  const [row] = await tx
    .select({ value: max(lineItems.sortOrder) })
    .from(lineItems)
    .where(and(eq(lineItems.sectionId, sectionId), parentId ? eq(lineItems.parentId, parentId) : isNull(lineItems.parentId)));
  return (row?.value ?? -1) + 1;
}

type LibraryIndex = {
  itemByCode: Map<string, ReturnType<typeof flattenLibrary>[number]>;
  chapterByCode: Map<string, TemplateChapter>;
};

async function loadLibraryIndex(companyId: string): Promise<LibraryIndex> {
  const library = await loadWorkChapterLibrary(companyId);
  return {
    itemByCode: new Map(flattenLibrary(library).map((i) => [i.code, i])),
    chapterByCode: new Map(library.map((c) => [c.code, c])),
  };
}

async function ensureChapter(
  tx: Tx,
  sectionId: string,
  chapterCode: string,
  index: LibraryIndex,
  fallbackName?: string,
): Promise<string | null> {
  const safeChapter = chapterCode.slice(0, MAX_CHAPTER_CODE_LEN);
  const [existing] = await tx
    .select()
    .from(lineItems)
    .where(and(eq(lineItems.sectionId, sectionId), eq(lineItems.code, safeChapter), eq(lineItems.kind, "capitulo")))
    .limit(1);
  if (existing) return existing.id;

  const template = index.chapterByCode.get(safeChapter);
  const [created] = await tx
    .insert(lineItems)
    .values({
      sectionId,
      parentId: null,
      kind: "capitulo",
      code: safeChapter,
      description: template?.name ?? fallbackName ?? `Capítulo ${safeChapter}`,
      sortOrder: await nextSortOrder(tx, sectionId, null),
      origin: "manual",
    })
    .returning();
  return created.id;
}

async function createLineItemFromImport(
  tx: Tx,
  sectionId: string,
  code: string,
  description: string,
  unit: string,
  companyId: string,
  index: LibraryIndex,
  compositionCache: Map<string, ResolvedImportComposition>,
  resourcesCache: ImportResourcesCache,
  preferredOverride?: { compositionName?: string | null; compositionId?: string | null; forceCreate?: boolean },
): Promise<{
  itemId: string;
  compositionId: string;
  compositionName: string;
  unitPrice: number;
  compositionCreated: boolean;
}> {
  const safeCode = code.slice(0, MAX_CODE_LEN);
  const template = index.itemByCode.get(safeCode);
  const chapterCode = chapterCodeOf(safeCode);
  const chapterId = await ensureChapter(tx, sectionId, chapterCode, index);
  const zoneId = await getZoneIdForSection(sectionId);
  const desc = description || template?.description || safeCode;

  let preferredName = preferredOverride?.compositionName ?? template?.composition ?? null;
  let preferredId = preferredOverride?.compositionId ?? template?.compositionId ?? null;
  if (preferredOverride?.forceCreate) {
    preferredName = null;
    preferredId = null;
  } else if (
    !preferredOverride?.compositionId &&
    template &&
    catalogCompositionUntrusted(desc, template.description, template.composition ?? null)
  ) {
    // Não herdar composição do modelo SIGO quando o código colide semanticamente.
    preferredName = mapDescriptionToSigoComposition(desc, unit)?.compositionName ?? null;
    preferredId = null;
  }

  const resolved = await resolveOrCreateCompositionForImport(
    tx,
    companyId,
    {
      code: safeCode,
      description: desc,
      unit: normalizeUnit(unit, template?.unit ?? "un"),
      preferredCompositionName: preferredName,
      preferredCompositionId: preferredId,
    },
    zoneId,
    compositionCache,
    resourcesCache,
    preferredOverride?.forceCreate ? { forceCreate: true } : undefined,
  );

  const [item] = await tx
    .insert(lineItems)
    .values({
      sectionId,
      parentId: chapterId,
      kind: "item",
      code: safeCode,
      description: desc.slice(0, 2000),
      unit: normalizeUnit(unit, template?.unit ?? "un"),
      compositionId: resolved.compositionId,
      unitPrice: resolved.unitPrice.toFixed(2),
      sortOrder: await nextSortOrder(tx, sectionId, chapterId),
      origin: "composicao",
    })
    .returning();
  return {
    itemId: item.id,
    compositionId: resolved.compositionId,
    compositionName: resolved.compositionName,
    unitPrice: resolved.unitPrice,
    compositionCreated: resolved.created,
  };
}

function resolveSectionId(
  row: { scope: string; sheet: string },
  sections: typeof budgetSections.$inferSelect[],
  sectionByNormalizedName: Map<string, string>,
): string | null {
  const fromScope = row.scope ? sectionByNormalizedName.get(normalizeText(row.scope)) : undefined;
  if (fromScope) return fromScope;
  const fromSheet = sectionByNormalizedName.get(normalizeText(row.sheet));
  if (fromSheet) return fromSheet;
  // Só assume a primeira secção quando o documento tem exactamente uma.
  if (sections.length === 1) return sections[0].id;
  return null;
}

async function ensureSectionsForSheets(
  documentId: string,
  sheets: string[],
  existing: typeof budgetSections.$inferSelect[],
): Promise<typeof budgetSections.$inferSelect[]> {
  const sections = [...existing];
  const byName = new Map(sections.map((s) => [normalizeText(s.name), s]));
  let sortOrder = sections.reduce((maxOrder, s) => Math.max(maxOrder, s.sortOrder ?? 0), -1) + 1;
  const uniqueSheets = [...new Set(sheets.map((s) => s.trim()).filter(Boolean))];

  // Se há várias folhas e só uma secção genérica vazia (import), renomeia a primeira.
  if (uniqueSheets.length > 1 && sections.length === 1) {
    const only = sections[0];
    const itemCount = await db
      .select({ id: lineItems.id })
      .from(lineItems)
      .where(eq(lineItems.sectionId, only.id))
      .limit(1);
    if (!itemCount.length) {
      const [updated] = await db
        .update(budgetSections)
        .set({ name: uniqueSheets[0].slice(0, 200) })
        .where(eq(budgetSections.id, only.id))
        .returning();
      sections[0] = updated;
      byName.clear();
      byName.set(normalizeText(updated.name), updated);
    }
  }

  for (const sheet of uniqueSheets) {
    const key = normalizeText(sheet);
    if (byName.has(key)) continue;
    // Folhas PDF paginadas ("PDF p.1") partilham uma secção "PDF"
    if (/^pdf(\s*p\.?\s*\d+)?$/i.test(sheet.trim())) {
      const pdfKey = normalizeText("PDF");
      if (byName.has(pdfKey)) continue;
      const [created] = await db
        .insert(budgetSections)
        .values({ documentId, name: "PDF", sortOrder: sortOrder++, templateKey: "import_pdf_v1" })
        .returning();
      sections.push(created);
      byName.set(pdfKey, created);
      continue;
    }
    const [created] = await db
      .insert(budgetSections)
      .values({
        documentId,
        name: sheet.slice(0, 200),
        sortOrder: sortOrder++,
        templateKey: "import_sheet_v1",
      })
      .returning();
    sections.push(created);
    byName.set(key, created);
  }
  return sections;
}

async function applyQuantityAndComposition(
  tx: Tx,
  itemId: string,
  row: ParsedExcelRow,
  companyId: string,
  sectionId: string,
  preferred: { compositionName?: string | null; compositionId?: string | null },
  compositionCache: Map<string, ResolvedImportComposition>,
  resourcesCache: ImportResourcesCache,
  forceCreate = false,
): Promise<{
  compositionCreated: boolean;
  compositionLinked: boolean;
  compositionId: string;
  compositionName: string;
}> {
  await tx.delete(measurementLines).where(eq(measurementLines.lineItemId, itemId));
  await tx.insert(measurementLines).values({
    lineItemId: itemId,
    description: `Medição importada (folha "${row.sheet}", linha ${row.rowNumber})`,
    count: row.quantity.toFixed(2),
    sortOrder: 0,
  });

  const zoneId = await getZoneIdForSection(sectionId);
  const resolved = await resolveOrCreateCompositionForImport(
    tx,
    companyId,
    {
      code: row.code,
      description: row.description || row.code,
      unit: row.unit,
      preferredCompositionName: preferred.compositionName ?? null,
      preferredCompositionId: preferred.compositionId ?? null,
    },
    zoneId,
    compositionCache,
    resourcesCache,
    forceCreate ? { forceCreate: true } : undefined,
  );

  // Preço do ficheiro ganha se existir; senão usa o da composição.
  const unitPrice =
    row.unitPrice != null && Number.isFinite(row.unitPrice) && row.unitPrice > 0
      ? row.unitPrice
      : resolved.unitPrice;

  // Descrição/unidade do mapa ficam neste item do documento (medição local),
  // mesmo quando o código coincidia com outro significado no catálogo SIGO.
  await tx
    .update(lineItems)
    .set({
      description: (row.description || row.code).slice(0, 2000),
      unit: normalizeUnit(row.unit, "un"),
      quantity: row.quantity.toFixed(2),
      compositionId: resolved.compositionId,
      unitPrice: unitPrice.toFixed(2),
      origin: "composicao",
    })
    .where(eq(lineItems.id, itemId));

  return {
    compositionCreated: resolved.created,
    compositionLinked: true,
    compositionId: resolved.compositionId,
    compositionName: resolved.compositionName,
  };
}

export async function saveItemsToCompanyTemplate(
  companyId: string,
  items: Array<{
    code: string;
    description: string;
    unit: Unit;
    chapterName?: string;
    compositionId?: string | null;
    compositionName?: string | null;
  }>,
  options: { overwriteExisting?: boolean } = {},
): Promise<number> {
  const overwriteExisting = options.overwriteExisting === true;
  let saved = 0;
  for (const item of items) {
    const safeCode = item.code.slice(0, MAX_CODE_LEN);
    const chapterCode = chapterCodeOf(safeCode);
    const templateKey = `company:${companyId}:${chapterCode}:${safeCode}`;
    const [existing] = await db.select().from(workItemTemplates).where(eq(workItemTemplates.templateKey, templateKey)).limit(1);
    if (existing) {
      if (!overwriteExisting) continue;
      await db
        .update(workItemTemplates)
        .set({
          description: item.description || existing.description,
          unit: item.unit,
          chapterName: item.chapterName || existing.chapterName,
          compositionId: item.compositionId ?? existing.compositionId,
          compositionName: item.compositionName ?? existing.compositionName,
          isActive: true,
        })
        .where(eq(workItemTemplates.id, existing.id));
    } else {
      await db.insert(workItemTemplates).values({
        companyId,
        templateKey,
        chapterName: item.chapterName || `Capítulo ${chapterCode}`,
        chapterCode,
        itemCode: safeCode,
        description: item.description || `Item ${safeCode}`,
        unit: item.unit,
        compositionId: item.compositionId ?? null,
        compositionName: item.compositionName ?? null,
        discipline: "outro",
        detectionTags: [],
        requiresTagMatch: false,
        chapterSortOrder: Number(chapterCode) || 100,
        sortOrder: saved,
        version: 1,
        isActive: true,
      });
    }
    saved++;
  }
  return saved;
}

function validateDecisionsAgainstRows(parsed: ParsedExcelRow[], decisions: ImportApplyDecision[]) {
  if (!decisions.length) {
    throw new Error("É necessário confirmar as decisões de importação para cada linha.");
  }
  const parsedKeys = new Set(parsed.map((r) => r.rowKey));
  const decisionKeys = new Set<string>();
  for (const d of decisions) {
    if (!parsedKeys.has(d.rowKey)) {
      throw new Error(`Decisão inválida: linha desconhecida (${d.rowKey}).`);
    }
    if (decisionKeys.has(d.rowKey)) {
      throw new Error(`Decisão duplicada para a linha ${d.rowKey}.`);
    }
    decisionKeys.add(d.rowKey);
    if (d.action === "map" && !(d.targetCode || "").trim()) {
      throw new Error(`Linha ${d.rowKey}: mapeamento exige código destino.`);
    }
    if (d.action === "create" && (d.targetCode || "").trim().length > MAX_CODE_LEN) {
      throw new Error(`Linha ${d.rowKey}: código destino demasiado longo.`);
    }
  }
  for (const key of parsedKeys) {
    if (!decisionKeys.has(key)) {
      throw new Error("Faltam decisões para algumas linhas do Excel. Reabra a pré-visualização.");
    }
  }
}

export async function applyMeasurementsImport(
  documentId: string,
  buffer: Buffer,
  companyId: string,
  decisions: ImportApplyDecision[],
  options: { saveToCompanyTemplate?: boolean; filename?: string; parsedRows?: ParsedExcelRow[] } = {},
): Promise<MeasurementImportResult> {
  // Preferir snapshot do preview (evita re-extrair PDF e divergência de rowKeys).
  const parsed =
    options.parsedRows && options.parsedRows.length > 0
      ? options.parsedRows
      : await parseMeasurementsFile(buffer, options.filename ?? "");
  validateDecisionsAgainstRows(parsed, decisions);
  const decisionByKey = new Map(decisions.map((d) => [d.rowKey, d]));

  let sections = await db.select().from(budgetSections).where(eq(budgetSections.documentId, documentId));
  if (!sections.length) throw new Error("O documento não tem secções.");
  sections = await ensureSectionsForSheets(
    documentId,
    parsed.map((r) => r.sheet),
    sections,
  );
  const sectionByNormalizedName = new Map(sections.map((s) => [normalizeText(s.name), s.id]));
  // Mapear "PDF p.N" → secção PDF
  const pdfSection = sectionByNormalizedName.get(normalizeText("PDF"));
  if (pdfSection) {
    for (const s of sections) {
      if (/^pdf\s*p\.?\s*\d+$/i.test(s.name)) sectionByNormalizedName.set(normalizeText(s.name), s.id);
    }
    for (const row of parsed) {
      if (/^pdf(\s*p\.?\s*\d+)?$/i.test(row.sheet)) {
        sectionByNormalizedName.set(normalizeText(row.sheet), pdfSection);
      }
    }
  }
  const sectionIds = sections.map((s) => s.id);
  const index = await loadLibraryIndex(companyId);
  const companyMemory = await loadCompanyImportMemory(companyId);

  const docItems = await db.select().from(lineItems).where(and(inArray(lineItems.sectionId, sectionIds), eq(lineItems.kind, "item")));

  type DocItem = (typeof docItems)[number];
  const itemsByCode = new Map(docItems.filter((i) => i.code).map((i) => [i.code!, i]));
  const itemsById = new Map(docItems.map((i) => [i.id, i]));

  const unmatched: MeasurementImportResult["unmatched"] = [];
  const resolved: {
    row: ParsedExcelRow;
    itemId: string;
    created: boolean;
    sectionId: string;
    targetCode: string;
    compositionId?: string | null;
    compositionName?: string | null;
    forceCreateComposition?: boolean;
  }[] = [];
  const createdForTemplate: Array<{ code: string; description: string; unit: Unit; compositionId?: string | null; compositionName?: string | null }> = [];
  const saveToTemplate = options.saveToCompanyTemplate === true;
  let compositionsLinked = 0;
  const memoryLinks: Array<{ code: string; description: string; compositionId: string }> = [];
  const createdCompositionsById = new Map<string, CreatedImportComposition>();

  function trackCreatedComposition(id: string, name: string, itemCode: string) {
    const existing = createdCompositionsById.get(id);
    if (existing) {
      if (!existing.itemCodes.includes(itemCode)) existing.itemCodes.push(itemCode);
      return;
    }
    createdCompositionsById.set(id, { id, name, itemCodes: [itemCode] });
  }

  await db.transaction(async (tx) => {
    const liveByCode = new Map(itemsByCode);
    const liveById = new Map(itemsById);
    const compositionCache = new Map<string, ResolvedImportComposition>();
    const resourcesCache: ImportResourcesCache = { current: null };

    for (const row of parsed) {
      const decision = decisionByKey.get(row.rowKey);
      if (!decision) {
        throw new Error(`Falta decisão para a linha ${row.rowKey}.`);
      }
      if (decision.action === "ignore") continue;

      if (!isValidImportQuantity(row.quantity)) {
        unmatched.push({
          sheet: row.sheet,
          rowNumber: row.rowNumber,
          code: row.code,
          quantity: row.quantity,
          reason: "quantidade inválida",
        });
        continue;
      }

      const sectionId = resolveSectionId(row, sections, sectionByNormalizedName);
      if (!sectionId) {
        unmatched.push({
          sheet: row.sheet,
          rowNumber: row.rowNumber,
          code: row.code,
          quantity: row.quantity,
          reason: "secção não identificada (documento com várias secções — use o nome da folha/âmbito)",
        });
        continue;
      }

      const targetCode =
        decision.action === "map"
          ? (decision.targetCode || row.code).trim().slice(0, MAX_CODE_LEN)
          : (decision.targetCode || row.code).trim().slice(0, MAX_CODE_LEN);

      let item: DocItem | undefined;
      if (decision.action === "map" && decision.targetItemId) {
        const byId = liveById.get(decision.targetItemId);
        if (byId && byId.code === targetCode) item = byId;
      }
      if (!item) item = liveByCode.get(targetCode);

      if (!item) {
        const created = await createLineItemFromImport(
          tx,
          sectionId,
          targetCode,
          row.description,
          row.unit,
          companyId,
          index,
          compositionCache,
          resourcesCache,
          {
            compositionId: decision.compositionId,
            compositionName: decision.compositionName,
            forceCreate: decision.forceCreateComposition === true,
          },
        );
        item = { id: created.itemId, code: targetCode, origin: "composicao", compositionId: created.compositionId } as DocItem;
        liveByCode.set(targetCode, item);
        liveById.set(created.itemId, item);
        resolved.push({
          row,
          itemId: created.itemId,
          created: true,
          sectionId,
          targetCode,
          compositionId: decision.compositionId,
          compositionName: decision.compositionName,
          forceCreateComposition: decision.forceCreateComposition,
        });
        createdForTemplate.push({
          code: targetCode,
          description: row.description || targetCode,
          unit: row.unit,
          compositionId: created.compositionId,
          compositionName: created.compositionName,
        });
        if (created.compositionCreated) {
          trackCreatedComposition(created.compositionId, created.compositionName, targetCode);
        }
      } else {
        resolved.push({
          row,
          itemId: item.id,
          created: false,
          sectionId,
          targetCode,
          compositionId: decision.compositionId,
          compositionName: decision.compositionName,
          forceCreateComposition: decision.forceCreateComposition,
        });
      }
    }

    const rowsByItemId = new Map<string, typeof resolved>();
    for (const r of resolved) {
      const list = rowsByItemId.get(r.itemId) ?? [];
      list.push(r);
      rowsByItemId.set(r.itemId, list);
    }

    for (const [itemId, group] of rowsByItemId) {
      const totalQty = group.reduce((sum, g) => sum + g.row.quantity, 0);
      if (!isValidImportQuantity(totalQty)) {
        throw new Error(`Quantidade agregada inválida para o item ${itemId}.`);
      }
      const primary = { ...group[0].row, quantity: totalQty, code: group[0].targetCode };
      const template = index.itemByCode.get(group[0].targetCode);
      const overrideId = group.find((g) => g.compositionId)?.compositionId;
      const overrideName = group.find((g) => g.compositionName)?.compositionName;
      const forceCreate = group.some((g) => g.forceCreateComposition);

      let preferredName = overrideName ?? template?.composition ?? null;
      let preferredId = overrideId ?? template?.compositionId ?? null;
      if (forceCreate) {
        preferredName = null;
        preferredId = null;
      } else if (
        !overrideId &&
        template &&
        catalogCompositionUntrusted(primary.description, template.description, template.composition ?? null)
      ) {
        preferredName = mapDescriptionToSigoComposition(primary.description, primary.unit)?.compositionName ?? null;
        preferredId = null;
      }

      // Memória da empresa (aplica-se quando ainda não há composição preferida).
      if (!forceCreate && !preferredId) {
        const mem = lookupImportMemory(companyMemory, primary.code, primary.description);
        if (mem) {
          preferredId = mem.compositionId;
          preferredName = mem.compositionName;
        }
      }

      const result = await applyQuantityAndComposition(
        tx,
        itemId,
        primary,
        companyId,
        group[0].sectionId,
        {
          compositionName: preferredName,
          compositionId: preferredId,
        },
        compositionCache,
        resourcesCache,
        forceCreate,
      );
      // Itens novos já registaram a composição acima; aqui só itens existentes.
      if (!group.some((g) => g.created) && result.compositionCreated) {
        trackCreatedComposition(result.compositionId, result.compositionName, group[0].targetCode);
      }
      if (result.compositionLinked) {
        compositionsLinked++;
        memoryLinks.push({
          code: primary.code,
          description: primary.description,
          compositionId: result.compositionId,
        });
      }
    }
  });

  if (memoryLinks.length) {
    await rememberImportCompositionLinks(companyId, memoryLinks).catch(() => 0);
  }

  let templateItemsSaved = 0;
  if (saveToTemplate && createdForTemplate.length) {
    templateItemsSaved = await saveItemsToCompanyTemplate(companyId, createdForTemplate, { overwriteExisting: false });
  }

  const uniqueIds = new Set(resolved.map((r) => r.itemId));
  let itemsUpdated = 0;
  let createdUnique = 0;
  for (const id of uniqueIds) {
    if (resolved.some((r) => r.itemId === id && r.created)) createdUnique++;
    else itemsUpdated++;
  }

  const createdCompositions = Array.from(createdCompositionsById.values()).sort((a, b) =>
    a.name.localeCompare(b.name, "pt"),
  );

  return {
    itemsUpdated,
    itemsCreated: createdUnique,
    rowsRead: parsed.length,
    templateItemsSaved,
    compositionsCreated: createdCompositions.length,
    compositionsLinked,
    createdCompositions,
    unmatched,
  };
}

/** @deprecated Preferir preview + apply. Mantido só para testes internos; não auto-aplica IA. */
export async function importMeasurementsFromExcel(
  documentId: string,
  buffer: Buffer,
  companyId: string,
  options: MeasurementImportOptions = {},
): Promise<MeasurementImportResult> {
  const createMissing = options.createMissing !== false;
  const preview = await previewMeasurementsImport(documentId, buffer, companyId);
  const decisions: ImportApplyDecision[] = preview.rows.map((row) => {
    // Legado seguro: só mapeia por código exacto; descrição/IA → ignore ou create explícito
    if (row.matchMethod === "code") {
      return {
        rowKey: row.rowKey,
        action: "map",
        targetCode: row.targetCode,
        targetItemId: row.targetItemId,
      };
    }
    if (createMissing && row.matchMethod === "none") {
      return { rowKey: row.rowKey, action: "create", targetCode: row.code };
    }
    return { rowKey: row.rowKey, action: "ignore" };
  });
  return applyMeasurementsImport(documentId, buffer, companyId, decisions, {
    saveToCompanyTemplate: options.saveToCompanyTemplate === true,
  });
}

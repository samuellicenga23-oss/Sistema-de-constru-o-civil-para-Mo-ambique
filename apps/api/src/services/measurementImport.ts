import ExcelJS from "exceljs";
import { eq, and, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { budgetSections, lineItems, measurementLines } from "../db/schema.js";

// Importação de um Excel de medições já feitas à mão (ex: por um técnico de obra) — em vez de
// gerar quantidades por rácios (Assistente de Medições) ou medir item a item na régua, o
// utilizador carrega directamente o ficheiro com as quantidades reais e o sistema aplica-as aos
// itens-padrão já existentes pelo código (ex: "3.2"), sem duplicar nem criar itens novos — mesmo
// princípio já usado para plantas (Ronda 11): o dado importado ajusta o cálculo existente, não
// vira uma linha nova por si só.
//
// Ficheiros reais (ex: "BOQ CENTRO DE EXCELÊNCIA DE TUBERCULOSE DE MAPUTO") têm várias folhas —
// "RESUMO" (folha 1, sem itens com código próprio, só subtotais) e depois uma folha por secção/
// edifício ("P&G", "EDIFÍCIO PRINCIPAL", "ARRANJOS EXTERIORES", cada uma com o seu próprio
// cabeçalho ITEM/DESCRIÇÃO/UN/QUANT.) — por isso lê-se TODAS as folhas, nunca só a primeira.
//
// Dentro de UMA folha, é comum agrupar várias disciplinas (Arquitectura, Estrutura, Hidráulica,
// Electricidade...), cada uma reiniciando a sua própria numeração de capítulos a partir de "1" —
// o código "2.1" pode por isso aparecer várias vezes na mesma folha com significados totalmente
// diferentes. A âncora fiável encontrada em ficheiros reais para saber onde cada disciplina
// termina é a linha "SUBTOTAL - <disciplina>" (ex: "SUBTOTAL - ARQUITECTURA") — por isso cada
// linha de item é associada à disciplina do PRÓXIMO marcador deste tipo que aparece a seguir.

export type MeasurementImportResult = {
  itemsUpdated: number;
  rowsRead: number;
  unmatched: { sheet: string; rowNumber: number; code: string; quantity: number; reason: string }[];
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
const SUBTOTAL_DISCIPLINE = /^subtotal\s*-\s*(.+)$/i;

type SheetRow = { sheet: string; rowNumber: number; code: string; quantity: number; scope: string };

// Numa folha, procura o cabeçalho nas primeiras linhas em vez de assumir uma posição fixa — os
// ficheiros reais analisados (Dr Castro, Centro de Excelência TB, UEM) têm todos algumas linhas
// de capa/logótipo antes da tabela de itens propriamente dita. Devolve [] se a folha não tiver
// nenhum cabeçalho reconhecível (ex: uma folha de notas ou de outro conteúdo).
function readSheetRows(sheet: ExcelJS.Worksheet): SheetRow[] {
  let headerRow = -1;
  let codeCol = -1;
  let qtyCol = -1;
  for (let r = 1; r <= Math.min(20, sheet.rowCount); r++) {
    const row = sheet.getRow(r);
    let foundCode = -1;
    let foundQty = -1;
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const value = normalizeText(cell.value);
      if (foundCode === -1 && CODE_HEADERS.some((h) => value === h)) foundCode = colNumber;
      if (foundQty === -1 && QTY_HEADERS.some((h) => value.startsWith(h))) foundQty = colNumber;
    });
    if (foundCode !== -1 && foundQty !== -1) {
      headerRow = r;
      codeCol = foundCode;
      qtyCol = foundQty;
      break;
    }
  }
  if (headerRow === -1) return [];

  // Passo 1: recolhe os marcadores "SUBTOTAL - <disciplina>" e a sua linha, em ordem.
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
  // Cada linha de item pertence à disciplina do marcador seguinte (a linha ainda não chegou ao
  // fim dessa disciplina) — linhas depois do último marcador ficam sem disciplina conhecida.
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
    // Só códigos com "." (ex: "1.1", "3.6") — os capítulos/grupos (ex: "1", "3") aparecem também
    // na coluna de código nestes ficheiros mas nunca devem levar quantidade própria.
    if (!code || !code.includes(".") || !Number.isFinite(quantity)) continue;
    rows.push({ sheet: sheet.name, rowNumber: r, code, quantity, scope: scopeFor(r) });
  }
  return rows;
}

export async function importMeasurementsFromExcel(documentId: string, buffer: Buffer): Promise<MeasurementImportResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  if (workbook.worksheets.length === 0) throw new Error("O ficheiro Excel não tem nenhuma folha.");

  const rows = workbook.worksheets.flatMap(readSheetRows);
  if (rows.length === 0) {
    throw new Error(
      'Não foi possível encontrar as colunas "Item"/"Código" e "Quant." em nenhuma folha do ficheiro — confirme que o Excel tem estes cabeçalhos numa das primeiras 20 linhas de alguma folha.'
    );
  }

  const sections = await db.select().from(budgetSections).where(eq(budgetSections.documentId, documentId));
  const sectionIds = sections.map((s) => s.id);
  const codes = Array.from(new Set(rows.map((r) => r.code)));
  const items = sectionIds.length
    ? await db.select().from(lineItems).where(and(inArray(lineItems.sectionId, sectionIds), inArray(lineItems.code, codes)))
    : [];

  // Uma secção/edifício do documento pode corresponder ao nome da folha do Excel (ex: folha
  // "EDIFÍCIO PRINCIPAL" ↔ secção "Edifício Principal") OU ao nome da disciplina detectada dentro
  // da folha (ex: "ARQUITECTURA", "HIDRÁULICA") quando o utilizador estruturou o documento por
  // disciplina em vez de por edifício — testa-se primeiro a disciplina (mais específica), depois
  // o nome da folha, e só na ausência de qualquer um dos dois se procura o código em todo o
  // documento (aceitando-o só se for inequívoco).
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
  // Passo 1: resolve cada linha do Excel a, no máximo, um item-alvo.
  const resolved: { row: SheetRow; itemId: string }[] = [];
  for (const row of rows) {
    const matchedSectionId =
      (row.scope && sectionByNormalizedName.get(normalizeText(row.scope))) || sectionByNormalizedName.get(normalizeText(row.sheet));
    const candidates = matchedSectionId
      ? (itemsBySection.get(matchedSectionId) ?? []).filter((i) => i.code === row.code)
      : (itemsByCodeAcrossSections.get(row.code) ?? []);

    if (candidates.length === 0) {
      unmatched.push({ ...row, reason: "sem item correspondente neste Mapa de Quantidades" });
      continue;
    }
    if (candidates.length > 1) {
      unmatched.push({
        ...row,
        reason: `código existe em ${candidates.length} secções diferentes deste documento — renomeie a folha do Excel (ou a disciplina) para o nome exacto da secção certa`,
      });
      continue;
    }
    resolved.push({ row, itemId: candidates[0].id });
  }

  // Passo 2: mesmo depois de separar por disciplina, pode restar ambiguidade (ex: sub-listas "i.",
  // "ii." repetidas dentro da mesma disciplina, para itens-pai diferentes) — sem perceber essa
  // hierarquia mais funda, não é seguro adivinhar; se mais do que uma linha do Excel resolver
  // para o MESMO item do documento, nenhuma delas é aplicada automaticamente.
  const rowsByItemId = new Map<string, { row: SheetRow; itemId: string }[]>();
  for (const r of resolved) {
    const list = rowsByItemId.get(r.itemId) ?? [];
    list.push(r);
    rowsByItemId.set(r.itemId, list);
  }

  let itemsUpdated = 0;
  for (const [itemId, group] of rowsByItemId) {
    if (group.length > 1) {
      const locations = group.map((g) => `folha "${g.row.sheet}" linha ${g.row.rowNumber} (${g.row.quantity})`).join("; ");
      for (const g of group) {
        unmatched.push({
          ...g.row,
          reason: `o código "${g.row.code}" aparece em mais do que um sítio deste ficheiro a apontar para o mesmo item (${locations}) — confirme e insira manualmente`,
        });
      }
      continue;
    }
    const { row } = group[0];
    await db.delete(measurementLines).where(eq(measurementLines.lineItemId, itemId));
    await db.insert(measurementLines).values({
      lineItemId: itemId,
      description: `Medição importada do Excel (folha "${row.sheet}", linha ${row.rowNumber})`,
      count: row.quantity.toFixed(4),
      sortOrder: 0,
    });
    await db.update(lineItems).set({ quantity: row.quantity.toFixed(4), origin: "manual" }).where(eq(lineItems.id, itemId));
    itemsUpdated++;
  }

  return { itemsUpdated, rowsRead: rows.length, unmatched };
}

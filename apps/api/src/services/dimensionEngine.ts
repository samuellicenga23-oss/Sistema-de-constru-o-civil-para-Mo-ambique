import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { measurementLines, lineItems } from "../db/schema.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Parcial de uma linha de medição: nº × comprimento × largura × altura.
// Dimensões vazias contam como 1 (ex: um item medido só em comprimento usa Comp. e deixa Larg./Alt. vazios).
export function computePartial(line: {
  count: string | number;
  length: string | number | null;
  width: string | number | null;
  height: string | number | null;
}): number {
  const count = Number(line.count);
  const length = line.length !== null && line.length !== undefined ? Number(line.length) : 1;
  const width = line.width !== null && line.width !== undefined ? Number(line.width) : 1;
  const height = line.height !== null && line.height !== undefined ? Number(line.height) : 1;
  return count * length * width * height;
}

export async function getMeasurementLines(lineItemId: string, dbOrTx: Tx | typeof db = db) {
  const rows = await dbOrTx
    .select()
    .from(measurementLines)
    .where(eq(measurementLines.lineItemId, lineItemId))
    .orderBy(measurementLines.sortOrder);
  return rows.map((r) => ({ ...r, partial: computePartial(r) }));
}

// Recalcula a quantidade do item como a soma dos parciais e grava-a no line_item —
// gravada (não on-the-fly) para que exportações e autos de medição continuem a funcionar
// sem conhecer as linhas de medição. Se não restarem linhas, a quantidade fica como está
// (o utilizador pode voltar a editá-la manualmente).
export async function recomputeItemQuantity(lineItemId: string, dbOrTx: Tx | typeof db = db): Promise<number | null> {
  const lines = await getMeasurementLines(lineItemId, dbOrTx);
  if (lines.length === 0) return null;
  const total = lines.reduce((sum, l) => sum + l.partial, 0);
  await dbOrTx.update(lineItems).set({ quantity: total.toFixed(2) }).where(eq(lineItems.id, lineItemId));
  return total;
}

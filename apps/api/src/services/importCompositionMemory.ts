/**
 * Memória de importação por empresa: associa código/descrição do mapa a uma composição.
 * Usada no preview (preferência) e gravada no apply quando o utilizador confirma uma ligação.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { costCompositions, importCompositionMappings } from "../db/schema.js";

function normalizeMemoryText(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .slice(0, 180);
}

export function importMappingDescriptionKey(description: string): string {
  return `d:${normalizeMemoryText(description)}`;
}

export function importMappingCodeDescKey(code: string, description: string): string {
  const safeCode = String(code ?? "")
    .trim()
    .replace(/,/g, ".")
    .replace(/\s+/g, "")
    .slice(0, 30);
  return `c:${safeCode}|${normalizeMemoryText(description).slice(0, 140)}`;
}

export type ImportCompositionMemoryHit = {
  compositionId: string;
  compositionName: string;
  matchKey: string;
};

export type CompanyImportMemory = {
  byKey: Map<string, ImportCompositionMemoryHit>;
};

export async function loadCompanyImportMemory(companyId: string): Promise<CompanyImportMemory> {
  const rows = await db
    .select({
      matchKey: importCompositionMappings.matchKey,
      compositionId: importCompositionMappings.compositionId,
      compositionName: costCompositions.name,
    })
    .from(importCompositionMappings)
    .innerJoin(costCompositions, eq(costCompositions.id, importCompositionMappings.compositionId))
    .where(and(eq(importCompositionMappings.companyId, companyId), eq(costCompositions.isActive, true)));

  const byKey = new Map<string, ImportCompositionMemoryHit>();
  for (const row of rows) {
    byKey.set(row.matchKey, {
      compositionId: row.compositionId,
      compositionName: row.compositionName,
      matchKey: row.matchKey,
    });
  }
  return { byKey };
}

export function lookupImportMemory(
  memory: CompanyImportMemory,
  code: string,
  description: string,
): ImportCompositionMemoryHit | null {
  const codeKey = importMappingCodeDescKey(code, description);
  const byCode = memory.byKey.get(codeKey);
  if (byCode) return byCode;
  const descKey = importMappingDescriptionKey(description);
  if (normalizeMemoryText(description).length >= 8) {
    return memory.byKey.get(descKey) ?? null;
  }
  return null;
}

export async function rememberImportCompositionLinks(
  companyId: string,
  links: Array<{ code: string; description: string; compositionId: string }>,
): Promise<number> {
  if (!links.length) return 0;

  const compositionIds = [...new Set(links.map((l) => l.compositionId))];
  const owned = await db
    .select({ id: costCompositions.id })
    .from(costCompositions)
    .where(
      and(
        inArray(costCompositions.id, compositionIds),
        // Aceita composição da empresa ou catálogo partilhado (companyId null).
        sql`(${costCompositions.companyId} = ${companyId} OR ${costCompositions.companyId} IS NULL)`,
        eq(costCompositions.isActive, true),
      ),
    );
  const allowed = new Set(owned.map((o) => o.id));

  let saved = 0;
  const now = new Date();
  for (const link of links) {
    if (!allowed.has(link.compositionId)) continue;
    const keys = [
      { key: importMappingCodeDescKey(link.code, link.description), code: link.code, description: link.description },
      { key: importMappingDescriptionKey(link.description), code: link.code, description: link.description },
    ];
    for (const entry of keys) {
      if (entry.key.startsWith("d:") && normalizeMemoryText(entry.description).length < 8) continue;
      await db
        .insert(importCompositionMappings)
        .values({
          companyId,
          matchKey: entry.key,
          sourceCode: entry.code.slice(0, 30) || null,
          sourceDescription: entry.description.slice(0, 2000) || null,
          compositionId: link.compositionId,
          hitCount: 1,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [importCompositionMappings.companyId, importCompositionMappings.matchKey],
          set: {
            compositionId: link.compositionId,
            sourceCode: entry.code.slice(0, 30) || null,
            sourceDescription: entry.description.slice(0, 2000) || null,
            hitCount: sql`${importCompositionMappings.hitCount} + 1`,
            updatedAt: now,
          },
        });
      saved += 1;
    }
  }
  return saved;
}

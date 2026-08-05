/**
 * Lê os mapas de quantidades de referência do utilizador e grava templates
 * na biblioteca global, mapeando preferencialmente às composições SIGO clássicas.
 *
 * Uso: npm run db:seed-sample-boq-library  (em apps/api)
 */
import "dotenv/config";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, inArray, isNull, like, sql as dsql } from "drizzle-orm";
import { normalizeUnit, type Unit } from "@sigo/shared";
import { db, sql } from "./index.js";
import { costCompositions, lineItems, materials, workItemTemplates } from "./schema.js";
import { parseMeasurementsFile } from "../services/measurementImport.js";
import {
  resolveOrCreateCompositionForImport,
  type ImportResourcesCache,
  type ResolvedImportComposition,
} from "../services/importComposition.js";
import { mapDescriptionToSigoComposition } from "../services/sigoCompositionMap.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOWNLOADS = path.join(process.env.USERPROFILE || process.env.HOME || "", "Downloads");
const PLANT_VENV_PY = path.resolve(__dirname, "../../../plant-service/.venv/Scripts/python.exe");
const PLANT_DIR = path.resolve(__dirname, "../../../plant-service");

const SAMPLE_FILES = [
  "MAPA DE QUANTIDADES - EDIFICIO DR CASTRO.xlsx",
  "A2.-Mapa-de-Quantidades.xlsx",
  "mapa_de_qty.pdf",
  "Mapa-de-Quantidades-Estacao-Sismografica-Modelo-de-Mocambique.pdf",
];

const BLOCK_PRICES: Array<{ name: string; cost: number }> = [
  { name: "Bloco de cimento 20x20x40", cost: 33 },
  { name: "Bloco de cimento 15x20x40", cost: 26 },
];

type LibraryItem = {
  source: string;
  code: string;
  description: string;
  unit: Unit;
  chapterCode: string;
  chapterName: string;
};

function normalizeText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ");
}

function chapterMeta(code: string, source: string): { chapterCode: string; chapterName: string } {
  const root = (code.split(/[.\-]/)[0] || "R").slice(0, 10);
  const sourceShort = source.replace(/\.[^.]+$/, "").slice(0, 40);
  return {
    chapterCode: `R${root}`,
    chapterName: `Ref. ${sourceShort} — Cap. ${root}`,
  };
}

function parsePdfViaPlant(filePath: string): LibraryItem[] {
  if (!fs.existsSync(PLANT_VENV_PY)) {
    console.warn("Python plant-service não encontrado — a saltar PDF:", path.basename(filePath));
    return [];
  }
  const outPath = path.join(PLANT_DIR, "_tmp_boq_rows.json");
  const script = `
import json, sys
from pathlib import Path
sys.path.insert(0, r${JSON.stringify(PLANT_DIR)})
from boq_pdf_extract import extract_boq_from_pdf
data = Path(sys.argv[1]).read_bytes()
result = extract_boq_from_pdf(data)
Path(sys.argv[2]).write_text(json.dumps(result.get("rows") or [], ensure_ascii=False), encoding="utf-8")
print(len(result.get("rows") or []))
`;
  const tmp = path.join(PLANT_DIR, "_tmp_extract_boq.py");
  fs.writeFileSync(tmp, script, "utf8");
  try {
    const run = spawnSync(PLANT_VENV_PY, [tmp, filePath, outPath], {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      cwd: PLANT_DIR,
    });
    if (run.status !== 0) {
      console.warn("Falha PDF", path.basename(filePath), (run.stderr || run.stdout || "").slice(0, 400));
      return [];
    }
    const rows = JSON.parse(fs.readFileSync(outPath, "utf8")) as Array<{
      code?: string;
      description?: string;
      unit?: string;
      unitRaw?: string;
    }>;
    console.log(`  PDF ${path.basename(filePath)}: ${rows.length} linhas`);
    const source = path.basename(filePath);
    return rows
      .map((row) => {
        const code = String(row.code || "").trim();
        const description = String(row.description || "").trim();
        if (!code || !description) return null;
        const unit = normalizeUnit(row.unitRaw || row.unit || "un", "un");
        const meta = chapterMeta(code, source);
        return { source, code, description, unit, ...meta } satisfies LibraryItem;
      })
      .filter((x): x is LibraryItem => x != null);
  } finally {
    for (const p of [tmp, outPath]) {
      try {
        fs.unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
  }
}

async function parseExcelFile(filePath: string): Promise<LibraryItem[]> {
  const buffer = fs.readFileSync(filePath);
  const rows = await parseMeasurementsFile(buffer, path.basename(filePath));
  const source = path.basename(filePath);
  return rows.map((row) => {
    const meta = chapterMeta(row.code, source);
    return {
      source,
      code: row.code,
      description: row.description || row.code,
      unit: row.unit,
      ...meta,
    };
  });
}

async function collectItems(): Promise<LibraryItem[]> {
  const all: LibraryItem[] = [];
  for (const name of SAMPLE_FILES) {
    const filePath = path.join(DOWNLOADS, name);
    if (!fs.existsSync(filePath)) {
      console.warn("Ficheiro em falta:", filePath);
      continue;
    }
    console.log("A ler", name, "...");
    if (name.toLowerCase().endsWith(".pdf")) {
      all.push(...parsePdfViaPlant(filePath));
    } else {
      all.push(...(await parseExcelFile(filePath)));
    }
  }

  const unique = new Map<string, LibraryItem>();
  for (const item of all) {
    const key = normalizeText(item.description).slice(0, 160);
    if (!key || unique.has(key)) continue;
    unique.set(key, item);
  }
  return [...unique.values()];
}

async function updateBlockPrices() {
  for (const b of BLOCK_PRICES) {
    const updated = await db
      .update(materials)
      .set({ baseUnitCost: b.cost.toFixed(4), updatedAt: new Date() })
      .where(and(eq(materials.name, b.name), isNull(materials.companyId)))
      .returning({ id: materials.id });
    console.log(`Preço ${b.name} → ${b.cost} MZN (${updated.length ? "ok" : "não encontrado"})`);
  }
}

/** Remove stubs antigos da biblioteca de referência e limpa FKs. */
async function purgeOldReferenceCompositions() {
  const refs = await db
    .select({ id: costCompositions.id })
    .from(costCompositions)
    .where(and(isNull(costCompositions.companyId), eq(costCompositions.category, "Biblioteca de referência")));

  const ids = refs.map((r) => r.id);
  console.log(`A limpar ${ids.length} composições antigas «Biblioteca de referência»…`);
  if (!ids.length) return;

  await db
    .update(workItemTemplates)
    .set({ compositionId: null, compositionName: null })
    .where(and(isNull(workItemTemplates.companyId), like(workItemTemplates.templateKey, "global:ref:%")));

  // line_items.compositionId sem ON DELETE — anular antes de apagar.
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    await db.update(lineItems).set({ compositionId: null }).where(inArray(lineItems.compositionId, chunk));
  }

  await db.delete(costCompositions).where(inArray(costCompositions.id, ids));
  console.log("Limpeza concluída.");
}

export async function seedSampleBoqLibrary() {
  await updateBlockPrices();
  await purgeOldReferenceCompositions();

  const items = await collectItems();
  if (!items.length) {
    throw new Error("Nenhum item extraído dos mapas de referência.");
  }
  console.log(`Itens únicos a gravar na biblioteca: ${items.length}`);

  const compositionCache = new Map<string, ResolvedImportComposition>();
  const resourcesCache: ImportResourcesCache = { current: null };
  let compositionsCreated = 0;
  let compositionsLinked = 0;
  let mappedToSigo = 0;
  let templatesSaved = 0;
  const unmatchedSamples: string[] = [];

  for (const [index, item] of items.entries()) {
    const mapHit = mapDescriptionToSigoComposition(item.description, item.unit);
    if (mapHit) mappedToSigo++;
    else if (unmatchedSamples.length < 15) unmatchedSamples.push(item.description.slice(0, 90));

    const resolved = await resolveOrCreateCompositionForImport(
      db as unknown as Parameters<typeof resolveOrCreateCompositionForImport>[0],
      null,
      {
        code: item.code,
        description: item.description,
        unit: item.unit,
        preferredCompositionName: mapHit?.compositionName ?? null,
      },
      null,
      compositionCache,
      resourcesCache,
      {
        category: "Biblioteca de referência",
        sourceName: `Mapa: ${item.source}`,
      },
    );
    if (resolved.created) compositionsCreated++;
    else compositionsLinked++;

    const slug = normalizeText(item.description)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 70);
    const templateKey = `global:ref:${item.chapterCode}:${slug || item.code}`;
    const [existing] = await db
      .select({ id: workItemTemplates.id })
      .from(workItemTemplates)
      .where(and(isNull(workItemTemplates.companyId), eq(workItemTemplates.templateKey, templateKey)))
      .limit(1);

    const values = {
      companyId: null as string | null,
      templateKey,
      chapterCode: item.chapterCode,
      chapterName: item.chapterName,
      itemCode: item.code.slice(0, 30),
      description: item.description.slice(0, 2000),
      unit: item.unit,
      compositionId: resolved.compositionId,
      compositionName: resolved.compositionName,
      discipline: "outro" as const,
      detectionTags: ["referencia", "mapa-importado", mapHit ? "sigo-mapped" : "chapter-template"],
      requiresTagMatch: false,
      chapterSortOrder: 500 + Number(item.chapterCode.replace(/\D/g, "") || 0),
      sortOrder: index,
      version: 1,
      isActive: true,
    };

    if (existing) {
      await db
        .update(workItemTemplates)
        .set({
          description: values.description,
          unit: values.unit,
          compositionId: values.compositionId,
          compositionName: values.compositionName,
          chapterName: values.chapterName,
          detectionTags: values.detectionTags,
          isActive: true,
        })
        .where(eq(workItemTemplates.id, existing.id));
    } else {
      await db.insert(workItemTemplates).values(values);
    }
    templatesSaved++;
    if ((index + 1) % 25 === 0) {
      console.log(`  … ${index + 1}/${items.length}`);
    }
  }

  const refCount = await db
    .select({ n: dsql<number>`count(*)::int` })
    .from(costCompositions)
    .where(and(isNull(costCompositions.companyId), eq(costCompositions.category, "Biblioteca de referência")));

  console.log(
    JSON.stringify(
      {
        ok: true,
        items: items.length,
        mappedToSigoRule: mappedToSigo,
        compositionsCreated,
        compositionsReused: compositionsLinked,
        templatesSaved,
        remainingReferenceStubs: refCount[0]?.n ?? 0,
        unmatchedSample: unmatchedSamples,
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]).includes("seedSampleBoqLibrary")) {
  seedSampleBoqLibrary()
    .then(async () => {
      await sql.end({ timeout: 5 });
      process.exit(0);
    })
    .catch(async (err) => {
      console.error(err);
      try {
        await sql.end({ timeout: 5 });
      } catch {
        /* ignore */
      }
      process.exit(1);
    });
}

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { costCompositions, workItemTemplates } from "../db/schema.js";
import { requireRole } from "../auth/middleware.js";
import { loadWorkChapterLibrary } from "../services/boqTemplate.js";
import { parseMeasurementsExcel, saveItemsToCompanyTemplate } from "../services/measurementImport.js";
import { UNITS, normalizeUnit } from "@sigo/shared";

const ROLES = ["super_admin", "admin_empresa", "orcamentista"] as const;
const TEMPLATE_IMPORT_ROLES = ["admin_empresa"] as const;
const disciplineSchema = z.enum(["all", "arquitectura", "estrutura", "hidrossanitario", "electricidade", "outro"]);
const chapterSchema = z.object({
  code: z.string().trim().min(1).max(10),
  name: z.string().trim().min(2).max(200),
  discipline: disciplineSchema,
  detectionTags: z.array(z.string().trim().min(2).max(80)).max(30).default([]),
  requiresTagMatch: z.boolean().default(true),
  chapterSortOrder: z.number().int().min(0).max(999).default(100),
  items: z.array(z.object({
    code: z.string().trim().min(1).max(30),
    description: z.string().trim().min(2).max(2000),
    unit: z.enum(UNITS),
    compositionId: z.string().uuid().nullable().optional(),
  })).min(1).max(200),
});

function targetCompanyId(request: { currentUser?: { role: string; companyId: string | null } }) {
  return request.currentUser!.role === "super_admin" ? null : request.currentUser!.companyId!;
}

async function replaceChapter(companyId: string | null, input: z.infer<typeof chapterSchema>) {
  const itemCodes = new Set(input.items.map((item) => item.code));
  if (itemCodes.size !== input.items.length) throw new Error("Existem códigos de item repetidos neste capítulo.");

  const compositionIds = [...new Set(input.items.map((item) => item.compositionId).filter((id): id is string => !!id))];
  const compositions = compositionIds.length
    ? await db.select().from(costCompositions).where(or(
        isNull(costCompositions.companyId),
        ...(companyId ? [eq(costCompositions.companyId, companyId)] : []),
      ))
    : [];
  const compositionById = new Map(compositions.map((composition) => [composition.id, composition]));
  for (const compositionId of compositionIds) {
    if (!compositionById.has(compositionId)) throw new Error("Uma das composições escolhidas não está disponível.");
  }

  const scope = companyId ?? "global";
  const ownFilter = companyId ? eq(workItemTemplates.companyId, companyId) : isNull(workItemTemplates.companyId);
  const currentRows = await db.select({ version: workItemTemplates.version }).from(workItemTemplates)
    .where(and(ownFilter, eq(workItemTemplates.chapterCode, input.code)));
  const nextVersion = Math.max(0, ...currentRows.map((row) => row.version)) + 1;
  await db.transaction(async (tx) => {
    await tx.delete(workItemTemplates).where(and(ownFilter, eq(workItemTemplates.chapterCode, input.code)));
    await tx.insert(workItemTemplates).values(input.items.map((item, index) => ({
      companyId,
      templateKey: `${scope}:${input.code}:${item.code}`,
      chapterName: input.name,
      chapterCode: input.code,
      itemCode: item.code,
      description: item.description,
      unit: item.unit,
      compositionId: item.compositionId ?? null,
      compositionName: item.compositionId ? compositionById.get(item.compositionId)?.name ?? null : null,
      discipline: input.discipline,
      detectionTags: [...new Set(input.detectionTags.map((tag) => tag.toLocaleLowerCase("pt")))],
      requiresTagMatch: input.requiresTagMatch,
      chapterSortOrder: input.chapterSortOrder,
      sortOrder: index,
      version: nextVersion,
      isActive: true,
    })));
  });
}

export async function workChapterRoutes(app: FastifyInstance) {
  app.get("/api/catalog/work-chapters", { preHandler: requireRole(...ROLES) }, async (request) => {
    const companyId = request.currentUser!.companyId;
    return loadWorkChapterLibrary(companyId ?? "00000000-0000-0000-0000-000000000000");
  });

  app.post("/api/catalog/work-chapters", { preHandler: requireRole(...ROLES) }, async (request, reply) => {
    const parsed = chapterSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const companyId = targetCompanyId(request);
    try {
      await replaceChapter(companyId, parsed.data);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "Não foi possível guardar o capítulo." });
    }
    const rows = await loadWorkChapterLibrary(companyId ?? "00000000-0000-0000-0000-000000000000");
    return reply.code(201).send(rows.find((chapter) => chapter.code === parsed.data.code));
  });

  app.put("/api/catalog/work-chapters/:code", { preHandler: requireRole(...ROLES) }, async (request, reply) => {
    const { code } = request.params as { code: string };
    const parsed = chapterSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    if (parsed.data.code !== code) return reply.code(409).send({ error: "O código do capítulo não pode ser alterado durante a edição." });
    const companyId = targetCompanyId(request);
    try {
      await replaceChapter(companyId, parsed.data);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "Não foi possível actualizar o capítulo." });
    }
    const rows = await loadWorkChapterLibrary(companyId ?? "00000000-0000-0000-0000-000000000000");
    return rows.find((chapter) => chapter.code === code);
  });

  app.delete("/api/catalog/work-chapters/:code", { preHandler: requireRole(...ROLES) }, async (request, reply) => {
    const { code } = request.params as { code: string };
    const companyId = targetCompanyId(request);
    const ownFilter = companyId ? eq(workItemTemplates.companyId, companyId) : isNull(workItemTemplates.companyId);
    const own = await db.select({ id: workItemTemplates.id }).from(workItemTemplates)
      .where(and(ownFilter, eq(workItemTemplates.chapterCode, code))).limit(1);
    if (!own.length) return reply.code(409).send({ error: "Este capítulo é global. Edite-o para criar uma versão própria da empresa." });
    await db.delete(workItemTemplates).where(and(ownFilter, eq(workItemTemplates.chapterCode, code)));
    return { ok: true };
  });

  // Importa estrutura de itens a partir de um Excel para o template da empresa (admin only).
  app.post("/api/catalog/work-chapters/import-from-excel", { preHandler: requireRole(...TEMPLATE_IMPORT_ROLES) }, async (request, reply) => {
    const companyId = targetCompanyId(request);
    if (!companyId) return reply.code(400).send({ error: "O super_admin deve editar o catálogo global directamente." });
    const data = await request.file();
    if (!data) return reply.code(400).send({ error: "Ficheiro em falta" });
    const filename = (data.filename || "").toLowerCase();
    if (filename && !filename.endsWith(".xlsx") && !filename.endsWith(".xls")) {
      return reply.code(400).send({ error: "Só são aceites ficheiros Excel (.xlsx / .xls)." });
    }
    try {
      const rows = await parseMeasurementsExcel(await data.toBuffer());
      const unique = new Map<string, { code: string; description: string; unit: (typeof UNITS)[number] }>();
      for (const row of rows) {
        if (!unique.has(row.code)) {
          unique.set(row.code, {
            code: row.code,
            description: row.description || row.code,
            unit: normalizeUnit(row.unitRaw, row.unit),
          });
        }
      }
      // Não sobrescreve itens já existentes no template da empresa.
      const saved = await saveItemsToCompanyTemplate(companyId, [...unique.values()], { overwriteExisting: false });
      return { saved, rowsRead: rows.length, library: await loadWorkChapterLibrary(companyId) };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "Erro ao importar template" });
    }
  });
}

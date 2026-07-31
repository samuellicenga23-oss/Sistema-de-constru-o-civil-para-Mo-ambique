import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { budgetDocuments, budgetSections, lineItems, measurementCertificates, projects } from "../db/schema.js";
import { requireCompanyUser, requireRole } from "../auth/middleware.js";
import { getBudgetDocumentSummary, hideInternalPricing } from "../services/boqEngine.js";
import { computeCompositionUnitCost } from "../services/costEngine.js";
import {
  assertProjectOwned,
  assertDocumentOwned,
  assertSectionOwned,
  assertLineItemOwned,
  assertCompositionVisible,
  getZoneIdForSection,
} from "../services/accessControl.js";
import { generateStandardBoq } from "../services/boqTemplate.js";
import { importMeasurementsFromExcel } from "../services/measurementImport.js";
import { CURRENCIES, DEFAULT_IVA_RATE, UNITS, LINE_ITEM_KINDS } from "@sigo/shared";

const WRITE_ROLES = ["admin_empresa", "orcamentista"] as const;

function companyIdOf(request: FastifyRequest): string {
  return request.currentUser!.companyId!;
}

const documentSchema = z.object({
  title: z.string().min(1),
  revision: z.string().optional(),
  fileNumber: z.string().optional(),
  currency: z.enum(CURRENCIES).default("MZN"),
  documentDate: z.string().optional(),
  ivaRate: z.number().min(0).max(1).default(DEFAULT_IVA_RATE),
  contingenciasRate: z.number().min(0).max(1).default(0.1),
  siteCostsRate: z.number().min(0).max(1).default(0),
  indirectCostsRate: z.number().min(0).max(1).default(0),
  profitMarginRate: z.number().min(0).max(1).default(0),
  template: z.enum(["padrao", "vazio"]).default("padrao"),
  documentType: z.enum(["medicao", "orcamento"]).default("orcamento"),
});

const sectionSchema = z.object({ name: z.string().min(1), sortOrder: z.number().int().default(0) });

const lineItemSchema = z.object({
  parentId: z.string().uuid().nullable().optional(),
  kind: z.enum(LINE_ITEM_KINDS),
  code: z.string().max(30).nullable().optional(),
  description: z.string().min(1),
  unit: z.enum(UNITS).nullable().optional(),
  quantity: z.number().nonnegative().nullable().optional(),
  unitPrice: z.number().nonnegative().nullable().optional(),
  compositionId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().default(0),
});
const lineItemUpdateSchema = lineItemSchema.partial();

export async function budgetDocumentRoutes(app: FastifyInstance) {
  // ---------- Documentos (Mapas de Quantidades/Orçamentos) ----------
  app.get("/api/projects/:projectId/budget-documents", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const companyId = companyIdOf(request);
    const project = await assertProjectOwned(projectId, companyId);
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });
    return db.select().from(budgetDocuments).where(eq(budgetDocuments.projectId, projectId)).orderBy(budgetDocuments.createdAt);
  });

  app.post("/api/projects/:projectId/budget-documents", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const companyId = companyIdOf(request);
    const project = await assertProjectOwned(projectId, companyId);
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });

    const parsed = documentSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { ivaRate, contingenciasRate, siteCostsRate, indirectCostsRate, profitMarginRate, template, ...rest } = parsed.data;

    // As composições do catálogo e os preços por zona são actualmente mantidos em MZN.
    // Nunca criar uma estrutura automática rotulada USD sem uma taxa de câmbio explícita:
    // documentos vazios/importados podem continuar noutras moedas e ficam independentes.
    if (template === "padrao" && rest.currency !== "MZN") {
      return reply.code(400).send({
        error: "Os mapas automáticos ligados ao catálogo são criados em MZN. Para trabalhar noutra moeda, crie um documento vazio/importado ou faça uma conversão explícita.",
      });
    }

    const [document] = await db
      .insert(budgetDocuments)
      .values({
        ...rest,
        projectId,
        ivaRate: ivaRate.toString(),
        contingenciasRate: contingenciasRate.toString(),
        siteCostsRate: siteCostsRate.toString(),
        indirectCostsRate: indirectCostsRate.toString(),
        profitMarginRate: profitMarginRate.toString(),
      })
      .returning();

    if (template === "padrao") {
      await generateStandardBoq(document.id, companyId, project.zoneId);
    }
    return reply.code(201).send(document);
  });

  app.get("/api/budget-documents/:id", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = companyIdOf(request);
    const document = await assertDocumentOwned(id, companyId);
    if (!document) return reply.code(404).send({ error: "Documento não encontrado" });
    const summary = await getBudgetDocumentSummary(id);
    return summary && request.currentUser!.role === "visualizador" ? hideInternalPricing(summary) : summary;
  });

  // Fluxo de aprovação do orçamento — mesma máquina de estados dos Autos de Medição
  // (rascunho → submetido → aprovado, com devolução possível de submetido para rascunho).
  // Um orçamento aprovado bloqueia o reprice automático (ver POST .../reprice) e passa a ser a
  // referência usada pelo cronograma e pelos Autos de Medição desse documento.
  app.patch("/api/budget-documents/:id/status", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = companyIdOf(request);
    const document = await assertDocumentOwned(id, companyId);
    if (!document) return reply.code(404).send({ error: "Documento não encontrado" });

    const parsed = z.object({ status: z.enum(["rascunho", "submetido", "aprovado"]) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const transitions: Record<typeof document.status, (typeof document.status)[]> = {
      rascunho: ["submetido"],
      submetido: ["rascunho", "aprovado"],
      aprovado: [],
    };
    if (parsed.data.status !== document.status && !transitions[document.status].includes(parsed.data.status)) {
      return reply.code(409).send({ error: `O documento em ${document.status} não pode passar para ${parsed.data.status}` });
    }

    const [updated] = await db.update(budgetDocuments).set({ status: parsed.data.status }).where(eq(budgetDocuments.id, id)).returning();
    return updated;
  });

  // Entrega formal da medição ao orçamento. A medição original permanece intacta e continua
  // exportável; o orçamento recebe uma cópia das quantidades e calcula os custos a partir das
  // composições/cotações actualmente aplicáveis à zona da obra.
  app.post("/api/budget-documents/:id/create-budget", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = companyIdOf(request);
    const source = await assertDocumentOwned(id, companyId);
    if (!source) return reply.code(404).send({ error: "Medição não encontrada" });
    if (source.documentType !== "medicao") {
      return reply.code(409).send({ error: "Só documentos de medição podem ser enviados para orçamento." });
    }

    const [existing] = await db
      .select()
      .from(budgetDocuments)
      .where(and(eq(budgetDocuments.projectId, source.projectId), eq(budgetDocuments.sourceMeasurementDocumentId, id)))
      .limit(1);
    if (existing) return { document: existing, created: false };

    const project = await assertProjectOwned(source.projectId, companyId);
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });
    const sourceSections = await db.select().from(budgetSections).where(eq(budgetSections.documentId, id)).orderBy(budgetSections.sortOrder);
    const sourceItems = sourceSections.length
      ? await db.select().from(lineItems).where(inArray(lineItems.sectionId, sourceSections.map((section) => section.id))).orderBy(lineItems.sortOrder)
      : [];

    const computedPrices = new Map<string, number | null>();
    for (const item of sourceItems) {
      if (!item.compositionId || item.kind !== "item") {
        computedPrices.set(item.id, null);
        continue;
      }
      try {
        const breakdown = await computeCompositionUnitCost(item.compositionId, companyId, project.zoneId);
        computedPrices.set(item.id, breakdown.unitCost);
      } catch {
        computedPrices.set(item.id, null);
      }
    }

    const target = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(budgetDocuments)
        .values({
          projectId: source.projectId,
          title: `Orçamento — ${project.name}`,
          documentType: "orcamento",
          sourceMeasurementDocumentId: source.id,
          revision: "0",
          currency: "MZN",
          ivaRate: project.ivaRate,
          contingenciasRate: project.contingenciasRate,
          siteCostsRate: project.siteCostsRate,
          indirectCostsRate: project.indirectCostsRate,
          profitMarginRate: project.profitMarginRate,
        })
        .returning();

      for (const sourceSection of sourceSections) {
        const [targetSection] = await tx
          .insert(budgetSections)
          .values({ documentId: created.id, name: sourceSection.name, sortOrder: sourceSection.sortOrder })
          .returning();

        const copyLevel = async (sourceParentId: string | null, targetParentId: string | null): Promise<void> => {
          const siblings = sourceItems.filter((item) => item.sectionId === sourceSection.id && item.parentId === sourceParentId);
          for (const item of siblings) {
            const unitPrice = computedPrices.get(item.id) ?? null;
            const [targetItem] = await tx
              .insert(lineItems)
              .values({
                sectionId: targetSection.id,
                parentId: targetParentId,
                kind: item.kind,
                code: item.code,
                description: item.description,
                unit: item.unit,
                quantity: item.quantity,
                unitPrice: unitPrice !== null ? unitPrice.toString() : null,
                compositionId: item.compositionId,
                origin: item.compositionId ? "composicao" : item.origin,
                sortOrder: item.sortOrder,
              })
              .returning();
            await copyLevel(item.id, targetItem.id);
          }
        };
        await copyLevel(null, null);
      }

      await tx.update(projects).set({ projectType: "hibrido" }).where(eq(projects.id, project.id));
      return created;
    });

    return reply.code(201).send({ document: target, created: true });
  });

  // Actualiza, de forma EXPLÍCITA, os snapshots de preço dos itens ligados a composições.
  // Alterações no catálogo nunca devem reescrever silenciosamente um orçamento já emitido:
  // o utilizador escolhe quando recalcular e documentos em revisão/aprovados ficam protegidos.
  app.post("/api/budget-documents/:id/reprice", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = companyIdOf(request);
    const document = await assertDocumentOwned(id, companyId);
    if (!document) return reply.code(404).send({ error: "Documento não encontrado" });
    if (document.status !== "rascunho") {
      return reply.code(409).send({
        error: "Só é possível actualizar preços num documento em rascunho. Crie uma nova revisão para preservar o documento submetido ou aprovado.",
      });
    }

    const project = await assertProjectOwned(document.projectId, companyId);
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });

    const candidates = await db
      .select({
        id: lineItems.id,
        description: lineItems.description,
        compositionId: lineItems.compositionId,
        unitPrice: lineItems.unitPrice,
      })
      .from(lineItems)
      .innerJoin(budgetSections, eq(lineItems.sectionId, budgetSections.id))
      .where(eq(budgetSections.documentId, id));

    const compositionItems = candidates.filter(
      (item): item is typeof item & { compositionId: string } => item.compositionId !== null,
    );
    const computed: Array<{ id: string; previousUnitPrice: number | null; nextUnitPrice: number }> = [];
    const issues: Array<{ lineItemId: string; description: string; reason: string }> = [];

    for (const item of compositionItems) {
      const composition = await assertCompositionVisible(item.compositionId, companyId);
      if (!composition) {
        issues.push({ lineItemId: item.id, description: item.description, reason: "Composição indisponível" });
        continue;
      }
      try {
        const breakdown = await computeCompositionUnitCost(item.compositionId, companyId, project.zoneId);
        computed.push({
          id: item.id,
          previousUnitPrice: item.unitPrice !== null ? Number(item.unitPrice) : null,
          nextUnitPrice: breakdown.unitCost,
        });
      } catch (error) {
        issues.push({
          lineItemId: item.id,
          description: item.description,
          reason: error instanceof Error ? error.message : "Não foi possível calcular a composição",
        });
      }
    }

    // Não deixa o documento parcialmente recalculado: primeiro valida todas as composições e
    // só depois grava o lote completo numa transacção.
    if (issues.length > 0) {
      return reply.code(422).send({
        error: `Faltam dados em ${issues.length} item(ns). Corrija as composições indicadas antes de actualizar o orçamento.`,
        issues,
      });
    }

    const changed = computed.filter(
      (item) => item.previousUnitPrice === null || Math.abs(item.previousUnitPrice - item.nextUnitPrice) > 0.000001,
    );
    const previousSummary = await getBudgetDocumentSummary(id);

    await db.transaction(async (tx) => {
      for (const item of changed) {
        await tx
          .update(lineItems)
          .set({ unitPrice: item.nextUnitPrice.toString(), origin: "composicao" })
          .where(eq(lineItems.id, item.id));
      }
    });

    const nextSummary = await getBudgetDocumentSummary(id);
    return {
      processed: computed.length,
      updated: changed.length,
      unchanged: computed.length - changed.length,
      previousTotal: previousSummary?.total ?? 0,
      newTotal: nextSummary?.total ?? 0,
      zoneId: project.zoneId,
    };
  });

  app.put("/api/budget-documents/:id", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = companyIdOf(request);
    const document = await assertDocumentOwned(id, companyId);
    if (!document) return reply.code(404).send({ error: "Documento não encontrado" });

    const parsed = documentSchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { ivaRate, contingenciasRate, siteCostsRate, indirectCostsRate, profitMarginRate, ...rest } = parsed.data;

    const [row] = await db
      .update(budgetDocuments)
      .set({
        ...rest,
        ivaRate: ivaRate !== undefined ? ivaRate.toString() : undefined,
        contingenciasRate: contingenciasRate !== undefined ? contingenciasRate.toString() : undefined,
        siteCostsRate: siteCostsRate !== undefined ? siteCostsRate.toString() : undefined,
        indirectCostsRate: indirectCostsRate !== undefined ? indirectCostsRate.toString() : undefined,
        profitMarginRate: profitMarginRate !== undefined ? profitMarginRate.toString() : undefined,
      })
      .where(eq(budgetDocuments.id, id))
      .returning();
    return row;
  });

  app.delete("/api/budget-documents/:id", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = companyIdOf(request);
    const document = await assertDocumentOwned(id, companyId);
    if (!document) return reply.code(404).send({ error: "Documento não encontrado" });

    // Os autos de medição referenciam o documento sem cascade (fazem sentido só enquanto o
    // documento base existir) — apagam-se primeiro para não violar a chave estrangeira; as
    // secções/itens/medições do próprio documento já têm cascade definido no schema.
    await db.delete(measurementCertificates).where(eq(measurementCertificates.budgetDocumentId, id));
    await db.delete(budgetDocuments).where(eq(budgetDocuments.id, id));
    return { ok: true };
  });

  // Importação de um Excel de medições já feitas (ex: por um técnico de obra) — lê as
  // quantidades pelo código do item e aplica-as directamente aos itens-padrão já existentes,
  // sem duplicar nada nem passar pelo Assistente de Medições.
  app.post("/api/budget-documents/:id/import-measurements", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = companyIdOf(request);
    const document = await assertDocumentOwned(id, companyId);
    if (!document) return reply.code(404).send({ error: "Documento não encontrado" });

    const data = await request.file();
    if (!data) return reply.code(400).send({ error: "Ficheiro em falta" });
    const buffer = await data.toBuffer();

    try {
      const result = await importMeasurementsFromExcel(id, buffer);
      return result;
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "Erro ao importar medições" });
    }
  });

  // ---------- Secções ----------
  app.post("/api/budget-documents/:id/sections", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = companyIdOf(request);
    const document = await assertDocumentOwned(id, companyId);
    if (!document) return reply.code(404).send({ error: "Documento não encontrado" });

    const parsed = sectionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const [section] = await db.insert(budgetSections).values({ ...parsed.data, documentId: id }).returning();
    return reply.code(201).send(section);
  });

  app.delete("/api/sections/:id", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = companyIdOf(request);
    const section = await assertSectionOwned(id, companyId);
    if (!section) return reply.code(404).send({ error: "Secção não encontrada" });
    await db.delete(budgetSections).where(eq(budgetSections.id, id));
    return { ok: true };
  });

  // ---------- Itens (árvore: capítulo/grupo/item/nota) ----------
  app.post("/api/sections/:id/line-items", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = companyIdOf(request);
    const section = await assertSectionOwned(id, companyId);
    if (!section) return reply.code(404).send({ error: "Secção não encontrada" });

    const parsed = lineItemSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const data = parsed.data;

    // Se o item referenciar uma composição de custo, o preço unitário é calculado e gravado
    // como "snapshot" no momento da criação — não recalcula retroactivamente se o catálogo mudar depois.
    let unitPrice = data.unitPrice ?? null;
    let origin: "manual" | "planta" | "composicao" = "manual";
    if (data.compositionId) {
      // Confirma que a composição é visível a esta empresa (partilhada ou própria) antes de
      // confiar nela para calcular um preço — nunca aceitar cegamente um id vindo do cliente.
      const composition = await assertCompositionVisible(data.compositionId, companyId);
      if (!composition) return reply.code(400).send({ error: "Composição de custo não encontrada" });
      const zoneId = await getZoneIdForSection(id);
      const breakdown = await computeCompositionUnitCost(data.compositionId, companyId, zoneId);
      unitPrice = breakdown.unitCost;
      origin = "composicao";
    }

    const [item] = await db
      .insert(lineItems)
      .values({
        ...data,
        sectionId: id,
        unitPrice: unitPrice !== null ? unitPrice.toString() : null,
        quantity: data.quantity !== undefined && data.quantity !== null ? data.quantity.toString() : null,
        origin,
      })
      .returning();
    return reply.code(201).send(item);
  });

  app.put("/api/line-items/:id", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = companyIdOf(request);
    const existing = await assertLineItemOwned(id, companyId);
    if (!existing) return reply.code(404).send({ error: "Item não encontrado" });

    const parsed = lineItemUpdateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const data = parsed.data;

    let unitPrice = data.unitPrice;
    let origin: "manual" | "planta" | "composicao" | undefined;
    if (data.compositionId) {
      const composition = await assertCompositionVisible(data.compositionId, companyId);
      if (!composition) return reply.code(400).send({ error: "Composição de custo não encontrada" });
      const zoneId = await getZoneIdForSection(existing.sectionId);
      const breakdown = await computeCompositionUnitCost(data.compositionId, companyId, zoneId);
      unitPrice = breakdown.unitCost;
      origin = "composicao";
    } else if (data.compositionId === null) {
      origin = "manual";
    }

    const [row] = await db
      .update(lineItems)
      .set({
        ...data,
        unitPrice: unitPrice !== undefined ? (unitPrice !== null ? unitPrice.toString() : null) : undefined,
        quantity: data.quantity !== undefined ? (data.quantity !== null ? data.quantity.toString() : null) : undefined,
        origin,
      })
      .where(eq(lineItems.id, id))
      .returning();
    return row;
  });

  app.delete("/api/line-items/:id", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = companyIdOf(request);
    const existing = await assertLineItemOwned(id, companyId);
    if (!existing) return reply.code(404).send({ error: "Item não encontrado" });
    await db.delete(lineItems).where(eq(lineItems.id, id));
    return { ok: true };
  });
}

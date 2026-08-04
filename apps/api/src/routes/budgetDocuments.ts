import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { createHash } from "node:crypto";
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
import { applyProjectSpecificationsToDocument } from "../services/specEnrichment.js";
import { importMeasurementsFromExcel } from "../services/measurementImport.js";
import { documentLockedMessage, evaluateDocumentReadiness } from "../services/documentRules.js";
import { recordAuditEvent } from "../services/auditTrail.js";
import { CURRENCIES, DEFAULT_IVA_RATE, UNITS, LINE_ITEM_KINDS, fixedSigo } from "@sigo/shared";

const WRITE_ROLES = ["admin_empresa", "orcamentista"] as const;

function companyIdOf(request: FastifyRequest): string {
  return request.currentUser!.companyId!;
}

async function getDocumentItems(documentId: string) {
  return db
    .select({
      kind: lineItems.kind,
      description: lineItems.description,
      unit: lineItems.unit,
      quantity: lineItems.quantity,
      unitPrice: lineItems.unitPrice,
    })
    .from(lineItems)
    .innerJoin(budgetSections, eq(lineItems.sectionId, budgetSections.id))
    .where(eq(budgetSections.documentId, documentId));
}

function measurementFingerprint(
  sections: Array<{ id: string; name: string; sortOrder: number }>,
  items: Array<{ id: string; sectionId: string; parentId: string | null; kind: string; code: string | null; description: string; unit: string | null; quantity: string | null; compositionId: string | null; sortOrder: number }>,
) {
  const payload = {
    sections: sections.map((section) => ({ id: section.id, name: section.name, sortOrder: section.sortOrder })),
    items: [...items]
      .sort((a, b) => a.sectionId.localeCompare(b.sectionId) || a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
      .map((item) => ({
        id: item.id,
        sectionId: item.sectionId,
        parentId: item.parentId,
        kind: item.kind,
        code: item.code,
        description: item.description,
        unit: item.unit,
        quantity: item.quantity,
        compositionId: item.compositionId,
        sortOrder: item.sortOrder,
      })),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

async function getDocumentForSection(sectionId: string, companyId: string) {
  const section = await assertSectionOwned(sectionId, companyId);
  return section ? assertDocumentOwned(section.documentId, companyId) : null;
}

async function getDocumentForItem(itemId: string, companyId: string) {
  const item = await assertLineItemOwned(itemId, companyId);
  if (!item) return null;
  const [section] = await db.select().from(budgetSections).where(eq(budgetSections.id, item.sectionId)).limit(1);
  return section ? assertDocumentOwned(section.documentId, companyId) : null;
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
const lineItemUpdateSchema = lineItemSchema.partial().extend({
  technicalSpecification: z.string().nullable().optional(),
});

const SPEC_MARKER = "\n\n— Especificação técnica —\n";

function stripEmbeddedSpec(description: string): string {
  return description.split(SPEC_MARKER)[0].trim();
}

function mergeDescriptionWithSpec(baseDescription: string, spec: string | null | undefined): string {
  const base = stripEmbeddedSpec(baseDescription);
  if (spec === undefined) return baseDescription;
  if (!spec?.trim()) return base;
  return `${base}${SPEC_MARKER}${spec.trim()}`;
}

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

    const parsed = z.object({ status: z.enum(["rascunho", "submetido", "aprovado"]), decisionNote: z.string().trim().max(1000).optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const transitions: Record<typeof document.status, (typeof document.status)[]> = {
      rascunho: ["submetido"],
      submetido: ["rascunho", "aprovado"],
      aprovado: [],
    };
    if (parsed.data.status === "aprovado") {
      if (request.currentUser!.role !== "admin_empresa") {
        return reply.code(403).send({ error: "A aprovação do documento exige um administrador da empresa" });
      }
      if (document.submittedByUserId === request.currentUser!.id) {
        return reply.code(409).send({ error: "Quem submeteu o documento não pode aprová-lo" });
      }
    }
    if (parsed.data.status !== document.status && !transitions[document.status].includes(parsed.data.status)) {
      return reply.code(409).send({ error: `O documento em ${document.status} não pode passar para ${parsed.data.status}` });
    }

    if (parsed.data.status === "submetido" || parsed.data.status === "aprovado") {
      const readiness = evaluateDocumentReadiness(document.documentType === "medicao" ? "medicao" : "orcamento", await getDocumentItems(id));
      if (!readiness.ready) {
        return reply.code(409).send({
          error: `Documento incompleto: ${readiness.blockers.join("; ")}.`,
          readiness,
        });
      }
    }

    const [updated] = await db.update(budgetDocuments).set({
      status: parsed.data.status,
      submittedByUserId: parsed.data.status === "submetido" ? request.currentUser!.id : document.submittedByUserId,
      approvedByUserId: parsed.data.status === "aprovado" ? request.currentUser!.id : document.approvedByUserId,
      approvalNote: parsed.data.decisionNote ?? document.approvalNote,
    }).where(eq(budgetDocuments.id, id)).returning();
    await recordAuditEvent({
      companyId,
      projectId: document.projectId,
      actorUserId: request.currentUser!.id,
      entityType: "budget_document",
      entityId: id,
      action: `status.${parsed.data.status}`,
      before: { status: document.status, title: document.title, documentType: document.documentType, submittedByUserId: document.submittedByUserId },
      after: { status: updated.status, title: updated.title, documentType: updated.documentType, submittedByUserId: updated.submittedByUserId, approvedByUserId: updated.approvedByUserId },
      metadata: parsed.data.decisionNote ? { decisionNote: parsed.data.decisionNote } : null,
    });
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
    const options = z
      .object({
        createRevision: z.boolean().default(false),
        // Novo orçamento comercial a partir da mesma medição (mesmo fingerprint), para cenários de preço.
        createScenario: z.boolean().default(false),
      })
      .safeParse(request.body ?? {});
    if (!options.success) return reply.code(400).send({ error: options.error.flatten() });

    const readiness = evaluateDocumentReadiness("medicao", await getDocumentItems(id));
    if (!readiness.ready) {
      return reply.code(409).send({ error: `Medição incompleta: ${readiness.blockers.join("; ")}.`, readiness });
    }

    const existingBudgets = await db
      .select()
      .from(budgetDocuments)
      .where(and(eq(budgetDocuments.projectId, source.projectId), eq(budgetDocuments.sourceMeasurementDocumentId, id)))
      .orderBy(desc(budgetDocuments.createdAt));

    const project = await assertProjectOwned(source.projectId, companyId);
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });
    const sourceSections = await db.select().from(budgetSections).where(eq(budgetSections.documentId, id)).orderBy(budgetSections.sortOrder);
    const sourceItems = sourceSections.length
      ? await db.select().from(lineItems).where(inArray(lineItems.sectionId, sourceSections.map((section) => section.id))).orderBy(lineItems.sortOrder)
      : [];
    const fingerprint = measurementFingerprint(sourceSections, sourceItems);
    const latestBudget = existingBudgets[0];
    const forceNew = options.data.createScenario || options.data.createRevision;
    if (!forceNew) {
      // Orçamentos legados sem fingerprint não contam como "iguais" — forçam revisão explícita.
      if (latestBudget?.sourceMeasurementFingerprint && latestBudget.sourceMeasurementFingerprint === fingerprint) {
        return { document: latestBudget, created: false, revisionCreated: false, scenarioCreated: false };
      }
      if (latestBudget) {
        return reply.code(409).send({
          code: "MEASUREMENT_CHANGED",
          error: "A medição mudou depois do último orçamento. Crie uma nova revisão para incorporar os novos capítulos e quantidades.",
          existingDocumentId: latestBudget.id,
          existingRevision: latestBudget.revision,
        });
      }
    }

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

    const scenarioIndex = existingBudgets.length + 1;
    const title =
      existingBudgets.length === 0
        ? `Orçamento — ${project.name}`
        : `Orçamento — ${project.name} (cenário ${scenarioIndex})`;

    const target = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(budgetDocuments)
        .values({
          projectId: source.projectId,
          title,
          documentType: "orcamento",
          sourceMeasurementDocumentId: source.id,
          sourceMeasurementFingerprint: fingerprint,
          revision: String(existingBudgets.length),
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
          .values({ documentId: created.id, name: sourceSection.name, sortOrder: sourceSection.sortOrder, templateKey: "sigo_orcamento_snapshot_v1" })
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
                sourceMeasurementItemId: item.id,
                kind: item.kind,
                code: item.code,
                description: item.description,
                unit: item.unit,
                quantity: item.quantity,
                unitPrice: unitPrice !== null ? fixedSigo(unitPrice) : null,
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

    await applyProjectSpecificationsToDocument(target.id, project.id);

    return reply.code(201).send({
      document: target,
      created: true,
      revisionCreated: options.data.createRevision && existingBudgets.length > 0,
      scenarioCreated: options.data.createScenario && existingBudgets.length > 0,
    });
  });

  app.post("/api/budget-documents/:id/apply-specifications", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = companyIdOf(request);
    const document = await assertDocumentOwned(id, companyId);
    if (!document) return reply.code(404).send({ error: "Documento não encontrado" });
    if (document.status !== "rascunho") {
      return reply.code(409).send({ error: "Só pode aplicar especificações em documentos em rascunho." });
    }
    const result = await applyProjectSpecificationsToDocument(id, document.projectId);
    return result;
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
          .set({ unitPrice: fixedSigo(item.nextUnitPrice), origin: "composicao" })
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
    if (document.status !== "rascunho") return reply.code(409).send({ error: documentLockedMessage(document.status) });

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
    if (document.status !== "rascunho") return reply.code(409).send({ error: "Só é possível eliminar documentos em rascunho." });

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
    if (document.status !== "rascunho") return reply.code(409).send({ error: documentLockedMessage(document.status) });

    const data = await request.file();
    if (!data) return reply.code(400).send({ error: "Ficheiro em falta" });
    const buffer = await data.toBuffer();

    try {
      const createMissing = (request.query as { createMissing?: string }).createMissing !== "false";
      const result = await importMeasurementsFromExcel(id, buffer, companyId, { createMissing });
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
    if (document.status !== "rascunho") return reply.code(409).send({ error: documentLockedMessage(document.status) });

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
    const document = await getDocumentForSection(id, companyId);
    if (!document || document.status !== "rascunho") return reply.code(409).send({ error: documentLockedMessage(document?.status ?? "submetido") });
    await db.delete(budgetSections).where(eq(budgetSections.id, id));
    return { ok: true };
  });

  app.patch("/api/sections/:id", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = companyIdOf(request);
    const section = await assertSectionOwned(id, companyId);
    if (!section) return reply.code(404).send({ error: "Secção não encontrada" });
    const document = await getDocumentForSection(id, companyId);
    if (!document || document.status !== "rascunho") return reply.code(409).send({ error: documentLockedMessage(document?.status ?? "submetido") });

    const parsed = z.object({ name: z.string().min(1) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const [updated] = await db.update(budgetSections).set({ name: parsed.data.name }).where(eq(budgetSections.id, id)).returning();
    return updated;
  });

  // ---------- Itens (árvore: capítulo/grupo/item/nota) ----------
  app.post("/api/sections/:id/line-items", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = companyIdOf(request);
    const section = await assertSectionOwned(id, companyId);
    if (!section) return reply.code(404).send({ error: "Secção não encontrada" });
    const document = await getDocumentForSection(id, companyId);
    if (!document || document.status !== "rascunho") return reply.code(409).send({ error: documentLockedMessage(document?.status ?? "submetido") });

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
        unitPrice: unitPrice !== null ? fixedSigo(unitPrice) : null,
        quantity: data.quantity !== undefined && data.quantity !== null ? fixedSigo(data.quantity) : null,
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
    const document = await getDocumentForItem(id, companyId);
    if (!document || document.status !== "rascunho") return reply.code(409).send({ error: documentLockedMessage(document?.status ?? "submetido") });

    const parsed = lineItemUpdateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { technicalSpecification, ...data } = parsed.data;

    let description = data.description;
    if (technicalSpecification !== undefined) {
      const base = description !== undefined ? stripEmbeddedSpec(description) : stripEmbeddedSpec(existing.description);
      description = mergeDescriptionWithSpec(base, technicalSpecification);
    }

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
        ...(description !== undefined ? { description } : {}),
        unitPrice: unitPrice !== undefined ? (unitPrice !== null ? fixedSigo(unitPrice) : null) : undefined,
        quantity: data.quantity !== undefined ? (data.quantity !== null ? fixedSigo(data.quantity) : null) : undefined,
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
    const document = await getDocumentForItem(id, companyId);
    if (!document || document.status !== "rascunho") return reply.code(409).send({ error: documentLockedMessage(document?.status ?? "submetido") });
    await db.delete(lineItems).where(eq(lineItems.id, id));
    return { ok: true };
  });

  // Actualização em massa de especificações técnicas (editor por capítulo).
  app.post("/api/line-items/bulk-specifications", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const companyId = companyIdOf(request);
    const parsed = z
      .object({
        items: z.array(
          z.object({
            id: z.string().uuid(),
            technicalSpecification: z.string().max(8000).nullable(),
          }),
        ),
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    let updated = 0;
    for (const entry of parsed.data.items) {
      const existing = await assertLineItemOwned(entry.id, companyId);
      if (!existing || existing.kind !== "item") continue;
      const document = await getDocumentForItem(entry.id, companyId);
      if (!document || document.status !== "rascunho") {
        return reply.code(409).send({ error: documentLockedMessage(document?.status ?? "submetido") });
      }
      const description = mergeDescriptionWithSpec(stripEmbeddedSpec(existing.description), entry.technicalSpecification);
      await db.update(lineItems).set({ description }).where(eq(lineItems.id, entry.id));
      updated++;
    }
    return { updated };
  });
}

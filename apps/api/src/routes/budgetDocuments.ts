import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "../db/index.js";
import { budgetDocuments, budgetSections, lineItems, measurementLines, measurementCertificates, plants, projects } from "../db/schema.js";
import { requireCompanyUser, requireRole } from "../auth/middleware.js";
import { getBudgetDocumentSummary, hideInternalPricing } from "../services/boqEngine.js";
import { computeCompositionUnitCostV2 } from "../services/costEngineV2.js";
import { createLineItemCostSnapshot, copyLatestLineItemCostSnapshot, listLineItemCostSnapshots } from "../services/costSnapshotService.js";
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
import {
  previewMeasurementsImport,
  applyMeasurementsImport,
  importApplyDecisionsSchema,
} from "../services/measurementImport.js";
import {
  applyMeasurementImportJob,
  enqueueMeasurementImportJob,
  getMeasurementImportJob,
} from "../services/measurementImportJobs.js";
import { documentLockedMessage, evaluateDocumentReadiness } from "../services/documentRules.js";
import { loadProjectPlantContext } from "../services/plantMeasurementLink.js";
import { recordAuditEvent } from "../services/auditTrail.js";
import { emitWorkflowEvent } from "../services/workflowEvents.js";
import { assertMatrixApproval } from "../services/companyApproval.js";
import { assertApproversAvailable } from "../services/resolveProjectApproval.js";
import {
  assertUserCanActOnEntity,
  completePendingApprovalTasks,
  createApprovalTasks,
  createCorrectionTask,
} from "../services/workflowTasks.js";
import { workflowTypeFromDocumentType } from "../services/projectWorkflowTypes.js";
import { CURRENCIES, DEFAULT_IVA_RATE, UNITS, LINE_ITEM_KINDS, fixedSigo, planUsesDirectDocumentApproval, boqEditSessionSchema } from "@sigo/shared";
import { applyBoqEditSession, BoqEditConflictError, BoqEditValidationError } from "../services/boqEditSession.js";
import { compareBudgetRevisions } from "../services/budgetRevisionDiff.js";
import { getCompanySubscription } from "../services/subscriptionEntitlements.js";

const WRITE_ROLES = ["admin_empresa", "orcamentista"] as const;

function companyIdOf(request: FastifyRequest): string {
  return request.currentUser!.companyId!;
}

async function getDocumentItems(documentId: string) {
  return db
    .select({
      code: lineItems.code,
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

async function detectedRequiredItemCodes(projectId: string): Promise<string[]> {
  const completedPlants = await db
    .select({ structuralSummary: plants.structuralSummary, documentAnalysis: plants.documentAnalysis })
    .from(plants)
    .where(and(eq(plants.projectId, projectId), eq(plants.processingStatus, "concluido")))
    .orderBy(desc(plants.uploadedAt));
  const structural = completedPlants.find((plant) =>
    plant.structuralSummary
    && (!plant.documentAnalysis?.requiresIdentityConfirmation || plant.documentAnalysis.identityConfirmed)
  )?.structuralSummary;
  const required = new Set<string>();
  if (structural) {
    if (structural.footingsCount > 0) ["2.1", "3.1", "3.2", "3.8"].forEach((code) => required.add(code));
    if (structural.columnsCount > 0) ["3.3", "3.8"].forEach((code) => required.add(code));
    if (structural.beamsCount > 0) ["3.4", "3.8"].forEach((code) => required.add(code));
    if (structural.slabsCount > 0) required.add("3.5");
    if (structural.totalSteelWeightKg > 0) required.add("3.6");
  }
  const { openings } = await loadProjectPlantContext(projectId);
  const confirmed = openings.filter((opening) => !opening.needsConfirmation && opening.widthM != null && opening.heightM != null);
  if (confirmed.some((opening) => opening.kind === "porta" && opening.location === "interior")) required.add("15.1");
  if (confirmed.some((opening) => opening.kind === "porta" && opening.location === "exterior")) required.add("15.2");
  if (confirmed.some((opening) => opening.kind === "janela")) required.add("15.3");
  if (confirmed.length > 0) required.add("15.4");
  return [...required];
}

async function unresolvedPlantIdentityConflicts(projectId: string) {
  const completedPlants = await db
    .select({ id: plants.id, filename: plants.originalFileName, documentAnalysis: plants.documentAnalysis })
    .from(plants)
    .where(and(eq(plants.projectId, projectId), eq(plants.processingStatus, "concluido")))
    .orderBy(desc(plants.uploadedAt));
  return completedPlants.filter((plant) =>
    plant.documentAnalysis?.requiresIdentityConfirmation
    && !plant.documentAnalysis.identityConfirmed
  );
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

  app.get("/api/budget-documents/:id/revision-diff", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = companyIdOf(request);
    const document = await assertDocumentOwned(id, companyId);
    if (!document) return reply.code(404).send({ error: "Documento não encontrado" });
    const diff = await compareBudgetRevisions(id);
    if (!diff) return reply.code(404).send({ error: "Documento não encontrado" });
    return diff;
  });

  app.patch("/api/budget-documents/:id/edit-session", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = companyIdOf(request);
    const document = await assertDocumentOwned(id, companyId);
    if (!document) return reply.code(404).send({ error: "Documento não encontrado" });
    if (document.status !== "rascunho") return reply.code(409).send({ error: documentLockedMessage(document.status) });
    const parsed = boqEditSessionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const result = await applyBoqEditSession({
        documentId: id,
        companyId,
        actorUserId: request.currentUser!.id,
        projectId: document.projectId,
        currency: document.currency,
        baseFingerprint: parsed.data.baseFingerprint,
        operations: parsed.data.operations,
      });
      return result.summary;
    } catch (err) {
      if (err instanceof BoqEditConflictError) return reply.code(409).send({ error: err.message, code: "DOCUMENT_CHANGED" });
      if (err instanceof BoqEditValidationError) return reply.code(400).send({ error: err.message });
      throw err;
    }
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

    const subscription = await getCompanySubscription(companyId);
    const directApproval = planUsesDirectDocumentApproval(subscription?.plan);
    const transitions: Record<typeof document.status, (typeof document.status)[]> = {
      rascunho: directApproval ? ["submetido", "aprovado"] : ["submetido"],
      submetido: ["rascunho", "aprovado"],
      aprovado: [],
    };
    if (parsed.data.status === "rascunho" && document.status === "submetido" && !parsed.data.decisionNote?.trim()) {
      return reply.code(400).send({ error: "Indique o motivo da devolução para correcção" });
    }
    if (parsed.data.status === "aprovado") {
      // Plano Individual: o único utilizador aprova directamente a partir do rascunho.
      // Nos outros planos, a matriz + excepção de admin único controlam a auto-aprovação.
      if (!directApproval) {
        const decision = await assertMatrixApproval({
          companyId,
          entityType: "medicao",
          role: request.currentUser!.role,
          permissions: request.currentUser!.permissions ?? [],
          isSubmitter: document.submittedByUserId === request.currentUser!.id,
        });
        if (!decision.ok) return reply.code(decision.status).send({ error: decision.error });
        const assignment = await assertUserCanActOnEntity({
          companyId,
          entityType: "budget_document",
          entityId: id,
          userId: request.currentUser!.id,
        });
        if (!assignment.ok) return reply.code(403).send({ error: assignment.error });
      } else if (request.currentUser!.role !== "admin_empresa" && request.currentUser!.role !== "orcamentista") {
        return reply.code(403).send({ error: "A aprovação do documento exige um administrador da empresa" });
      }
    }
    if (parsed.data.status === "submetido") {
      const workflowType = workflowTypeFromDocumentType(document.documentType);
      const approvers = await assertApproversAvailable({
        companyId,
        projectId: document.projectId,
        workflowType,
        excludeUserId: request.currentUser!.id,
      });
      if (!approvers.ok) {
        return reply.code(409).send({
          code: approvers.code,
          error: approvers.error,
          projectId: document.projectId,
        });
      }
    }
    if (parsed.data.status !== document.status && !transitions[document.status].includes(parsed.data.status)) {
      const blockers = document.status === "rascunho" && parsed.data.status === "aprovado"
        ? ["Este plano exige submissão antes da aprovação", "Submeta o documento e peça a aprovação a um administrador da empresa"]
        : document.status === "aprovado"
          ? ["O documento aprovado está protegido", "Crie uma nova revisão para fazer alterações"]
          : [`Transição permitida a partir de ${document.status}: ${transitions[document.status].join(" ou ") || "nenhuma"}`];
      return reply.code(409).send({
        code: "DOCUMENT_TRANSITION_INVALID",
        error: blockers[0],
        blockers,
        currentStatus: document.status,
        requestedStatus: parsed.data.status,
      });
    }

    if (parsed.data.status === "submetido" || parsed.data.status === "aprovado") {
      const identityConflicts = await unresolvedPlantIdentityConflicts(document.projectId);
      if (identityConflicts.length > 0) {
        return reply.code(409).send({
          code: "PLANT_IDENTITY_CONFLICT",
          error: "Confirme primeiro se todas as disciplinas pertencem à mesma obra.",
          plants: identityConflicts.map((plant) => ({
            id: plant.id,
            filename: plant.filename,
            conflicts: plant.documentAnalysis?.identityConflicts ?? [],
          })),
        });
      }
      const readiness = evaluateDocumentReadiness(
        document.documentType === "medicao" ? "medicao" : "orcamento",
        await getDocumentItems(id),
        await detectedRequiredItemCodes(document.projectId),
      );
      if (!readiness.ready) {
        return reply.code(409).send({
          code: "DOCUMENT_NOT_READY",
          error: `Documento incompleto: ${readiness.blockers.join("; ")}.`,
          blockers: readiness.blockers,
          readiness,
        });
      }
    }

    const approvingFromDraft = parsed.data.status === "aprovado" && document.status === "rascunho";
    const [updated] = await db.update(budgetDocuments).set({
      status: parsed.data.status,
      submittedByUserId:
        parsed.data.status === "submetido" || approvingFromDraft
          ? request.currentUser!.id
          : parsed.data.status === "rascunho"
            ? null
            : document.submittedByUserId,
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

    const actor = { id: request.currentUser!.id, name: request.currentUser!.name, email: request.currentUser!.email };
    const workflowType = workflowTypeFromDocumentType(document.documentType);
    if (parsed.data.status === "submetido") {
      const resolved = await assertApproversAvailable({
        companyId,
        projectId: document.projectId,
        workflowType,
        excludeUserId: request.currentUser!.id,
      });
      if (resolved.ok) {
        await createApprovalTasks({
          companyId,
          projectId: document.projectId,
          workflowType,
          entityType: "budget_document",
          entityId: id,
          title: updated.title,
          body: parsed.data.decisionNote ?? null,
          link: `/documentos/${id}`,
          requestedByUserId: request.currentUser!.id,
          resolved: resolved.resolved,
        });
      }
    } else if (parsed.data.status === "aprovado") {
      await completePendingApprovalTasks({
        companyId,
        entityType: "budget_document",
        entityId: id,
        actorUserId: request.currentUser!.id,
        decision: "approved",
        comment: parsed.data.decisionNote,
        projectId: document.projectId,
        workflowType,
      });
      await emitWorkflowEvent({
        event: "document.approved",
        companyId,
        entityId: id,
        title: updated.title,
        link: `/documentos/${id}`,
        actor,
        submitterUserId: document.submittedByUserId ?? (approvingFromDraft ? request.currentUser!.id : null),
        reason: parsed.data.decisionNote,
        logger: request.log,
      });
    } else if (parsed.data.status === "rascunho" && document.status === "submetido") {
      if (document.submittedByUserId) {
        await createCorrectionTask({
          companyId,
          projectId: document.projectId,
          workflowType,
          entityType: "budget_document",
          entityId: id,
          assignedUserId: document.submittedByUserId,
          title: `Correcção necessária — ${updated.title}`,
          body: parsed.data.decisionNote ?? "Documento devolvido.",
          link: `/documentos/${id}`,
          requestedByUserId: request.currentUser!.id,
        });
      } else {
        await completePendingApprovalTasks({
          companyId,
          entityType: "budget_document",
          entityId: id,
          actorUserId: request.currentUser!.id,
          decision: "returned",
          comment: parsed.data.decisionNote,
        });
      }
      await emitWorkflowEvent({
        event: "document.returned",
        companyId,
        entityId: id,
        title: updated.title,
        link: `/documentos/${id}`,
        actor,
        submitterUserId: document.submittedByUserId,
        reason: parsed.data.decisionNote,
        logger: request.log,
      });
    }

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
    if (source.status !== "aprovado") {
      return reply.code(409).send({ error: "Aprove a medição antes de criar o orçamento." });
    }
    const options = z
      .object({
        createRevision: z.boolean().default(false),
        // Novo orçamento comercial a partir da mesma medição (mesmo fingerprint), para cenários de preço.
        createScenario: z.boolean().default(false),
      })
      .safeParse(request.body ?? {});
    if (!options.success) return reply.code(400).send({ error: options.error.flatten() });

    const identityConflicts = await unresolvedPlantIdentityConflicts(source.projectId);
    if (identityConflicts.length > 0) {
      return reply.code(409).send({
        code: "PLANT_IDENTITY_CONFLICT",
        error: "Confirme primeiro se todas as disciplinas pertencem à mesma obra.",
        plants: identityConflicts.map((plant) => ({
          id: plant.id,
          filename: plant.filename,
          conflicts: plant.documentAnalysis?.identityConflicts ?? [],
        })),
      });
    }

    const readiness = evaluateDocumentReadiness("medicao", await getDocumentItems(id), await detectedRequiredItemCodes(source.projectId));
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
    // Preços vêm do catálogo (MZN). Evita orçamentos rotulados USD com custos em meticais.
    if (project.currency !== "MZN") {
      return reply.code(409).send({
        error: "Os orçamentos gerados a partir da medição usam o catálogo em MZN. Defina a moeda da obra como MZN, ou crie um orçamento vazio/importado na moeda da obra.",
      });
    }
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
        const breakdown = await computeCompositionUnitCostV2(item.compositionId, companyId, project.zoneId);
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
                quantitySource: item.quantitySource,
                unitPrice: unitPrice !== null ? fixedSigo(unitPrice) : null,
                compositionId: item.compositionId,
                origin: item.compositionId ? "composicao" : item.origin,
                sortOrder: item.sortOrder,
              })
              .returning();
            if (item.compositionId) {
              await createLineItemCostSnapshot({ lineItemId: targetItem.id, compositionId: item.compositionId, companyId, zoneId: project.zoneId, currency: created.currency, reason: "generated" }, tx);
            }
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

  // Nova revisão de orçamento a partir de um documento submetido/aprovado — preserva o original
  // e abre um rascunho editável (preços e quantidades copiados; o utilizador pode depois repricing).
  app.post("/api/budget-documents/:id/revise", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = companyIdOf(request);
    const source = await assertDocumentOwned(id, companyId);
    if (!source) return reply.code(404).send({ error: "Documento não encontrado" });
    if (source.documentType !== "orcamento") {
      return reply.code(409).send({ error: "Só orçamentos podem gerar uma revisão directa. Use «Criar orçamento» a partir da medição." });
    }
    if (source.status === "rascunho") {
      return reply.code(409).send({ error: "Este orçamento já está em rascunho — edite-o directamente." });
    }

    const relatedWhere = source.sourceMeasurementDocumentId
      ? and(
          eq(budgetDocuments.projectId, source.projectId),
          eq(budgetDocuments.documentType, "orcamento"),
          eq(budgetDocuments.sourceMeasurementDocumentId, source.sourceMeasurementDocumentId),
        )
      : and(eq(budgetDocuments.projectId, source.projectId), eq(budgetDocuments.documentType, "orcamento"));
    const related = await db.select({ id: budgetDocuments.id }).from(budgetDocuments).where(relatedWhere);
    const nextRevision = String(related.length);

    const sourceSections = await db
      .select()
      .from(budgetSections)
      .where(eq(budgetSections.documentId, id))
      .orderBy(budgetSections.sortOrder);
    const sourceItems = sourceSections.length
      ? await db
          .select()
          .from(lineItems)
          .where(inArray(lineItems.sectionId, sourceSections.map((section) => section.id)))
          .orderBy(lineItems.sortOrder)
      : [];

    const baseTitle = source.title.replace(/\s*\(rev\.\s*\d+\)\s*$/i, "").trim();
    const target = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(budgetDocuments)
        .values({
          projectId: source.projectId,
          title: `${baseTitle} (rev. ${nextRevision})`,
          documentType: "orcamento",
          sourceMeasurementDocumentId: source.sourceMeasurementDocumentId,
          sourceMeasurementFingerprint: source.sourceMeasurementFingerprint,
          revision: nextRevision,
          currency: source.currency,
          ivaRate: source.ivaRate,
          contingenciasRate: source.contingenciasRate,
          siteCostsRate: source.siteCostsRate,
          indirectCostsRate: source.indirectCostsRate,
          profitMarginRate: source.profitMarginRate,
          status: "rascunho",
        })
        .returning();

      for (const sourceSection of sourceSections) {
        const [targetSection] = await tx
          .insert(budgetSections)
          .values({
            documentId: created.id,
            name: sourceSection.name,
            sortOrder: sourceSection.sortOrder,
            templateKey: sourceSection.templateKey,
          })
          .returning();

        const copyLevel = async (sourceParentId: string | null, targetParentId: string | null): Promise<void> => {
          const siblings = sourceItems.filter(
            (item) => item.sectionId === sourceSection.id && item.parentId === sourceParentId,
          );
          for (const item of siblings) {
            const [targetItem] = await tx
              .insert(lineItems)
              .values({
                sectionId: targetSection.id,
                parentId: targetParentId,
                sourceMeasurementItemId: item.sourceMeasurementItemId,
                kind: item.kind,
                code: item.code,
                description: item.description,
                unit: item.unit,
                quantity: item.quantity,
                quantitySource: item.quantitySource,
                unitPrice: item.unitPrice,
                compositionId: item.compositionId,
                origin: item.origin,
                sortOrder: item.sortOrder,
              })
              .returning();
            await copyLatestLineItemCostSnapshot({ sourceLineItemId: item.id, targetLineItemId: targetItem.id, reason: "revision_copy" }, tx);
            await copyLevel(item.id, targetItem.id);
          }
        };
        await copyLevel(null, null);
      }

      return created;
    });

    await recordAuditEvent({
      companyId,
      projectId: source.projectId,
      actorUserId: request.currentUser!.id,
      entityType: "budget_document",
      entityId: target.id,
      action: "revised",
      before: { sourceDocumentId: source.id, sourceStatus: source.status, sourceRevision: source.revision },
      after: { id: target.id, revision: target.revision, status: target.status },
    });

    return reply.code(201).send({ document: target, sourceDocumentId: source.id });
  });

  // Duplica uma medição aprovada numa cópia independente em rascunho — uma medição aprovada
  // fica bloqueada para edição (sem transição de volta a rascunho), por isso quem precisar de
  // quantidades diferentes duplica-a em vez de a reabrir. A cópia não herda o histórico de
  // orçamentos da original (não é uma "revisão"): é um novo ponto de partida.
  app.post("/api/budget-documents/:id/duplicate", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = companyIdOf(request);
    const source = await assertDocumentOwned(id, companyId);
    if (!source) return reply.code(404).send({ error: "Documento não encontrado" });
    if (source.documentType !== "medicao") {
      return reply.code(409).send({ error: "Só medições podem ser duplicadas. Orçamentos usam «Criar revisão»." });
    }

    const baseTitle = source.title.replace(/\s*\(cópia(?:\s+\d+)?\)\s*$/i, "").trim();
    const siblings = await db
      .select({ title: budgetDocuments.title })
      .from(budgetDocuments)
      .where(and(eq(budgetDocuments.projectId, source.projectId), eq(budgetDocuments.documentType, "medicao")));
    const copyNumber = siblings.filter((s) => new RegExp(`^${baseTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(cópia`, "i").test(s.title)).length + 1;
    const title = `${baseTitle} (cópia${copyNumber > 1 ? ` ${copyNumber}` : ""})`;

    const sourceSections = await db
      .select()
      .from(budgetSections)
      .where(eq(budgetSections.documentId, id))
      .orderBy(budgetSections.sortOrder);
    const sourceItems = sourceSections.length
      ? await db
          .select()
          .from(lineItems)
          .where(inArray(lineItems.sectionId, sourceSections.map((section) => section.id)))
          .orderBy(lineItems.sortOrder)
      : [];
    const sourceMeasurementLines = sourceItems.length
      ? await db
          .select()
          .from(measurementLines)
          .where(and(inArray(measurementLines.lineItemId, sourceItems.map((item) => item.id)), eq(measurementLines.isActive, true)))
          .orderBy(measurementLines.sortOrder)
      : [];

    const target = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(budgetDocuments)
        .values({
          projectId: source.projectId,
          title,
          documentType: "medicao",
          currency: source.currency,
          ivaRate: source.ivaRate,
          contingenciasRate: source.contingenciasRate,
          siteCostsRate: source.siteCostsRate,
          indirectCostsRate: source.indirectCostsRate,
          profitMarginRate: source.profitMarginRate,
          status: "rascunho",
        })
        .returning();

      for (const sourceSection of sourceSections) {
        const [targetSection] = await tx
          .insert(budgetSections)
          .values({
            documentId: created.id,
            name: sourceSection.name,
            sortOrder: sourceSection.sortOrder,
            templateKey: sourceSection.templateKey,
          })
          .returning();

        const copyLevel = async (sourceParentId: string | null, targetParentId: string | null): Promise<void> => {
          const items = sourceItems.filter(
            (item) => item.sectionId === sourceSection.id && item.parentId === sourceParentId,
          );
          for (const item of items) {
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
                quantitySource: item.quantitySource,
                unitPrice: item.unitPrice,
                compositionId: item.compositionId,
                origin: item.origin,
                sortOrder: item.sortOrder,
              })
              .returning();

            const itemMeasurementLines = sourceMeasurementLines.filter((ml) => ml.lineItemId === item.id);
            if (itemMeasurementLines.length) {
              await tx.insert(measurementLines).values(
                itemMeasurementLines.map((ml) => ({
                  lineItemId: targetItem.id,
                  description: ml.description,
                  formulaType: ml.formulaType,
                  sign: ml.sign,
                  count: ml.count,
                  length: ml.length,
                  width: ml.width,
                  height: ml.height,
                  directQuantity: ml.directQuantity,
                  coefficient: ml.coefficient,
                  unitWeight: ml.unitWeight,
                  diameterMm: ml.diameterMm,
                  baseQuantity: ml.baseQuantity,
                  percentage: ml.percentage,
                  block: ml.block,
                  floor: ml.floor,
                  zone: ml.zone,
                  room: ml.room,
                  axis: ml.axis,
                  element: ml.element,
                  source: ml.source,
                  sourceRef: ml.sourceRef,
                  revisionNo: 1,
                  isActive: true,
                  sortOrder: ml.sortOrder,
                })),
              );
            }
            await copyLevel(item.id, targetItem.id);
          }
        };
        await copyLevel(null, null);
      }

      return created;
    });

    await recordAuditEvent({
      companyId,
      projectId: source.projectId,
      actorUserId: request.currentUser!.id,
      entityType: "budget_document",
      entityId: target.id,
      action: "duplicated",
      before: { sourceDocumentId: source.id, sourceStatus: source.status },
      after: { id: target.id, title: target.title, status: target.status },
    });

    return reply.code(201).send({ document: target, sourceDocumentId: source.id });
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
      const composition = await assertCompositionVisible(item.compositionId, companyId, request.currentUser!.id);
      if (!composition) {
        issues.push({ lineItemId: item.id, description: item.description, reason: "Composição indisponível" });
        continue;
      }
      try {
        const breakdown = await computeCompositionUnitCostV2(item.compositionId, companyId, project.zoneId);
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
        const source = compositionItems.find((candidate) => candidate.id === item.id);
        if (source?.compositionId) await createLineItemCostSnapshot({ lineItemId: item.id, compositionId: source.compositionId, companyId, zoneId: project.zoneId, currency: document.currency, reason: "reprice" }, tx);
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

  // Importação de medições — job em segundo plano (como plantas) + preview síncrono legado + apply.
  app.post("/api/budget-documents/:id/import-measurements/jobs", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = companyIdOf(request);
    const document = await assertDocumentOwned(id, companyId);
    if (!document) return reply.code(404).send({ error: "Documento não encontrado" });
    if (document.status !== "rascunho") return reply.code(409).send({ error: documentLockedMessage(document.status) });

    const data = await request.file();
    if (!data) return reply.code(400).send({ error: "Ficheiro em falta" });
    const filename = data.filename || "mapa";
    if (filename && !/\.(xlsx|xls|pdf)$/i.test(filename)) {
      return reply.code(400).send({ error: "Só são aceites Excel (.xlsx / .xls) ou PDF de mapa de quantidades." });
    }
    const buffer = await data.toBuffer();
    const { assertSmartImportQuota, recordUsage } = await import("../services/subscriptionEntitlements.js");
    const quota = await assertSmartImportQuota(companyId);
    if (quota) {
      return reply.code(403).send({ error: quota.error, code: quota.code, upgradeHint: quota.upgradeHint, actionPath: quota.actionPath });
    }
    const job = await enqueueMeasurementImportJob({
      companyId,
      documentId: id,
      buffer,
      filename,
    });
    await recordUsage(companyId, "smart_import");
    return reply.code(202).send(job);
  });

  app.get("/api/budget-documents/:id/import-measurements/jobs/:jobId", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id, jobId } = request.params as { id: string; jobId: string };
    const companyId = companyIdOf(request);
    const document = await assertDocumentOwned(id, companyId);
    if (!document) return reply.code(404).send({ error: "Documento não encontrado" });
    const job = await getMeasurementImportJob(jobId, companyId, id);
    if (!job) return reply.code(404).send({ error: "Trabalho de importação não encontrado ou expirado" });
    return job;
  });

  app.post("/api/budget-documents/:id/import-measurements/preview", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = companyIdOf(request);
    const document = await assertDocumentOwned(id, companyId);
    if (!document) return reply.code(404).send({ error: "Documento não encontrado" });
    if (document.status !== "rascunho") return reply.code(409).send({ error: documentLockedMessage(document.status) });

    const data = await request.file();
    if (!data) return reply.code(400).send({ error: "Ficheiro em falta" });
    const filename = (data.filename || "").toLowerCase();
    if (filename && !/\.(xlsx|xls|pdf)$/i.test(filename)) {
      return reply.code(400).send({ error: "Só são aceites Excel (.xlsx / .xls) ou PDF de mapa de quantidades." });
    }
    const buffer = await data.toBuffer();
    try {
      return await previewMeasurementsImport(id, buffer, companyId, data.filename || "");
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "Erro ao ler medições" });
    }
  });

  app.post("/api/budget-documents/:id/import-measurements/apply", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = companyIdOf(request);
    const document = await assertDocumentOwned(id, companyId);
    if (!document) return reply.code(404).send({ error: "Documento não encontrado" });
    if (document.status !== "rascunho") return reply.code(409).send({ error: documentLockedMessage(document.status) });

    let buffer: Buffer | null = null;
    let filename = "";
    let jobId = "";
    let decisionsRaw = "";
    let saveToCompanyTemplate = false;
    const parts = request.parts();
    for await (const part of parts) {
      if (part.type === "file" && part.fieldname === "file") {
        filename = part.filename || "";
        const lower = filename.toLowerCase();
        if (lower && !/\.(xlsx|xls|pdf)$/i.test(lower)) {
          return reply.code(400).send({ error: "Só são aceites Excel (.xlsx / .xls) ou PDF de mapa de quantidades." });
        }
        buffer = await part.toBuffer();
      } else if (part.type === "field" && part.fieldname === "jobId") {
        jobId = String(part.value ?? "");
      } else if (part.type === "field" && part.fieldname === "decisions") {
        decisionsRaw = String(part.value ?? "");
      } else if (part.type === "field" && part.fieldname === "saveToCompanyTemplate") {
        saveToCompanyTemplate = String(part.value) === "true";
      }
    }
    if (!decisionsRaw.trim()) {
      return reply.code(400).send({ error: "É necessário confirmar as decisões de importação." });
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(decisionsRaw);
    } catch {
      return reply.code(400).send({ error: "Decisões de importação inválidas" });
    }
    const validated = importApplyDecisionsSchema.safeParse(parsedJson);
    if (!validated.success) {
      return reply.code(400).send({ error: "Decisões de importação inválidas", details: validated.error.flatten() });
    }

    try {
      if (jobId) {
        return await applyMeasurementImportJob(jobId, companyId, id, validated.data, { saveToCompanyTemplate });
      }
      if (!buffer) return reply.code(400).send({ error: "Ficheiro ou jobId em falta" });
      return await applyMeasurementsImport(id, buffer, companyId, validated.data, {
        saveToCompanyTemplate,
        filename,
      });
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "Erro ao aplicar medições" });
    }
  });

  // Endpoint legado desactivado — forçar fluxo preview/apply com revisão humana.
  app.post("/api/budget-documents/:id/import-measurements", { preHandler: requireRole(...WRITE_ROLES) }, async (_request, reply) => {
    return reply.code(410).send({
      error: "Este endpoint foi desactivado. Use /import-measurements/preview e /import-measurements/apply.",
    });
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
      const composition = await assertCompositionVisible(data.compositionId, companyId, request.currentUser!.id);
      if (!composition) return reply.code(400).send({ error: "Composição de custo não encontrada" });
      const zoneId = await getZoneIdForSection(id);
      const breakdown = await computeCompositionUnitCostV2(data.compositionId, companyId, zoneId);
      unitPrice = breakdown.unitCost;
      origin = "composicao";
    }

    const zoneIdForSnapshot = data.compositionId ? await getZoneIdForSection(id) : null;
    const item = await db.transaction(async (tx) => {
      const [created] = await tx
      .insert(lineItems)
      .values({
        ...data,
        sectionId: id,
        unitPrice: unitPrice !== null ? fixedSigo(unitPrice) : null,
        quantity: data.quantity !== undefined && data.quantity !== null ? fixedSigo(data.quantity) : null,
        origin,
      })
      .returning();
      if (data.compositionId) await createLineItemCostSnapshot({ lineItemId: created.id, compositionId: data.compositionId, companyId, zoneId: zoneIdForSnapshot, currency: document.currency, reason: "attached" }, tx);
      return created;
    });
    return reply.code(201).send(item);
  });

  app.get("/api/line-items/:id/cost-snapshots", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = companyIdOf(request);
    const existing = await assertLineItemOwned(id, companyId);
    if (!existing) return reply.code(404).send({ error: "Item não encontrado" });
    const snapshots = await listLineItemCostSnapshots(id);
    return {
      lineItemId: id,
      compositionId: existing.compositionId,
      latest: snapshots[0] ?? null,
      snapshots,
    };
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
      const composition = await assertCompositionVisible(data.compositionId, companyId, request.currentUser!.id);
      if (!composition) return reply.code(400).send({ error: "Composição de custo não encontrada" });
      const zoneId = await getZoneIdForSection(existing.sectionId);
      const breakdown = await computeCompositionUnitCostV2(data.compositionId, companyId, zoneId);
      unitPrice = breakdown.unitCost;
      origin = "composicao";
    } else if (data.compositionId === null) {
      origin = "manual";
    }

    const zoneIdForSnapshot = data.compositionId ? await getZoneIdForSection(existing.sectionId) : null;
    const row = await db.transaction(async (tx) => {
      const [updated] = await tx
      .update(lineItems)
      .set({
        ...data,
        ...(description !== undefined ? { description } : {}),
        unitPrice: unitPrice !== undefined ? (unitPrice !== null ? fixedSigo(unitPrice) : null) : undefined,
        quantity: data.quantity !== undefined ? (data.quantity !== null ? fixedSigo(data.quantity) : null) : undefined,
        quantitySource: data.quantity !== undefined ? "manual" : undefined,
        origin,
      })
      .where(eq(lineItems.id, id))
      .returning();
      if (data.compositionId) await createLineItemCostSnapshot({ lineItemId: updated.id, compositionId: data.compositionId, companyId, zoneId: zoneIdForSnapshot, currency: document.currency, reason: "attached" }, tx);
      return updated;
    });
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

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, desc, count, or, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  projects,
  budgetDocuments,
  subscriptions,
  materials,
  projectMaterialSpecifications,
} from "../db/schema.js";
import { requireCompanyUser, requireRole } from "../auth/middleware.js";
import { assertProjectOwned } from "../services/accessControl.js";
import { generateStandardBoq } from "../services/boqTemplate.js";
import { getStandardSectionId } from "../services/quickEstimate.js";
import { resolveOrCreateMaterialByName } from "../services/materialResolution.js";
import { CURRENCIES, DEFAULT_IVA_RATE, getPlanDefinition, UNITS } from "@sigo/shared";

const WRITE_ROLES = ["admin_empresa", "orcamentista"] as const;

const materialSpecificationSchema = z.object({
  name: z.string().trim().min(2).max(200),
  unit: z.enum(UNITS),
  specification: z.string().trim().max(1000).optional(),
});

const projectSchema = z.object({
  name: z.string().min(1),
  client: z.string().optional(),
  bairro: z.string().optional(),
  talhao: z.string().optional(),
  distrito: z.string().optional(),
  provincia: z.string().optional(),
  phase: z.string().optional(),
  zoneId: z.string().uuid().nullable().optional(),
  currency: z.enum(CURRENCIES).default("MZN"),
  projectType: z.enum(["medicao", "orcamento", "hibrido"]).default("orcamento"),
  measurementMode: z.enum(["plantas", "manual", "importar"]).default("plantas"),
  ivaRate: z.number().min(0).max(1).default(DEFAULT_IVA_RATE),
  contingenciasRate: z.number().min(0).max(1).default(0.1),
  siteCostsRate: z.number().min(0).max(1).default(0),
  indirectCostsRate: z.number().min(0).max(1).default(0),
  profitMarginRate: z.number().min(0).max(1).default(0),
  materialSpecifications: z.array(materialSpecificationSchema).max(50).default([]),
});
const projectUpdateSchema = projectSchema.omit({ materialSpecifications: true }).partial();

async function linkMaterialSpecification(
  projectId: string,
  companyId: string,
  input: z.infer<typeof materialSpecificationSchema>,
) {
  const resolved = await resolveOrCreateMaterialByName(companyId, input);
  const [link] = await db
    .insert(projectMaterialSpecifications)
    .values({
      projectId,
      materialId: resolved.material.id,
      specification: input.specification?.trim() || null,
      source: "manual",
    })
    .onConflictDoUpdate({
      target: [projectMaterialSpecifications.projectId, projectMaterialSpecifications.materialId],
      set: { specification: input.specification?.trim() || null },
    })
    .returning();
  return { link, material: resolved.material, createdMaterial: resolved.created };
}

export async function projectRoutes(app: FastifyInstance) {
  app.get("/api/projects", { preHandler: requireCompanyUser }, async (request) => {
    const companyId = request.currentUser!.companyId!;
    return db.select().from(projects).where(eq(projects.companyId, companyId)).orderBy(projects.createdAt);
  });

  app.get("/api/projects/:id", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.currentUser!.companyId!;
    const [project] = await db.select().from(projects).where(and(eq(projects.id, id), eq(projects.companyId, companyId))).limit(1);
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });
    return project;
  });

  app.post("/api/projects", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const parsed = projectSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const companyId = request.currentUser!.companyId!;

    // Limite de projectos do plano actual — o sistema não distingue projectos "activos" de
    // arquivados ainda, por isso o limite aplica-se ao total de projectos da empresa.
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.companyId, companyId)).orderBy(desc(subscriptions.createdAt)).limit(1);
    const plan = getPlanDefinition(sub?.plan ?? "free");
    if (plan?.maxProjects != null) {
      const [{ value: currentProjects }] = await db.select({ value: count() }).from(projects).where(eq(projects.companyId, companyId));
      if (currentProjects >= plan.maxProjects) {
        return reply.code(403).send({
          error: `O plano "${plan.label}" permite até ${plan.maxProjects} projecto(s). Contacte o suporte para actualizar de plano.`,
        });
      }
    }

    const {
      ivaRate,
      contingenciasRate,
      siteCostsRate,
      indirectCostsRate,
      profitMarginRate,
      materialSpecifications,
      ...rest
    } = parsed.data;
    const [project] = await db
      .insert(projects)
      .values({
        ...rest,
        companyId,
        ivaRate: ivaRate.toString(),
        contingenciasRate: contingenciasRate.toString(),
        siteCostsRate: siteCostsRate.toString(),
        indirectCostsRate: indirectCostsRate.toString(),
        profitMarginRate: profitMarginRate.toString(),
      })
      .returning();

    // Cada projecto novo nasce com um Mapa de Quantidades já estruturado (capítulos e
    // trabalhos padrão com preços do catálogo) — o utilizador só preenche quantidades
    // por medições, em vez de construir o mapa do zero.
    const isMeasurementProject = project.projectType === "medicao";
    const [document] = await db
      .insert(budgetDocuments)
      .values({
        projectId: project.id,
        title: isMeasurementProject ? "Medição de Quantidades" : "Mapa de Quantidades",
        documentType: isMeasurementProject ? "medicao" : "orcamento",
        revision: "0",
        // O catálogo e as composições automáticas são actualmente mantidos em MZN. Um mapa
        // automático nunca deve receber custos MZN e apresentá-los como USD; projectos cuja
        // moeda de gestão é USD continuam a poder ter documentos manuais/importados em USD.
        currency: "MZN",
        ivaRate: ivaRate.toString(),
        contingenciasRate: contingenciasRate.toString(),
        siteCostsRate: siteCostsRate.toString(),
        indirectCostsRate: indirectCostsRate.toString(),
        profitMarginRate: profitMarginRate.toString(),
      })
      .returning();
    await generateStandardBoq(document.id, companyId, project.zoneId, "Edifício Principal", !isMeasurementProject);
    for (const specification of materialSpecifications) {
      await linkMaterialSpecification(project.id, companyId, specification);
    }

    return reply.code(201).send({ ...project, defaultDocumentId: document.id });
  });

  app.get("/api/projects/:id/material-specifications", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.currentUser!.companyId!;
    const project = await assertProjectOwned(id, companyId);
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });

    const rows = await db
      .select({
        id: projectMaterialSpecifications.id,
        materialId: materials.id,
        name: materials.name,
        unit: materials.unit,
        specification: projectMaterialSpecifications.specification,
        baseUnitCost: materials.baseUnitCost,
        currency: materials.currency,
        createdAt: projectMaterialSpecifications.createdAt,
      })
      .from(projectMaterialSpecifications)
      .innerJoin(materials, eq(projectMaterialSpecifications.materialId, materials.id))
      .where(eq(projectMaterialSpecifications.projectId, id))
      .orderBy(projectMaterialSpecifications.createdAt);

    return rows.map((row) => ({ ...row, pricePending: Number(row.baseUnitCost) <= 0 }));
  });

  app.post("/api/projects/:id/material-specifications", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.currentUser!.companyId!;
    const project = await assertProjectOwned(id, companyId);
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });
    const parsed = materialSpecificationSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const result = await linkMaterialSpecification(id, companyId, parsed.data);
    return reply.code(201).send({
      id: result.link.id,
      materialId: result.material.id,
      name: result.material.name,
      unit: result.material.unit,
      specification: result.link.specification,
      baseUnitCost: result.material.baseUnitCost,
      currency: result.material.currency,
      pricePending: Number(result.material.baseUnitCost) <= 0,
      createdMaterial: result.createdMaterial,
    });
  });

  // Resolve o mapa seguro para o percurso planta → diagnóstico → medição. Reutiliza um rascunho
  // automático compatível; documentos importados/manuais nunca são escolhidos por acaso. Se não
  // existir nenhum, cria um mapa padrão novo sem obrigar o utilizador a passar pela estrutura
  // manual do orçamento.
  app.post("/api/projects/:id/measurement-workspace", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.currentUser!.companyId!;
    const project = await assertProjectOwned(id, companyId);
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });

    const drafts = await db
      .select()
      .from(budgetDocuments)
      .where(and(
        eq(budgetDocuments.projectId, id),
        eq(budgetDocuments.status, "rascunho"),
        eq(budgetDocuments.currency, "MZN"),
        eq(budgetDocuments.documentType, "medicao"),
      ))
      .orderBy(desc(budgetDocuments.createdAt));

    for (const document of drafts) {
      if (await getStandardSectionId(document.id)) return { document, created: false };
    }

    const [document] = await db
      .insert(budgetDocuments)
      .values({
        projectId: id,
        title: "Medição de Quantidades",
        documentType: "medicao",
        revision: `Auto ${drafts.length + 1}`,
        currency: "MZN",
        ivaRate: project.ivaRate,
        contingenciasRate: project.contingenciasRate,
        siteCostsRate: project.siteCostsRate,
        indirectCostsRate: project.indirectCostsRate,
        profitMarginRate: project.profitMarginRate,
      })
      .returning();
    await generateStandardBoq(document.id, companyId, project.zoneId, "Edifício Principal", false);
    return reply.code(201).send({ document, created: true });
  });

  app.put("/api/projects/:id", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.currentUser!.companyId!;
    const parsed = projectUpdateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { ivaRate, contingenciasRate, siteCostsRate, indirectCostsRate, profitMarginRate, ...rest } = parsed.data;

    const [row] = await db
      .update(projects)
      .set({
        ...rest,
        ivaRate: ivaRate !== undefined ? ivaRate.toString() : undefined,
        contingenciasRate: contingenciasRate !== undefined ? contingenciasRate.toString() : undefined,
        siteCostsRate: siteCostsRate !== undefined ? siteCostsRate.toString() : undefined,
        indirectCostsRate: indirectCostsRate !== undefined ? indirectCostsRate.toString() : undefined,
        profitMarginRate: profitMarginRate !== undefined ? profitMarginRate.toString() : undefined,
      })
      .where(and(eq(projects.id, id), eq(projects.companyId, companyId)))
      .returning();
    if (!row) return reply.code(404).send({ error: "Projecto não encontrado" });
    return row;
  });

  app.delete("/api/projects/:id", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.currentUser!.companyId!;
    await db.delete(projects).where(and(eq(projects.id, id), eq(projects.companyId, companyId)));
    return { ok: true };
  });
}

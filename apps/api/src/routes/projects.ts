import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, desc, count } from "drizzle-orm";
import { db } from "../db/index.js";
import { projects, budgetDocuments, subscriptions } from "../db/schema.js";
import { requireCompanyUser, requireRole } from "../auth/middleware.js";
import { generateStandardBoq } from "../services/boqTemplate.js";
import { CURRENCIES, getPlanDefinition } from "@sigo/shared";

const WRITE_ROLES = ["admin_empresa", "orcamentista"] as const;

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
  ivaRate: z.number().min(0).max(1).default(0.17),
  contingenciasRate: z.number().min(0).max(1).default(0.1),
});
const projectUpdateSchema = projectSchema.partial();

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

    const { ivaRate, contingenciasRate, ...rest } = parsed.data;
    const [project] = await db
      .insert(projects)
      .values({ ...rest, companyId, ivaRate: ivaRate.toString(), contingenciasRate: contingenciasRate.toString() })
      .returning();

    // Cada projecto novo nasce com um Mapa de Quantidades já estruturado (capítulos e
    // trabalhos padrão com preços do catálogo) — o utilizador só preenche quantidades
    // por medições, em vez de construir o mapa do zero.
    const [document] = await db
      .insert(budgetDocuments)
      .values({
        projectId: project.id,
        title: "Mapa de Quantidades",
        revision: "0",
        currency: rest.currency,
        ivaRate: ivaRate.toString(),
        contingenciasRate: contingenciasRate.toString(),
      })
      .returning();
    await generateStandardBoq(document.id, companyId, project.zoneId);

    return reply.code(201).send({ ...project, defaultDocumentId: document.id });
  });

  app.put("/api/projects/:id", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.currentUser!.companyId!;
    const parsed = projectUpdateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { ivaRate, contingenciasRate, ...rest } = parsed.data;

    const [row] = await db
      .update(projects)
      .set({
        ...rest,
        ivaRate: ivaRate !== undefined ? ivaRate.toString() : undefined,
        contingenciasRate: contingenciasRate !== undefined ? contingenciasRate.toString() : undefined,
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

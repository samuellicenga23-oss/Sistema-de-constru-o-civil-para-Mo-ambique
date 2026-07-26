import type { FastifyInstance } from "fastify";
import { eq, inArray, count } from "drizzle-orm";
import { db } from "../db/index.js";
import { projects, budgetDocuments, measurementCertificates, plants } from "../db/schema.js";
import { requireCompanyUser } from "../auth/middleware.js";
import { getBudgetDocumentSummary } from "../services/boqEngine.js";

export async function dashboardRoutes(app: FastifyInstance) {
  app.get("/api/dashboard", { preHandler: requireCompanyUser }, async (request) => {
    const companyId = request.currentUser!.companyId!;

    const companyProjects = await db.select().from(projects).where(eq(projects.companyId, companyId));
    const projectIds = companyProjects.map((p) => p.id);

    let documents: (typeof budgetDocuments.$inferSelect)[] = [];
    if (projectIds.length) {
      documents = await db.select().from(budgetDocuments).where(inArray(budgetDocuments.projectId, projectIds));
    }

    // Cada projecto pode ter a sua própria moeda — não somar valores entre moedas diferentes,
    // por isso o total é apresentado por projecto, não como uma soma global única.
    const projectSummaries = await Promise.all(
      companyProjects.map(async (p) => {
        const projectDocs = documents.filter((d) => d.projectId === p.id);
        const summaries = await Promise.all(projectDocs.map((d) => getBudgetDocumentSummary(d.id)));
        const total = summaries.reduce((sum, s) => sum + (s?.total ?? 0), 0);
        return { id: p.id, name: p.name, currency: p.currency, documentCount: projectDocs.length, total };
      })
    );

    const [certificatesRow] = projectIds.length
      ? await db.select({ value: count() }).from(measurementCertificates).where(inArray(measurementCertificates.projectId, projectIds))
      : [{ value: 0 }];

    const [plantsRow] = projectIds.length
      ? await db.select({ value: count() }).from(plants).where(inArray(plants.projectId, projectIds))
      : [{ value: 0 }];

    return {
      totalProjects: companyProjects.length,
      totalDocuments: documents.length,
      totalCertificates: Number(certificatesRow.value),
      totalPlants: Number(plantsRow.value),
      projects: projectSummaries.sort((a, b) => b.total - a.total).slice(0, 8),
    };
  });
}

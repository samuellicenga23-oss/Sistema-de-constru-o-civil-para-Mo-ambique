import type { FastifyInstance } from "fastify";
import { eq, inArray, count, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { projects, budgetDocuments, measurementCertificates, plants, financialEntries, purchaseOrders } from "../db/schema.js";
import { requireCompanyUser } from "../auth/middleware.js";
import { getBudgetDocumentSummary } from "../services/boqEngine.js";

// Soma por moeda — nunca um único número global, porque projectos diferentes da mesma empresa
// podem estar em MZN ou USD (mesmo princípio já usado no resumo financeiro por projecto).
type CurrencyTotals = Record<string, number>;
function addTo(totals: CurrencyTotals, currency: string, amount: number) {
  totals[currency] = (totals[currency] ?? 0) + amount;
}

export async function dashboardRoutes(app: FastifyInstance) {
  app.get("/api/dashboard", { preHandler: requireCompanyUser }, async (request) => {
    const companyId = request.currentUser!.companyId!;

    const companyProjects = await db.select().from(projects).where(eq(projects.companyId, companyId));
    const projectIds = companyProjects.map((p) => p.id);
    const projectNameById = new Map(companyProjects.map((p) => [p.id, p.name]));

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

    // Financeiro agregado de todos os projectos da empresa (contas a pagar/receber, recebido,
    // despesas) — pedido explícito da Fase 1 para o painel principal, antes só existia por
    // projecto individual (Módulo Financeiro).
    const allEntries = projectIds.length ? await db.select().from(financialEntries).where(inArray(financialEntries.projectId, projectIds)) : [];
    const contasAPagar: CurrencyTotals = {};
    const contasAReceber: CurrencyTotals = {};
    const valorRecebido: CurrencyTotals = {};
    const despesas: CurrencyTotals = {};
    const today = new Date().toISOString().slice(0, 10);
    let contasVencidas = 0;

    for (const e of allEntries) {
      const amount = Number(e.amount);
      if (e.type === "receita") {
        if (e.status === "pago") addTo(valorRecebido, e.currency, amount);
        else {
          addTo(contasAReceber, e.currency, amount);
          if (e.dueDate && e.dueDate < today) contasVencidas++;
        }
      } else {
        if (e.status === "pago") addTo(despesas, e.currency, amount);
        else {
          addTo(contasAPagar, e.currency, amount);
          if (e.dueDate && e.dueDate < today) contasVencidas++;
        }
      }
    }

    // Ordens de compra ainda não recebidas nem canceladas — "pendente" no sentido de ainda
    // precisar de acção (aprovar, ou aguardar entrega).
    const allOrders = projectIds.length ? await db.select({ status: purchaseOrders.status }).from(purchaseOrders).where(inArray(purchaseOrders.projectId, projectIds)) : [];
    const ordensCompraPendentes = allOrders.filter((o) => o.status === "rascunho" || o.status === "aprovado").length;

    const recentCertificates = projectIds.length
      ? await db
          .select({
            id: measurementCertificates.id,
            number: measurementCertificates.number,
            periodDate: measurementCertificates.periodDate,
            status: measurementCertificates.status,
            projectId: measurementCertificates.projectId,
          })
          .from(measurementCertificates)
          .where(inArray(measurementCertificates.projectId, projectIds))
          .orderBy(desc(measurementCertificates.createdAt))
          .limit(5)
      : [];

    return {
      totalProjects: companyProjects.length,
      totalDocuments: documents.length,
      totalCertificates: Number(certificatesRow.value),
      totalPlants: Number(plantsRow.value),
      projects: projectSummaries.sort((a, b) => b.total - a.total).slice(0, 8),
      contasAPagar,
      contasAReceber,
      valorRecebido,
      despesas,
      contasVencidas,
      ordensCompraPendentes,
      recentCertificates: recentCertificates.map((c) => ({ ...c, projectName: projectNameById.get(c.projectId) ?? "" })),
    };
  });
}

import type { FastifyInstance } from "fastify";
import { and, eq, inArray, count, desc, lt, sum } from "drizzle-orm";
import { db } from "../db/index.js";
import { projects, budgetDocuments, measurementCertificates, plants, financialEntries, purchaseOrders } from "../db/schema.js";
import { requireCompanyUser } from "../auth/middleware.js";
import { getBudgetDocumentTotals } from "../services/boqEngine.js";

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
    const documentTotals = await getBudgetDocumentTotals(documents);
    const documentsByProject = new Map<string, typeof documents>();
    for (const document of documents) {
      const list = documentsByProject.get(document.projectId) ?? [];
      list.push(document);
      documentsByProject.set(document.projectId, list);
    }
    const projectSummaries = companyProjects.map((p) => {
      const projectDocs = documentsByProject.get(p.id) ?? [];
      const total = projectDocs.reduce((sum, document) => sum + (documentTotals.get(document.id) ?? 0), 0);
      return { id: p.id, name: p.name, currency: p.currency, documentCount: projectDocs.length, total };
    });

    const [certificatesRow] = projectIds.length
      ? await db.select({ value: count() }).from(measurementCertificates).where(inArray(measurementCertificates.projectId, projectIds))
      : [{ value: 0 }];

    const [plantsRow] = projectIds.length
      ? await db.select({ value: count() }).from(plants).where(inArray(plants.projectId, projectIds))
      : [{ value: 0 }];

    // Financeiro agregado de todos os projectos da empresa (contas a pagar/receber, recebido,
    // despesas) — pedido explícito da Fase 1 para o painel principal, antes só existia por
    // projecto individual (Módulo Financeiro).
    const financialGroups = projectIds.length
      ? await db
          .select({ type: financialEntries.type, status: financialEntries.status, currency: financialEntries.currency, amount: sum(financialEntries.amount) })
          .from(financialEntries)
          .where(inArray(financialEntries.projectId, projectIds))
          .groupBy(financialEntries.type, financialEntries.status, financialEntries.currency)
      : [];
    const contasAPagar: CurrencyTotals = {};
    const contasAReceber: CurrencyTotals = {};
    const valorRecebido: CurrencyTotals = {};
    const despesas: CurrencyTotals = {};
    const today = new Date().toISOString().slice(0, 10);
    let contasVencidas = 0;

    for (const e of financialGroups) {
      const amount = Number(e.amount ?? 0);
      if (e.type === "receita") {
        if (e.status === "pago") addTo(valorRecebido, e.currency, amount);
        else addTo(contasAReceber, e.currency, amount);
      } else {
        if (e.status === "pago") addTo(despesas, e.currency, amount);
        else addTo(contasAPagar, e.currency, amount);
      }
    }
    if (projectIds.length) {
      const [overdue] = await db
        .select({ value: count() })
        .from(financialEntries)
        .where(and(
          inArray(financialEntries.projectId, projectIds),
          eq(financialEntries.status, "pendente"),
          lt(financialEntries.dueDate, today),
        ));
      contasVencidas = Number(overdue.value);
    }

    // Ordens de compra ainda não recebidas nem canceladas — "pendente" no sentido de ainda
    // precisar de acção (aprovar, ou aguardar entrega).
    const [pendingOrders] = projectIds.length
      ? await db.select({ value: count() }).from(purchaseOrders).where(and(
          inArray(purchaseOrders.projectId, projectIds),
          inArray(purchaseOrders.status, ["rascunho", "aprovado"]),
        ))
      : [{ value: 0 }];
    const ordensCompraPendentes = Number(pendingOrders.value);

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

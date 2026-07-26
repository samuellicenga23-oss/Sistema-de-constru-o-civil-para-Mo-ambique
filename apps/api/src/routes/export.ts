import type { FastifyInstance } from "fastify";
import { requireCompanyUser } from "../auth/middleware.js";
import { assertDocumentOwned } from "../services/accessControl.js";
import { getBudgetDocumentSummary } from "../services/boqEngine.js";
import { buildBudgetDocumentExcel } from "../services/excelExport.js";
import { buildBudgetDocumentPdf } from "../services/pdfExport.js";

export async function exportRoutes(app: FastifyInstance) {
  app.get("/api/budget-documents/:id/export.xlsx", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.currentUser!.companyId!;
    const document = await assertDocumentOwned(id, companyId);
    if (!document) return reply.code(404).send({ error: "Documento não encontrado" });

    const summary = await getBudgetDocumentSummary(id);
    if (!summary) return reply.code(404).send({ error: "Documento não encontrado" });

    const buffer = await buildBudgetDocumentExcel(summary);
    reply
      .header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .header("Content-Disposition", `attachment; filename="${document.title.replace(/[^\w\- ]/g, "")}.xlsx"`)
      .send(buffer);
  });

  app.get("/api/budget-documents/:id/export.pdf", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.currentUser!.companyId!;
    const document = await assertDocumentOwned(id, companyId);
    if (!document) return reply.code(404).send({ error: "Documento não encontrado" });

    const summary = await getBudgetDocumentSummary(id);
    if (!summary) return reply.code(404).send({ error: "Documento não encontrado" });

    const buffer = await buildBudgetDocumentPdf(summary);
    reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `attachment; filename="${document.title.replace(/[^\w\- ]/g, "")}.pdf"`)
      .send(buffer);
  });
}

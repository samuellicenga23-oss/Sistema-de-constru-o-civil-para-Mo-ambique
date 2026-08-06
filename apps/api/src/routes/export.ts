import type { FastifyInstance } from "fastify";
import { requireCompanyUser } from "../auth/middleware.js";
import { assertDocumentOwned } from "../services/accessControl.js";
import { getBudgetDocumentSummary } from "../services/boqEngine.js";
import { loadCompanyBrand } from "../services/companyBrand.js";
import { buildBudgetDocumentExcel, buildMeasurementDocumentExcel } from "../services/excelExport.js";
import { buildBudgetDocumentPdf, buildMeasurementDocumentPdf } from "../services/pdfExport.js";

export async function exportRoutes(app: FastifyInstance) {
  app.get("/api/budget-documents/:id/export.xlsx", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.currentUser!.companyId!;
    const document = await assertDocumentOwned(id, companyId);
    if (!document) return reply.code(404).send({ error: "Documento não encontrado" });

    const summary = await getBudgetDocumentSummary(id);
    if (!summary) return reply.code(404).send({ error: "Documento não encontrado" });
    const brand = await loadCompanyBrand(companyId);

    const buffer = await buildBudgetDocumentExcel(summary, brand);
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
    const brand = await loadCompanyBrand(companyId);

    const buffer = await buildBudgetDocumentPdf(summary, brand);
    reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `attachment; filename="${document.title.replace(/[^\w\- ]/g, "")}.pdf"`)
      .send(buffer);
  });

  app.get("/api/budget-documents/:id/export-measurements.xlsx", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.currentUser!.companyId!;
    const document = await assertDocumentOwned(id, companyId);
    if (!document) return reply.code(404).send({ error: "Medição não encontrada" });
    const summary = await getBudgetDocumentSummary(id);
    if (!summary) return reply.code(404).send({ error: "Medição não encontrada" });
    const brand = await loadCompanyBrand(companyId);
    const buffer = await buildMeasurementDocumentExcel(summary, brand);
    reply
      .header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .header("Content-Disposition", `attachment; filename="${document.title.replace(/[^\w\- ]/g, "")}-quantidades.xlsx"`)
      .send(buffer);
  });

  app.get("/api/budget-documents/:id/export-measurements.pdf", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.currentUser!.companyId!;
    const document = await assertDocumentOwned(id, companyId);
    if (!document) return reply.code(404).send({ error: "Medição não encontrada" });
    const summary = await getBudgetDocumentSummary(id);
    if (!summary) return reply.code(404).send({ error: "Medição não encontrada" });
    const brand = await loadCompanyBrand(companyId);
    const buffer = await buildMeasurementDocumentPdf(summary, brand);
    reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `attachment; filename="${document.title.replace(/[^\w\- ]/g, "")}-quantidades.pdf"`)
      .send(buffer);
  });
}

import type { FastifyInstance } from "fastify";
import { requireCompanyUser } from "../auth/middleware.js";
import { assertDocumentOwned } from "../services/accessControl.js";
import { computeMaterialsByPhase } from "../services/materialsByPhase.js";
import { buildMaterialsByPhasePdf } from "../services/materialsByPhaseExport.js";
import { buildMaterialsByPhaseExcel } from "../services/materialsByPhaseExcelExport.js";

export async function materialsByPhaseRoutes(app: FastifyInstance) {
  app.get("/api/budget-documents/:id/materials-by-phase", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.currentUser!.companyId!;
    const document = await assertDocumentOwned(id, companyId);
    if (!document) return reply.code(404).send({ error: "Documento não encontrado" });

    const result = await computeMaterialsByPhase(id, companyId);
    if (!result) return reply.code(404).send({ error: "Documento não encontrado" });
    return { document: { id: document.id, title: document.title }, ...result };
  });

  app.get("/api/budget-documents/:id/materials-by-phase/export.pdf", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.currentUser!.companyId!;
    const document = await assertDocumentOwned(id, companyId);
    if (!document) return reply.code(404).send({ error: "Documento não encontrado" });

    const result = await computeMaterialsByPhase(id, companyId);
    if (!result) return reply.code(404).send({ error: "Documento não encontrado" });

    const buffer = await buildMaterialsByPhasePdf(document.title, result);
    reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `attachment; filename="Materiais por Fase - ${document.title.replace(/[^\w\- ]/g, "")}.pdf"`)
      .send(buffer);
  });

  app.get("/api/budget-documents/:id/materials-by-phase/export.xlsx", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.currentUser!.companyId!;
    const document = await assertDocumentOwned(id, companyId);
    if (!document) return reply.code(404).send({ error: "Documento não encontrado" });

    const result = await computeMaterialsByPhase(id, companyId);
    if (!result) return reply.code(404).send({ error: "Documento não encontrado" });

    const buffer = await buildMaterialsByPhaseExcel(document.title, result);
    reply
      .header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .header("Content-Disposition", `attachment; filename="Materiais por Fase - ${document.title.replace(/[^\w\- ]/g, "")}.xlsx"`)
      .send(buffer);
  });
}

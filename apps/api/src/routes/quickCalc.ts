import type { FastifyInstance } from "fastify";
import { requireCompanyUser } from "../auth/middleware.js";
import { buildQuickCalcPdf } from "../services/quickCalcExport.js";
import { quickCalcResultSchema } from "@sigo/shared";
import { loadCompanyBrand } from "../services/companyBrand.js";

// Módulo de Cálculos Rápidos: calculadoras avulsas para a obra (ex: laje, betão simples), sem
// ligação a nenhum projecto/documento — só exportação directa a PDF do que foi calculado.
export async function quickCalcRoutes(app: FastifyInstance) {
  app.post("/api/quick-calc/export.pdf", { preHandler: requireCompanyUser }, async (request, reply) => {
    const parsed = quickCalcResultSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const brand = await loadCompanyBrand(request.currentUser!.companyId!);

    const buffer = await buildQuickCalcPdf(parsed.data, brand);
    reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `attachment; filename="calculo-rapido.pdf"`)
      .send(buffer);
  });
}

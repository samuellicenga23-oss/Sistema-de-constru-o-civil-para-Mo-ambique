import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { requireCompanyUser } from "../auth/middleware.js";
import { assertPlantOwned } from "../services/accessControl.js";
import { assertEntryOwned } from "./siteDiary.js";
import { env } from "../env.js";

const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

// Ficheiros privados (plantas PDF e fotos do diário de obra) — antes serviam-se pela rota
// estática pública /uploads/, acessíveis a qualquer pessoa que adivinhasse/obtivesse o nome
// do ficheiro (achado da auditoria). Estas rotas exigem sessão e verificam a posse antes de
// devolver o conteúdo.
export async function fileRoutes(app: FastifyInstance) {
  app.get("/api/files/plants/:plantId", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { plantId } = request.params as { plantId: string };
    const companyId = request.currentUser!.companyId!;
    const plant = await assertPlantOwned(plantId, companyId);
    if (!plant) return reply.code(404).send({ error: "Planta não encontrada" });

    const buffer = await readFile(plant.filePath);
    reply.header("Content-Type", "application/pdf");
    const downloadName = path.basename(plant.originalFileName ?? "planta.pdf").replace(/["\r\n]/g, "_");
    reply.header("Content-Disposition", `inline; filename="${downloadName}"`);
    return reply.send(buffer);
  });

  app.get("/api/files/site-diary/:entryId/:filename", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { entryId, filename } = request.params as { entryId: string; filename: string };
    const companyId = request.currentUser!.companyId!;
    const entry = await assertEntryOwned(entryId, companyId);
    if (!entry) return reply.code(404).send({ error: "Registo não encontrado" });

    // O nome tem de estar literalmente listado nas fotos deste registo — impede quer o
    // acesso a ficheiros de outro registo/empresa, quer qualquer tentativa de path traversal
    // através do parâmetro (o valor nunca é usado directamente sem esta verificação).
    const safeName = path.basename(filename);
    const expectedUrl = `/api/files/site-diary/${entryId}/${safeName}`;
    if (!entry.photoUrls.includes(expectedUrl)) {
      return reply.code(404).send({ error: "Ficheiro não encontrado" });
    }

    const ext = path.extname(safeName).toLowerCase();
    const mime = IMAGE_MIME[ext];
    if (!mime) return reply.code(404).send({ error: "Ficheiro não encontrado" });

    const buffer = await readFile(path.join(env.uploadsDir, "site-diary", safeName));
    reply.header("Content-Type", mime);
    return reply.send(buffer);
  });
}

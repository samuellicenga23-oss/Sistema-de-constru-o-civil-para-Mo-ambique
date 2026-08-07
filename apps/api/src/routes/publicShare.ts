import type { FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { eq } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../db/index.js";
import { projects, siteDiaryEntries } from "../db/schema.js";
import { env } from "../env.js";
import { getPublicProjectSummary } from "../services/publicShare.js";

const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/**
 * Vista pública do dono da obra — sem login, atrás de um token imprevisível (nunca o ID do
 * projecto). Só devolve progresso, valor certificado (preço de venda, nunca custo interno) e
 * fotos do diário. Rate-limited: o token não é secreto o suficiente para dispensar isso, tal
 * como uma password de recuperação.
 */
export async function publicShareRoutes(app: FastifyInstance) {
  await app.register(rateLimit, { global: false });

  app.get(
    "/api/public/obra/:token",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { token } = request.params as { token: string };
      const summary = await getPublicProjectSummary(token);
      if (!summary) return reply.code(404).send({ error: "Link inválido ou desactivado" });
      return summary;
    },
  );

  app.get(
    "/api/public/obra/:token/foto/:entryId/:filename",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { token, entryId, filename } = request.params as { token: string; entryId: string; filename: string };

      const [project] = await db.select({ id: projects.id }).from(projects).where(eq(projects.publicShareToken, token)).limit(1);
      if (!project) return reply.code(404).send({ error: "Link inválido ou desactivado" });

      const [entry] = await db.select().from(siteDiaryEntries).where(eq(siteDiaryEntries.id, entryId)).limit(1);
      if (!entry || entry.projectId !== project.id) return reply.code(404).send({ error: "Ficheiro não encontrado" });

      // Mesma verificação anti-traversal da rota autenticada: o nome tem de estar literalmente
      // listado nas fotos deste registo, nunca usado directamente como caminho.
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
    },
  );
}

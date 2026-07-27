import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../db/index.js";
import { siteDiaryEntries, projects } from "../db/schema.js";
import { requireCompanyUser, requireRole } from "../auth/middleware.js";
import { assertProjectOwned } from "../services/accessControl.js";
import { detectImageExtension } from "../services/imageValidation.js";
import { buildSiteDiaryPdf } from "../services/siteDiaryExport.js";
import { env } from "../env.js";

const WRITE_ROLES = ["admin_empresa", "orcamentista", "engenheiro_fiscal"] as const;

function companyIdOf(request: FastifyRequest): string {
  return request.currentUser!.companyId!;
}

const entrySchema = z.object({
  date: z.string().min(1),
  weather: z.string().optional(),
  workersPresent: z.number().int().min(0).optional(),
  equipmentPresent: z.string().optional(),
  workDone: z.string().min(1),
  materialsReceived: z.string().optional(),
  materialsConsumed: z.string().optional(),
  visitors: z.string().optional(),
  inspectorInstructions: z.string().optional(),
  incidents: z.string().optional(),
  decisions: z.string().optional(),
  entryTime: z.string().optional(),
  exitTime: z.string().optional(),
});
const entryUpdateSchema = entrySchema.partial();

// Exportado para uso em routes/files.ts (serve as fotos do diário, agora autenticadas).
export async function assertEntryOwned(entryId: string, companyId: string) {
  const [entry] = await db.select().from(siteDiaryEntries).where(eq(siteDiaryEntries.id, entryId)).limit(1);
  if (!entry) return null;
  const project = await assertProjectOwned(entry.projectId, companyId);
  return project ? entry : null;
}

export async function siteDiaryRoutes(app: FastifyInstance) {
  app.get("/api/projects/:projectId/site-diary", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await assertProjectOwned(projectId, companyIdOf(request));
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });
    return db.select().from(siteDiaryEntries).where(eq(siteDiaryEntries.projectId, projectId)).orderBy(desc(siteDiaryEntries.date));
  });

  app.post("/api/projects/:projectId/site-diary", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await assertProjectOwned(projectId, companyIdOf(request));
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });

    const parsed = entrySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const [row] = await db
      .insert(siteDiaryEntries)
      .values({ ...parsed.data, projectId, createdByUserId: request.currentUser!.id })
      .returning();
    return reply.code(201).send(row);
  });

  app.put("/api/site-diary/:id", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const entry = await assertEntryOwned(id, companyIdOf(request));
    if (!entry) return reply.code(404).send({ error: "Registo não encontrado" });

    const parsed = entryUpdateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const [row] = await db.update(siteDiaryEntries).set(parsed.data).where(eq(siteDiaryEntries.id, id)).returning();
    return row;
  });

  app.delete("/api/site-diary/:id", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const entry = await assertEntryOwned(id, companyIdOf(request));
    if (!entry) return { ok: true };
    await db.delete(siteDiaryEntries).where(eq(siteDiaryEntries.id, id));
    return { ok: true };
  });

  app.post("/api/site-diary/:id/photos", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const entry = await assertEntryOwned(id, companyIdOf(request));
    if (!entry) return reply.code(404).send({ error: "Registo não encontrado" });

    const data = await request.file();
    if (!data) return reply.code(400).send({ error: "Ficheiro em falta" });
    const buffer = await data.toBuffer();
    const ext = detectImageExtension(buffer);
    if (!ext) return reply.code(400).send({ error: "Ficheiro inválido — só são aceites imagens PNG, JPG, WEBP ou GIF" });

    const uploadsDir = path.join(env.uploadsDir, "site-diary");
    await mkdir(uploadsDir, { recursive: true });
    const fileName = `${randomUUID()}${ext}`;
    await writeFile(path.join(uploadsDir, fileName), buffer);
    // Rota autenticada (routes/files.ts), não a antiga /uploads/ pública — a foto só é
    // acessível a quem tiver sessão na empresa dona do registo do diário.
    const photoUrl = `/api/files/site-diary/${id}/${fileName}`;

    const [row] = await db
      .update(siteDiaryEntries)
      .set({ photoUrls: [...entry.photoUrls, photoUrl] })
      .where(eq(siteDiaryEntries.id, id))
      .returning();
    return reply.code(201).send(row);
  });

  app.get("/api/site-diary/:id/export.pdf", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const entry = await assertEntryOwned(id, companyIdOf(request));
    if (!entry) return reply.code(404).send({ error: "Registo não encontrado" });
    const [project] = await db.select().from(projects).where(eq(projects.id, entry.projectId)).limit(1);
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });

    const buffer = await buildSiteDiaryPdf(entry, project);
    reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `attachment; filename="diario-obra-${entry.date}.pdf"`)
      .send(buffer);
  });

  app.delete("/api/site-diary/:id/photos", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const entry = await assertEntryOwned(id, companyIdOf(request));
    if (!entry) return reply.code(404).send({ error: "Registo não encontrado" });
    const { url } = request.query as { url?: string };
    if (!url) return reply.code(400).send({ error: "url em falta" });
    const [row] = await db
      .update(siteDiaryEntries)
      .set({ photoUrls: entry.photoUrls.filter((u) => u !== url) })
      .where(eq(siteDiaryEntries.id, id))
      .returning();
    return row;
  });
}

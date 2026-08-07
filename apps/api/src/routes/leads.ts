import type { FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../db/index.js";
import { commercialLeads, companies, users } from "../db/schema.js";
import { requireRole } from "../auth/middleware.js";
import { sendEmail, emailLayout, escapeHtml, safeContentDispositionFilename } from "../services/mailer.js";
import { detectProofFileExtension } from "../services/imageValidation.js";
import { env } from "../env.js";

const leadSchema = z.object({
  name: z.string().trim().min(1).max(150),
  company: z.string().trim().max(200).optional(),
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().max(60).optional(),
  nuit: z.string().trim().max(50).optional(),
  city: z.string().trim().max(150).optional(),
  teamSize: z.string().trim().max(60).optional(),
  planOrPack: z.string().trim().max(100).optional(),
  billingCycle: z.string().trim().max(20).optional(),
  notes: z.string().trim().max(2000).optional(),
});

async function notifySuperAdmins(lead: typeof commercialLeads.$inferSelect) {
  const admins = await db.select({ email: users.email }).from(users).where(and(eq(users.role, "super_admin"), eq(users.isActive, true)));
  const emails = admins.map((a) => a.email);
  if (!emails.length) return;
  void sendEmail(
    {
      to: emails,
      subject: `SIGO — Novo pedido comercial: ${lead.name}${lead.company ? ` (${lead.company})` : ""}`,
      html: emailLayout(
        "Novo pedido comercial",
        `<p><strong>${escapeHtml(lead.name)}</strong>${lead.company ? ` · ${escapeHtml(lead.company)}` : ""} pediu ${lead.planOrPack ? `«${escapeHtml(lead.planOrPack)}»` : "informação"}.</p>
         <p>Email: ${escapeHtml(lead.email)}${lead.phone ? ` · Telefone: ${escapeHtml(lead.phone)}` : ""}</p>
         ${lead.notes ? `<p>Notas: ${escapeHtml(lead.notes)}</p>` : ""}
         ${lead.proofFilePath ? "<p><strong>Anexou comprovativo de pagamento.</strong></p>" : ""}
         <p>Fonte: ${escapeHtml(lead.source)}</p>`,
        `${env.publicUrl}/admin`,
        "Ver no painel",
      ),
    },
    undefined,
  );
}

export async function leadRoutes(app: FastifyInstance) {
  await app.register(rateLimit, { global: false });

  // Formulário público (visitante sem conta) — CheckoutPage. Aceita multipart porque o
  // comprovativo de pagamento é opcional: quem já pagou anexa-o aqui e poupa uma volta.
  app.post(
    "/api/public/leads",
    { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } },
    async (request, reply) => {
      // Aceita tanto JSON simples (pedir contacto, sem pagar já) como multipart (com
      // comprovativo anexado) — percorre as partes explicitamente no caso multipart, porque
      // com só campos de texto e nenhum ficheiro, request.file() sozinho não garante que os
      // campos ficam acessíveis depois.
      let fields: Record<string, string>;
      let fileBuffer: Buffer | null = null;
      let fileName: string | null = null;
      if (request.isMultipart()) {
        fields = {};
        for await (const part of request.parts()) {
          if (part.type === "file") {
            fileBuffer = await part.toBuffer();
            fileName = part.filename;
          } else {
            fields[part.fieldname] = String(part.value ?? "");
          }
        }
      } else {
        fields = (request.body ?? {}) as Record<string, string>;
      }

      const parsed = leadSchema.safeParse({
        name: fields.name,
        company: fields.company || undefined,
        email: fields.email,
        phone: fields.phone || undefined,
        nuit: fields.nuit || undefined,
        city: fields.city || undefined,
        teamSize: fields.teamSize || undefined,
        planOrPack: fields.planOrPack || undefined,
        billingCycle: fields.billingCycle || undefined,
        notes: fields.notes || undefined,
      });
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

      let proofFilePath: string | null = null;
      let proofOriginalFileName: string | null = null;
      if (fileBuffer) {
        const ext = detectProofFileExtension(fileBuffer);
        if (!ext) return reply.code(400).send({ error: "Comprovativo inválido — envie uma imagem (PNG/JPG/WEBP/GIF) ou PDF" });
        const uploadsDir = path.join(env.uploadsDir, "lead-proofs");
        await mkdir(uploadsDir, { recursive: true });
        const savedFileName = `${randomUUID()}${ext}`;
        await writeFile(path.join(uploadsDir, savedFileName), fileBuffer);
        proofFilePath = `lead-proofs/${savedFileName}`;
        proofOriginalFileName = fileName?.slice(0, 300) ?? null;
      }

      const [lead] = await db
        .insert(commercialLeads)
        .values({ ...parsed.data, source: "checkout", companyId: null, proofFilePath, proofOriginalFileName })
        .returning();
      await notifySuperAdmins(lead);
      return reply.code(201).send({ ok: true });
    },
  );

  // Pedido de dentro da app já autenticada (mudar de plano, packs de créditos) — a empresa e o
  // utilizador já são conhecidos, não é preciso repetir nome/email.
  app.post("/api/companies/me/leads", { preHandler: requireRole("admin_empresa", "orcamentista") }, async (request, reply) => {
    const parsed = z
      .object({
        source: z.enum(["plan_upgrade", "credit_pack"]),
        planOrPack: z.string().trim().max(100).optional(),
        notes: z.string().trim().max(2000).optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const companyId = request.currentUser!.companyId!;
    const [company] = await db.select({ name: companies.name }).from(companies).where(eq(companies.id, companyId)).limit(1);

    const [lead] = await db
      .insert(commercialLeads)
      .values({
        companyId,
        source: parsed.data.source,
        name: request.currentUser!.name,
        company: company?.name ?? null,
        email: request.currentUser!.email,
        planOrPack: parsed.data.planOrPack ?? null,
        notes: parsed.data.notes ?? null,
      })
      .returning();
    await notifySuperAdmins(lead);
    return reply.code(201).send({ ok: true });
  });

  app.get("/api/admin/leads", { preHandler: requireRole("super_admin") }, async (request) => {
    const query = z.object({ status: z.enum(["novo", "contactado", "resolvido"]).optional() }).safeParse(request.query);
    const statusFilter = query.success ? query.data.status : undefined;
    return db
      .select()
      .from(commercialLeads)
      .where(statusFilter ? eq(commercialLeads.status, statusFilter) : undefined)
      .orderBy(desc(commercialLeads.createdAt));
  });

  app.get("/api/admin/leads/:id/proof", { preHandler: requireRole("super_admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [lead] = await db.select().from(commercialLeads).where(eq(commercialLeads.id, id)).limit(1);
    if (!lead?.proofFilePath) return reply.code(404).send({ error: "Sem comprovativo" });
    const fullPath = path.join(env.uploadsDir, lead.proofFilePath);
    const ext = path.extname(fullPath).toLowerCase();
    const contentType = ext === ".pdf" ? "application/pdf" : ext === ".png" ? "image/png" : ext === ".gif" ? "image/gif" : ext === ".webp" ? "image/webp" : "image/jpeg";
    reply.header("Content-Type", contentType);
    reply.header(
      "Content-Disposition",
      `inline; filename="${safeContentDispositionFilename(lead.proofOriginalFileName, `comprovativo${ext}`)}"`,
    );
    return reply.send(await readFile(fullPath));
  });

  app.patch("/api/admin/leads/:id/status", { preHandler: requireRole("super_admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z.object({ status: z.enum(["novo", "contactado", "resolvido"]) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const [updated] = await db.update(commercialLeads).set({ status: parsed.data.status }).where(eq(commercialLeads.id, id)).returning();
    if (!updated) return reply.code(404).send({ error: "Pedido não encontrado" });
    return updated;
  });
}

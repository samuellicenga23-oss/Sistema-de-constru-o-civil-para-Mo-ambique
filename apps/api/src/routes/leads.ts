import type { FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { commercialLeads, companies, users } from "../db/schema.js";
import { requireRole } from "../auth/middleware.js";
import { sendEmail, emailLayout } from "../services/mailer.js";
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
        `<p><strong>${lead.name}</strong>${lead.company ? ` · ${lead.company}` : ""} pediu ${lead.planOrPack ? `«${lead.planOrPack}»` : "informação"}.</p>
         <p>Email: ${lead.email}${lead.phone ? ` · Telefone: ${lead.phone}` : ""}</p>
         ${lead.notes ? `<p>Notas: ${lead.notes}</p>` : ""}
         <p>Fonte: ${lead.source}</p>`,
        `${env.publicUrl}/admin`,
        "Ver no painel",
      ),
    },
    undefined,
  );
}

export async function leadRoutes(app: FastifyInstance) {
  await app.register(rateLimit, { global: false });

  // Formulário público (visitante sem conta) — CheckoutPage.
  app.post(
    "/api/public/leads",
    { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } },
    async (request, reply) => {
      const parsed = leadSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

      const [lead] = await db
        .insert(commercialLeads)
        .values({ ...parsed.data, source: "checkout", companyId: null })
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

  app.patch("/api/admin/leads/:id/status", { preHandler: requireRole("super_admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z.object({ status: z.enum(["novo", "contactado", "resolvido"]) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const [updated] = await db.update(commercialLeads).set({ status: parsed.data.status }).where(eq(commercialLeads.id, id)).returning();
    if (!updated) return reply.code(404).send({ error: "Pedido não encontrado" });
    return updated;
  });
}

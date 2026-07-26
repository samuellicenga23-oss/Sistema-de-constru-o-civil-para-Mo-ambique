import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, desc, count } from "drizzle-orm";
import { db } from "../db/index.js";
import { users, subscriptions } from "../db/schema.js";
import { requireRole } from "../auth/middleware.js";
import { hashPassword } from "../auth/password.js";
import { getPlanDefinition } from "@sigo/shared";

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8, "A password deve ter pelo menos 8 caracteres"),
  role: z.enum(["admin_empresa", "orcamentista", "engenheiro_fiscal", "visualizador"]),
});

// Gestão de utilizadores dentro da própria empresa — só admin_empresa.
export async function userRoutes(app: FastifyInstance) {
  app.get("/api/users", { preHandler: requireRole("admin_empresa") }, async (request) => {
    const companyId = request.currentUser!.companyId!;
    return db
      .select({ id: users.id, name: users.name, email: users.email, role: users.role, createdAt: users.createdAt })
      .from(users)
      .where(eq(users.companyId, companyId));
  });

  app.post("/api/users", { preHandler: requireRole("admin_empresa") }, async (request, reply) => {
    const parsed = createUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const companyId = request.currentUser!.companyId!;
    const { name, email, password, role } = parsed.data;

    const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing) {
      return reply.code(409).send({ error: "Já existe um utilizador com este email" });
    }

    // Limite de utilizadores do plano actual — trial sem subscrição ainda usa o limite mais
    // baixo (Arranque), para nunca deixar passar sem plano nenhum.
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.companyId, companyId)).orderBy(desc(subscriptions.createdAt)).limit(1);
    const plan = getPlanDefinition(sub?.plan ?? "free");
    if (plan?.maxUsers != null) {
      const [{ value: currentUsers }] = await db.select({ value: count() }).from(users).where(eq(users.companyId, companyId));
      if (currentUsers >= plan.maxUsers) {
        return reply.code(403).send({
          error: `O plano "${plan.label}" permite até ${plan.maxUsers} utilizador(es). Contacte o suporte para actualizar de plano.`,
        });
      }
    }

    const passwordHash = await hashPassword(password);
    const [user] = await db
      .insert(users)
      .values({ companyId, name, email, passwordHash, role })
      .returning();

    return reply.code(201).send({ id: user.id, name: user.name, email: user.email, role: user.role });
  });

  app.delete("/api/users/:id", { preHandler: requireRole("admin_empresa") }, async (request, reply) => {
    const companyId = request.currentUser!.companyId!;
    const { id } = request.params as { id: string };
    if (id === request.currentUser!.id) {
      return reply.code(400).send({ error: "Não pode eliminar o seu próprio utilizador" });
    }
    await db.delete(users).where(and(eq(users.id, id), eq(users.companyId, companyId)));
    return { ok: true };
  });
}

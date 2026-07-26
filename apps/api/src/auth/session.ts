import { eq, gt, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { sessions, users } from "../db/schema.js";
import type { UserRole } from "@sigo/shared";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

export type SessionUser = {
  id: string;
  companyId: string | null;
  name: string;
  email: string;
  role: UserRole;
};

export async function createSession(userId: string): Promise<{ id: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const [session] = await db.insert(sessions).values({ userId, expiresAt }).returning();
  return session;
}

export async function getSessionUser(sessionId: string): Promise<SessionUser | null> {
  const rows = await db
    .select({
      id: users.id,
      companyId: users.companyId,
      name: users.name,
      email: users.email,
      role: users.role,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return rows[0] ?? null;
}

export async function deleteSession(sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

// Termina TODAS as sessões de um utilizador (todos os dispositivos) — usado ao mudar a
// password, para que uma sessão eventualmente roubada deixe de ser válida.
export async function deleteAllSessionsForUser(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

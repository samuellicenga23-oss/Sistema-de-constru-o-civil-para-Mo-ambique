import { eq, gt, and, ne } from "drizzle-orm";
import { db } from "../db/index.js";
import { companies, sessions, users } from "../db/schema.js";
import { COMPANY_MODULE_KEYS, type CompanyModuleKey, type UserRole } from "@sigo/shared";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

export type SessionUser = {
  id: string;
  companyId: string | null;
  name: string;
  email: string;
  role: UserRole;
  avatarUrl: string | null;
  lastLoginAt: Date | null;
  isActive: boolean;
  mustChangePassword: boolean;
  preferredLanguage: string;
  enabledModules: CompanyModuleKey[];
  createdAt: Date;
};

export type SessionMeta = { userAgent?: string | null; ipAddress?: string | null };

export async function createSession(userId: string, meta: SessionMeta = {}): Promise<{ id: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const [session] = await db
    .insert(sessions)
    .values({ userId, expiresAt, userAgent: meta.userAgent ?? null, ipAddress: meta.ipAddress ?? null })
    .returning();
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
      avatarUrl: users.avatarUrl,
      lastLoginAt: users.lastLoginAt,
      isActive: users.isActive,
      mustChangePassword: users.mustChangePassword,
      preferredLanguage: users.preferredLanguage,
      enabledModules: companies.enabledModules,
      createdAt: users.createdAt,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .leftJoin(companies, eq(users.companyId, companies.id))
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date()), eq(users.isActive, true)))
    .limit(1);
  const row = rows[0];
  return row ? { ...row, enabledModules: row.enabledModules ?? [...COMPANY_MODULE_KEYS] } : null;
}

export async function deleteSession(sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

// Termina TODAS as sessões de um utilizador (todos os dispositivos) — usado ao mudar a
// password, para que uma sessão eventualmente roubada deixe de ser válida.
export async function deleteAllSessionsForUser(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

// Lista para o próprio utilizador rever/terminar sessões de outros dispositivos (página de
// Perfil) — só sessões ainda válidas, mais recente primeiro.
export async function listSessionsForUser(userId: string) {
  return db
    .select({ id: sessions.id, createdAt: sessions.createdAt, expiresAt: sessions.expiresAt, userAgent: sessions.userAgent, ipAddress: sessions.ipAddress })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, new Date())))
    .orderBy(sessions.createdAt);
}

// Termina uma sessão específica, mas só se pertencer mesmo a este utilizador — impede
// terminar a sessão de outra pessoa só por adivinhar/obter o id.
export async function deleteSessionForUser(sessionId: string, userId: string): Promise<boolean> {
  const deleted = await db
    .delete(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
    .returning({ id: sessions.id });
  return deleted.length > 0;
}

// Termina todas as OUTRAS sessões deste utilizador, preservando a actual — usado no botão
// "Terminar todas as outras sessões" do Perfil.
export async function deleteOtherSessionsForUser(userId: string, currentSessionId: string): Promise<void> {
  await db.delete(sessions).where(and(eq(sessions.userId, userId), ne(sessions.id, currentSessionId)));
}

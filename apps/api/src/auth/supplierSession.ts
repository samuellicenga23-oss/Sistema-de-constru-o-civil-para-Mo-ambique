import { eq, gt, and, ne } from "drizzle-orm";
import { db } from "../db/index.js";
import { supplierAccounts, supplierSessions } from "../db/schema.js";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias — fornecedores entram com pouca frequência

export type SupplierSessionUser = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  isActive: boolean;
  createdAt: Date;
};

export type SupplierSessionMeta = { userAgent?: string | null; ipAddress?: string | null };

export async function createSupplierSession(supplierAccountId: string, meta: SupplierSessionMeta = {}): Promise<{ id: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const [session] = await db
    .insert(supplierSessions)
    .values({ supplierAccountId, expiresAt, userAgent: meta.userAgent ?? null, ipAddress: meta.ipAddress ?? null })
    .returning();
  return session;
}

export async function getSupplierSessionUser(sessionId: string): Promise<SupplierSessionUser | null> {
  const rows = await db
    .select({
      id: supplierAccounts.id,
      name: supplierAccounts.name,
      email: supplierAccounts.email,
      phone: supplierAccounts.phone,
      isActive: supplierAccounts.isActive,
      createdAt: supplierAccounts.createdAt,
    })
    .from(supplierSessions)
    .innerJoin(supplierAccounts, eq(supplierSessions.supplierAccountId, supplierAccounts.id))
    .where(and(eq(supplierSessions.id, sessionId), gt(supplierSessions.expiresAt, new Date()), eq(supplierAccounts.isActive, true)))
    .limit(1);
  return rows[0] ?? null;
}

export async function deleteSupplierSession(sessionId: string): Promise<void> {
  await db.delete(supplierSessions).where(eq(supplierSessions.id, sessionId));
}

export async function deleteAllSupplierSessions(supplierAccountId: string): Promise<void> {
  await db.delete(supplierSessions).where(eq(supplierSessions.supplierAccountId, supplierAccountId));
}

export async function deleteOtherSupplierSessions(supplierAccountId: string, currentSessionId: string): Promise<void> {
  await db
    .delete(supplierSessions)
    .where(and(eq(supplierSessions.supplierAccountId, supplierAccountId), ne(supplierSessions.id, currentSessionId)));
}

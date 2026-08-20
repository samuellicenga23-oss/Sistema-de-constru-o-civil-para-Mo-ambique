import { and, count, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { notifications } from "../db/schema.js";

// Sino in-app — sempre gravado a par do email correspondente (nunca em vez dele), para o
// destinatário ver o aviso mesmo que o email falhe, esteja desligado, ou simplesmente não seja
// visto a tempo. Nunca lança: uma notificação falhada não pode rebentar o pedido que a originou.
export async function notifyUser(
  userId: string,
  title: string,
  body: string,
  link?: string,
  options?: { priority?: "normal" | "high" },
): Promise<void> {
  try {
    await db.insert(notifications).values({
      userId,
      title,
      body,
      link: link ?? null,
      priority: options?.priority ?? "normal",
    });
  } catch {
    // Silencioso de propósito — ver comentário acima.
  }
}

export async function notifyUsers(
  userIds: string[],
  title: string,
  body: string,
  link?: string,
  options?: { priority?: "normal" | "high" },
): Promise<void> {
  if (!userIds.length) return;
  try {
    await db.insert(notifications).values(
      userIds.map((userId) => ({
        userId,
        title,
        body,
        link: link ?? null,
        priority: options?.priority ?? "normal",
      })),
    );
  } catch {
    // Silencioso de propósito.
  }
}

export async function notifySupplierAccount(supplierAccountId: string, title: string, body: string, link?: string): Promise<void> {
  try {
    await db.insert(notifications).values({ supplierAccountId, title, body, link: link ?? null });
  } catch {
    // Silencioso de propósito.
  }
}

export async function listNotificationsForUser(userId: string, limit = 30) {
  const [rows, unread] = await Promise.all([
    db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt)).limit(limit),
    db.select({ value: count() }).from(notifications).where(and(eq(notifications.userId, userId), isNull(notifications.readAt))),
  ]);
  return { items: rows, unreadCount: unread[0]?.value ?? 0 };
}

export async function listNotificationsForSupplierAccount(supplierAccountId: string, limit = 30) {
  const [rows, unread] = await Promise.all([
    db.select().from(notifications).where(eq(notifications.supplierAccountId, supplierAccountId)).orderBy(desc(notifications.createdAt)).limit(limit),
    db.select({ value: count() }).from(notifications).where(and(eq(notifications.supplierAccountId, supplierAccountId), isNull(notifications.readAt))),
  ]);
  return { items: rows, unreadCount: unread[0]?.value ?? 0 };
}

export async function markNotificationRead(id: string, scope: { userId?: string; supplierAccountId?: string }): Promise<void> {
  const owner = scope.userId ? eq(notifications.userId, scope.userId) : eq(notifications.supplierAccountId, scope.supplierAccountId!);
  await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, id), owner));
}

export async function markNotificationPresented(id: string, userId: string): Promise<void> {
  await db
    .update(notifications)
    .set({ presentedAt: new Date() })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId), isNull(notifications.presentedAt)));
}

export async function markAllNotificationsRead(scope: { userId?: string; supplierAccountId?: string }): Promise<void> {
  const owner = scope.userId ? eq(notifications.userId, scope.userId) : eq(notifications.supplierAccountId, scope.supplierAccountId!);
  await db.update(notifications).set({ readAt: new Date() }).where(and(owner, isNull(notifications.readAt)));
}

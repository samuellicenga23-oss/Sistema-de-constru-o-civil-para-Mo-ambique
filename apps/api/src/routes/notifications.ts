import type { FastifyInstance } from "fastify";
import { requireAuth } from "../auth/middleware.js";
import { listNotificationsForUser, markAllNotificationsRead, markNotificationRead } from "../services/notifications.js";

export async function notificationRoutes(app: FastifyInstance) {
  app.get("/api/notifications", { preHandler: requireAuth }, async (request) => {
    return listNotificationsForUser(request.currentUser!.id);
  });

  app.post("/api/notifications/:id/read", { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    await markNotificationRead(id, { userId: request.currentUser!.id });
    return { ok: true };
  });

  app.post("/api/notifications/read-all", { preHandler: requireAuth }, async (request) => {
    await markAllNotificationsRead({ userId: request.currentUser!.id });
    return { ok: true };
  });
}

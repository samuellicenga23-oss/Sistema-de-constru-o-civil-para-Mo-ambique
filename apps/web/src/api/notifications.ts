import { request } from "./http";

export type AppNotification = {
  id: string;
  title: string;
  body: string;
  link: string | null;
  priority?: "normal" | "high" | string;
  presentedAt?: string | null;
  readAt: string | null;
  createdAt: string;
};

export type NotificationsResponse = { items: AppNotification[]; unreadCount: number };

export const notificationsApi = {
  list: () => request<NotificationsResponse>("/notifications"),
  markRead: (id: string) => request<{ ok: true }>(`/notifications/${id}/read`, { method: "POST" }),
  markPresented: (id: string) => request<{ ok: true }>(`/notifications/${id}/presented`, { method: "POST" }),
  markAllRead: () => request<{ ok: true }>("/notifications/read-all", { method: "POST" }),
};

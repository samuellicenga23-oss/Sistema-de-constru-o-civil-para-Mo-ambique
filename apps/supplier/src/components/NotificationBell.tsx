import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supplierNotificationsApi, type SupplierNotification } from "../api/supplierPortal";
import { IconBell } from "./icons";

const POLL_MS = 45_000;

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "agora mesmo";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  return `há ${days}d`;
}

export default function NotificationBell() {
  const navigate = useNavigate();
  const [items, setItems] = useState<SupplierNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  async function reload() {
    try {
      const res = await supplierNotificationsApi.list();
      setItems(res.items);
      setUnreadCount(res.unreadCount);
    } catch {
      // Silencioso — o sino não deve rebentar o resto da página se falhar.
    }
  }

  useEffect(() => {
    reload();
    const interval = window.setInterval(reload, POLL_MS);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  async function handleItemClick(item: SupplierNotification) {
    setOpen(false);
    if (!item.readAt) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, readAt: new Date().toISOString() } : i)));
      setUnreadCount((c) => Math.max(0, c - 1));
      supplierNotificationsApi.markRead(item.id).catch(() => {});
    }
    if (item.link) navigate(item.link);
  }

  async function handleMarkAllRead() {
    setItems((prev) => prev.map((i) => ({ ...i, readAt: i.readAt ?? new Date().toISOString() })));
    setUnreadCount(0);
    await supplierNotificationsApi.markAllRead().catch(() => {});
  }

  return (
    <div style={{ position: "relative" }} ref={containerRef}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="icon-btn-ghost" aria-label="Notificações" title="Notificações" style={{ position: "relative" }}>
        <IconBell size={16} />
        {unreadCount > 0 && (
          <span
            style={{
              position: "absolute",
              top: "-0.2rem",
              right: "-0.2rem",
              display: "grid",
              placeItems: "center",
              minWidth: "1.1rem",
              height: "1.1rem",
              borderRadius: "999px",
              background: "var(--orange)",
              color: "#fff",
              fontSize: "0.62rem",
              fontWeight: 700,
              padding: "0 0.2rem",
            }}
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="card"
          style={{ position: "absolute", right: 0, top: "calc(100% + 0.5rem)", width: "20rem", maxWidth: "90vw", zIndex: 50, overflow: "hidden" }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.75rem 1rem", borderBottom: "1px solid var(--border)" }}>
            <span style={{ fontSize: "0.85rem", fontWeight: 700 }}>Notificações</span>
            {unreadCount > 0 && (
              <button type="button" onClick={handleMarkAllRead} className="link-strong" style={{ background: "none", border: 0, cursor: "pointer", fontSize: "0.75rem" }}>
                Marcar tudo como lido
              </button>
            )}
          </div>
          <div style={{ maxHeight: "22rem", overflowY: "auto" }}>
            {items.length === 0 && <p className="empty">Sem notificações ainda.</p>}
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleItemClick(item)}
                style={{
                  display: "flex",
                  width: "100%",
                  flexDirection: "column",
                  gap: "0.2rem",
                  padding: "0.75rem 1rem",
                  textAlign: "left",
                  borderBottom: "1px solid var(--border)",
                  background: item.readAt ? "transparent" : "rgba(26, 173, 180, 0.06)",
                  cursor: "pointer",
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  {!item.readAt && <span style={{ width: "0.4rem", height: "0.4rem", borderRadius: "999px", background: "var(--orange)", flexShrink: 0 }} />}
                  <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>{item.title}</span>
                </span>
                <span className="text-muted-sm">{item.body}</span>
                <span className="text-muted-sm" style={{ fontSize: "0.7rem" }}>{timeAgo(item.createdAt)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

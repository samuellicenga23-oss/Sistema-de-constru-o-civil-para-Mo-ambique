import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { notificationsApi, type AppNotification } from "../api/notifications";
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
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  async function reload() {
    try {
      const res = await notificationsApi.list();
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

  async function handleItemClick(item: AppNotification) {
    setOpen(false);
    if (!item.readAt) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, readAt: new Date().toISOString() } : i)));
      setUnreadCount((c) => Math.max(0, c - 1));
      notificationsApi.markRead(item.id).catch(() => {});
    }
    if (item.link) navigate(item.link);
  }

  async function handleMarkAllRead() {
    setItems((prev) => prev.map((i) => ({ ...i, readAt: i.readAt ?? new Date().toISOString() })));
    setUnreadCount(0);
    await notificationsApi.markAllRead().catch(() => {});
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="icon-btn relative"
        aria-label="Notificações"
        title="Notificações"
      >
        <IconBell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold leading-none text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[90vw] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <span className="text-sm font-semibold text-slate-950">Notificações</span>
            {unreadCount > 0 && (
              <button type="button" onClick={handleMarkAllRead} className="text-xs font-semibold text-brand-700 hover:underline">
                Marcar tudo como lido
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 && <p className="px-4 py-8 text-center text-xs text-slate-400">Sem notificações ainda.</p>}
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleItemClick(item)}
                className={`flex w-full flex-col gap-0.5 border-b border-slate-50 px-4 py-3 text-left last:border-b-0 hover:bg-slate-50 ${!item.readAt ? "bg-brand-50/40" : ""}`}
              >
                <span className="flex items-center gap-2">
                  {!item.readAt && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
                  <span className="text-sm font-medium text-slate-950">{item.title}</span>
                </span>
                <span className="text-xs text-slate-500">{item.body}</span>
                <span className="text-[11px] text-slate-400">{timeAgo(item.createdAt)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

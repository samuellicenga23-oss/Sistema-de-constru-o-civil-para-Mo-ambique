import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { notificationsApi, type AppNotification } from "../api/notifications";

/** Modal central de alta prioridade — uma vez por notificação (presentedAt). */
export default function PriorityNotificationModal() {
  const navigate = useNavigate();
  const [item, setItem] = useState<AppNotification | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await notificationsApi.list();
        const next = res.items.find(
          (n) => n.priority === "high" && !n.presentedAt && !n.readAt,
        );
        if (!cancelled) setItem(next ?? null);
      } catch {
        /* ignore */
      }
    }
    void load();
    const id = window.setInterval(load, 45_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  if (!item) return null;

  async function dismiss(openLink: boolean) {
    const current = item;
    setItem(null);
    if (!current) return;
    await notificationsApi.markPresented(current.id).catch(() => {});
    if (openLink && current.link) {
      await notificationsApi.markRead(current.id).catch(() => {});
      navigate(current.link);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/45 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-2xl" role="alertdialog">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-brand-700">Atenção</p>
        <h2 className="mt-1 text-base font-semibold text-slate-950">{item.title}</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{item.body}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void dismiss(false)}>
            Mais tarde
          </button>
          {item.link && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void dismiss(true)}>
              Rever
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

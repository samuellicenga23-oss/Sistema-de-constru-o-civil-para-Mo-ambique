import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { workflowTasksApi, type WorkflowTask } from "../api/projectTeam";
import { notificationsApi, type AppNotification } from "../api/notifications";
import { useDataSaverPollingInterval } from "../hooks/useDataSaverPolling";

const POLL_BASE_MS = 12_000;

type AttentionItem =
  | { kind: "task"; task: WorkflowTask }
  | { kind: "notification"; notification: AppNotification };

/**
 * Atenção a ecrã cheio — aprovações pendentes e resultados (aprovado/devolvido).
 * Uma vez por evento via presentedAt. O menu «Acções» continua para o resto.
 */
export default function PriorityActionCenter() {
  const navigate = useNavigate();
  const pollMs = useDataSaverPollingInterval(POLL_BASE_MS);
  const [item, setItem] = useState<AttentionItem | null>(null);

  const load = useCallback(async () => {
    try {
      const [tasks, notes] = await Promise.all([workflowTasksApi.listMine(), notificationsApi.list()]);
      if (tasks.priorityTask) {
        setItem({ kind: "task", task: tasks.priorityTask });
        return;
      }
      const high = notes.items.find((n) => n.priority === "high" && !n.presentedAt);
      setItem(high ? { kind: "notification", notification: high } : null);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(load, pollMs);
    function onFocus() {
      void load();
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [load, pollMs]);

  if (!item) return null;

  const isTask = item.kind === "task";
  const task = isTask ? item.task : null;
  const note = !isTask ? item.notification : null;
  const isCorrection = task?.kind === "correction";
  const title = task?.title ?? note?.title ?? "";
  const body = task?.body ?? note?.body ?? "";
  const projectName = task?.projectNameSnapshot;
  const link = task?.link ?? note?.link;
  const eyebrow = isCorrection
    ? "Correcção necessária"
    : task
      ? "Aprovação necessária"
      : note?.title?.toLowerCase().includes("aprovad")
        ? "Aprovado"
        : note?.title?.toLowerCase().includes("devolv")
          ? "Devolvido"
          : "Atenção";

  async function dismiss(openLink: boolean) {
    const current = item;
    setItem(null);
    if (!current) return;
    if (current.kind === "task") {
      await workflowTasksApi.markPresented(current.task.id).catch(() => {});
      if (openLink && current.task.link) {
        const href =
          current.task.targetType === "line_item" && current.task.targetId
            ? `${current.task.link}#line-item-${current.task.targetId}`
            : current.task.link;
        navigate(href);
      }
    } else {
      await notificationsApi.markPresented(current.notification.id).catch(() => {});
      if (openLink && current.notification.link) {
        await notificationsApi.markRead(current.notification.id).catch(() => {});
        navigate(current.notification.link);
      }
    }
    // Carregar o próximo imediatamente
    window.setTimeout(() => void load(), 400);
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-stretch justify-center bg-slate-950/70 p-0 sm:items-center sm:p-6" role="alertdialog">
      <div className="flex h-full w-full max-w-lg flex-col bg-white shadow-2xl sm:h-auto sm:max-h-[90vh] sm:rounded-2xl">
        <div className="flex-1 overflow-y-auto px-6 py-8 sm:px-8 sm:py-10">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-brand-700">{eyebrow}</p>
          <h2 className="mt-3 text-2xl font-semibold leading-snug text-slate-950">{title}</h2>
          {projectName && <p className="mt-2 text-base text-slate-500">{projectName}</p>}
          {task?.requesterName && !isCorrection && (
            <p className="mt-4 text-sm text-slate-600">{task.requesterName} submeteu e aguarda a sua decisão.</p>
          )}
          {body && <p className="mt-5 whitespace-pre-wrap text-base leading-relaxed text-slate-700">{body}</p>}
          <p className="mt-8 text-xs text-slate-400">
            Continua disponível em «Acções» se fechar agora.
          </p>
        </div>
        <div className="flex flex-col gap-2 border-t border-slate-200 px-6 py-4 sm:flex-row sm:justify-end sm:px-8">
          <button type="button" className="btn btn-secondary order-2 sm:order-1" onClick={() => void dismiss(false)}>
            Mais tarde
          </button>
          {link && (
            <button type="button" className="btn btn-primary order-1 sm:order-2" onClick={() => void dismiss(true)}>
              {isCorrection ? "Corrigir agora" : task ? "Rever agora" : "Abrir"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

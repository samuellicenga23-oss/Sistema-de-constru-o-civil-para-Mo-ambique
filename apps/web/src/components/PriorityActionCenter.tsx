import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { workflowTasksApi, type WorkflowTask } from "../api/projectTeam";

/**
 * Modal central só para tarefas de acção (aprovação / correcção).
 * Uma vez por task via notificationPresentedAt — não para comentários informativos.
 */
export default function PriorityActionCenter() {
  const navigate = useNavigate();
  const [task, setTask] = useState<WorkflowTask | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await workflowTasksApi.listMine();
        if (!cancelled) setTask(res.priorityTask);
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

  if (!task) return null;

  async function dismiss(openLink: boolean) {
    const current = task;
    setTask(null);
    if (!current) return;
    await workflowTasksApi.markPresented(current.id).catch(() => {});
    if (openLink && current.link) {
      const href =
        current.targetType === "line_item" && current.targetId
          ? `${current.link}#line-item-${current.targetId}`
          : current.link;
      navigate(href);
    }
  }

  const isCorrection = task.kind === "correction";

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/45 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-2xl" role="alertdialog">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-brand-700">
          {isCorrection ? "Correcção necessária" : "Aprovação necessária"}
        </p>
        <h2 className="mt-1 text-base font-semibold text-slate-950">{task.title}</h2>
        {task.projectNameSnapshot && <p className="mt-0.5 text-sm text-slate-500">{task.projectNameSnapshot}</p>}
        {task.requesterName && !isCorrection && (
          <p className="mt-2 text-xs text-slate-500">{task.requesterName} submeteu.</p>
        )}
        {task.body && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{task.body}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void dismiss(false)}>
            Mais tarde
          </button>
          {task.link && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void dismiss(true)}>
              {isCorrection ? "Corrigir" : "Rever"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

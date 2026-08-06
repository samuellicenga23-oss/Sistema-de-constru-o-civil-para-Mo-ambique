import { useEffect, useSyncExternalStore } from "react";
import { useNavigate } from "react-router-dom";
import { boqApi } from "../api/boq";
import {
  consumeImportReview,
  dismissImportProcessingTask,
  getImportProcessingTasks,
  subscribeImportProcessingTasks,
  updateImportProcessingTask,
} from "../services/importProcessingTracker";
import { IconClose, IconDoc } from "./icons";

export default function ImportProcessingCenter() {
  const navigate = useNavigate();
  const tasks = useSyncExternalStore(subscribeImportProcessingTasks, getImportProcessingTasks, getImportProcessingTasks);
  const task = tasks.length ? tasks[tasks.length - 1] : null;
  const finished = task?.state === "completed";
  const failed = task?.state === "error";

  useEffect(() => {
    const active = tasks.filter((item) => item.state === "uploading" || item.state === "processing");
    if (!active.length) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      for (const item of active) {
        boqApi
          .getMeasurementImportJob(item.documentId, item.jobId)
          .then((job) => {
            if (!cancelled) updateImportProcessingTask(job);
          })
          .catch(() => {});
      }
    }, 1200);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [tasks.map((item) => `${item.jobId}:${item.state}`).join("|")]);

  if (!task) return null;

  function openReview() {
    if (!task) return;
    if (task.preview) {
      consumeImportReview(task.jobId);
      window.dispatchEvent(
        new CustomEvent("sigo:import-ready", {
          detail: { jobId: task.jobId, documentId: task.documentId, preview: task.preview },
        }),
      );
    }
    if (finished || failed) dismissImportProcessingTask(task.jobId);
    navigate(`/documentos/${task.documentId}${task.preview ? `?importJob=${task.jobId}` : ""}`);
  }

  return (
    <aside
      className="fixed bottom-[8.5rem] right-3 z-50 w-[min(25rem,calc(100vw-1.5rem))] cursor-pointer rounded-xl border border-slate-200 bg-white p-4 shadow-xl md:bottom-28 md:right-5"
      aria-live="polite"
      role="status"
      onClick={openReview}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openReview();
        }
      }}
      tabIndex={0}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700">
          <IconDoc className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">{task.fileName}</p>
          <p className={`mt-0.5 text-xs ${failed ? "text-red-600" : finished ? "text-emerald-700" : "text-slate-600"}`}>
            {failed
              ? (task.errorMessage ?? "Não foi possível analisar o mapa")
              : finished
                ? "Análise concluída — pronta para revisão"
                : task.stage || "A processar em segundo plano"}
          </p>
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            dismissImportProcessingTask(task.jobId);
          }}
          className="icon-btn h-8 w-8"
          aria-label="Fechar aviso"
        >
          <IconClose className="h-4 w-4" />
        </button>
      </div>
      {!finished && !failed && (
        <div className="mt-3 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-brand-600 transition-[width] duration-300" style={{ width: `${task.progress}%` }} />
          </div>
          <span className="text-xs tabular-nums font-semibold text-slate-700">{task.progress}%</span>
        </div>
      )}
      <span className="mt-3 inline-flex text-xs font-semibold text-brand-700">
        {finished ? "Clique para rever →" : "Clique para ver documento →"}
      </span>
    </aside>
  );
}

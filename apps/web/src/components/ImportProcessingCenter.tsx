import { useEffect, useSyncExternalStore } from "react";
import { Link, useNavigate } from "react-router-dom";
import { boqApi } from "../api/boq";
import {
  consumeImportReview,
  dismissImportProcessingTask,
  getImportProcessingTasks,
  subscribeImportProcessingTasks,
  updateImportProcessingTask,
} from "../services/importProcessingTracker";
import { IconClose } from "./icons";

export default function ImportProcessingCenter() {
  const navigate = useNavigate();
  const tasks = useSyncExternalStore(subscribeImportProcessingTasks, getImportProcessingTasks, getImportProcessingTasks);

  useEffect(() => {
    const active = tasks.filter((task) => task.state === "uploading" || task.state === "processing");
    if (!active.length) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      for (const task of active) {
        boqApi
          .getMeasurementImportJob(task.documentId, task.jobId)
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
  }, [tasks.map((task) => `${task.jobId}:${task.state}`).join("|")]);

  if (!tasks.length) return null;
  const task = tasks[tasks.length - 1];
  const finished = task.state === "completed";
  const failed = task.state === "error";

  function openReview() {
    if (!task.preview) return;
    consumeImportReview(task.jobId);
    window.dispatchEvent(
      new CustomEvent("sigo:import-ready", {
        detail: { jobId: task.jobId, documentId: task.documentId, preview: task.preview },
      }),
    );
    navigate(`/documentos/${task.documentId}?importJob=${task.jobId}`);
  }

  // Abrir revisão automaticamente quando a análise termina.
  useEffect(() => {
    if (task.state !== "completed" || !task.openReview || !task.preview) return;
    const t = window.setTimeout(() => openReview(), 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só quando o job acaba
  }, [task.jobId, task.state, task.openReview]);

  return (
    <aside
      className="fixed bottom-[8.5rem] right-3 z-50 w-[min(25rem,calc(100vw-1.5rem))] rounded-xl border border-slate-200 bg-white p-4 shadow-xl md:bottom-28 md:right-5"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">{task.fileName}</p>
          <p className={`mt-0.5 text-xs ${failed ? "text-red-600" : finished ? "text-emerald-700" : "text-slate-600"}`}>
            {failed
              ? (task.errorMessage ?? "Não foi possível analisar o mapa")
              : finished
                ? "Análise concluída"
                : task.stage || "A processar em segundo plano"}
          </p>
        </div>
        <button type="button" onClick={() => dismissImportProcessingTask(task.jobId)} className="icon-btn h-8 w-8" aria-label="Fechar aviso">
          <IconClose className="h-4 w-4" />
        </button>
      </div>
      {!finished && !failed && (
        <div className="mt-3 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-brand-600" style={{ width: `${task.progress}%` }} />
          </div>
          <span className="text-xs font-semibold tabular-nums text-slate-700">{task.progress}%</span>
        </div>
      )}
      {finished ? (
        <button type="button" onClick={openReview} className="mt-3 inline-flex text-xs font-semibold text-brand-700 hover:underline">
          Rever importação
        </button>
      ) : (
        <Link to={`/documentos/${task.documentId}`} className="mt-3 inline-flex text-xs font-semibold text-brand-700 hover:underline">
          Ver documento
        </Link>
      )}
    </aside>
  );
}

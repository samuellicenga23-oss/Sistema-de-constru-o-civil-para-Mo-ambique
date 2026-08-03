import { useEffect, useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import { plantsApi } from "../api/plants";
import { dismissPlantProcessingTask, getPlantProcessingTasks, subscribePlantProcessingTasks, updatePlantProcessingTask } from "../services/plantProcessingTracker";
import { IconClose } from "./icons";

export default function PlantProcessingCenter() {
  const tasks = useSyncExternalStore(subscribePlantProcessingTasks, getPlantProcessingTasks, getPlantProcessingTasks);

  // Se a página for recarregada, retoma também o acompanhamento guardado na sessão.
  useEffect(() => {
    const active = tasks.filter((task) => task.state === "uploading" || task.state === "processing");
    if (!active.length) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      for (const task of active) {
        plantsApi.status(task.plantId).then((progress) => {
          if (!cancelled) updatePlantProcessingTask(task.plantId, progress);
        }).catch(() => {});
      }
    }, 1800);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [tasks.map((task) => `${task.plantId}:${task.state}`).join("|")]);

  if (!tasks.length) return null;
  const task = tasks[tasks.length - 1];
  const finished = task.state === "completed";
  const failed = task.state === "error";
  const target = finished ? `/plantas/${task.plantId}` : `/projectos/${task.projectId}#plantas-do-projecto`;

  return (
    <aside className="fixed bottom-20 right-3 z-50 w-[min(25rem,calc(100vw-1.5rem))] rounded-xl border border-slate-200 bg-white p-4 shadow-xl md:bottom-5 md:right-5" aria-live="polite">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">{task.fileName}</p>
          <p className={`mt-0.5 text-xs ${failed ? "text-red-600" : finished ? "text-emerald-700" : "text-slate-600"}`}>
            {failed ? (task.progress.errorMessage ?? "Não foi possível analisar") : finished ? "Leitura concluída" : (task.progress.processingStage ?? "A processar em segundo plano")}
          </p>
        </div>
        <button type="button" onClick={() => dismissPlantProcessingTask(task.plantId)} className="icon-btn h-8 w-8" aria-label="Fechar aviso"><IconClose className="h-4 w-4" /></button>
      </div>
      {!finished && !failed && (
        <div className="mt-3 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-600" style={{ width: `${task.progress.processingProgress}%` }} /></div>
          <span className="text-xs font-semibold tabular-nums text-slate-700">{task.progress.processingProgress}%</span>
        </div>
      )}
      <Link to={target} className="mt-3 inline-flex text-xs font-semibold text-brand-700 hover:underline">{finished ? "Rever dados" : "Ver estado"}</Link>
    </aside>
  );
}

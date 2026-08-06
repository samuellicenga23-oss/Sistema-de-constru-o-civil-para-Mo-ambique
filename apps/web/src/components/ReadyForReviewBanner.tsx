import { useSyncExternalStore } from "react";
import { useNavigate } from "react-router-dom";
import {
  dismissImportProcessingTask,
  getImportProcessingTasks,
  subscribeImportProcessingTasks,
} from "../services/importProcessingTracker";
import {
  dismissPlantProcessingTask,
  getPlantProcessingTasks,
  subscribePlantProcessingTasks,
} from "../services/plantProcessingTracker";

type ReadyItem = {
  id: string;
  kind: "plant" | "import";
  label: string;
  href: string;
  dismiss: () => void;
};

function useReadyItems(): ReadyItem[] {
  const plants = useSyncExternalStore(subscribePlantProcessingTasks, getPlantProcessingTasks, getPlantProcessingTasks);
  const imports = useSyncExternalStore(subscribeImportProcessingTasks, getImportProcessingTasks, getImportProcessingTasks);

  const items: ReadyItem[] = [];
  for (const task of plants) {
    if (task.state !== "completed") continue;
    items.push({
      id: `plant:${task.plantId}`,
      kind: "plant",
      label: task.fileName,
      href: `/plantas/${task.plantId}`,
      dismiss: () => dismissPlantProcessingTask(task.plantId),
    });
  }
  for (const task of imports) {
    if (task.state !== "completed") continue;
    items.push({
      id: `import:${task.jobId}`,
      kind: "import",
      label: task.fileName,
      href: `/documentos/${task.documentId}?importJob=${task.jobId}`,
      dismiss: () => dismissImportProcessingTask(task.jobId),
    });
  }
  return items;
}

/** Faixa superior: planta/medição pronta para revisão. */
export default function ReadyForReviewBanner() {
  const navigate = useNavigate();
  const items = useReadyItems();
  if (!items.length) return null;

  const primary = items[items.length - 1];
  const more = items.length - 1;
  const kindLabel = primary.kind === "plant" ? "A planta" : "A medição importada";

  function openPrimary() {
    primary.dismiss();
    navigate(primary.href);
  }

  return (
    <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-950 md:px-8">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p>
          <strong>{kindLabel} está pronta para revisão.</strong>{" "}
          <span className="text-emerald-900/85">{primary.label}</span>
          {more > 0 ? <span className="text-emerald-800/80"> · +{more} outro(s) pronto(s)</span> : null}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={openPrimary} className="btn btn-primary btn-sm">
            Rever agora
          </button>
          <button type="button" onClick={() => primary.dismiss()} className="btn btn-secondary btn-sm">
            Dispensar
          </button>
        </div>
      </div>
    </div>
  );
}

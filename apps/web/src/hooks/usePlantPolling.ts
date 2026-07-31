import { useEffect, useRef } from "react";
import { plantsApi, type Plant, type PlantProcessingProgress } from "../api/plants";

const POLL_MS = 900;

/** Mantém a lista de plantas actualizada enquanto alguma estiver a processar. */
export function usePlantPolling(
  plants: Plant[],
  onUpdate: (id: string, progress: PlantProcessingProgress) => void,
  onComplete?: (id: string) => void,
) {
  const onUpdateRef = useRef(onUpdate);
  const onCompleteRef = useRef(onComplete);
  onUpdateRef.current = onUpdate;
  onCompleteRef.current = onComplete;

  useEffect(() => {
    const active = plants.filter((p) => p.processingStatus === "pendente" || p.processingStatus === "processando");
    if (active.length === 0) return;

    let cancelled = false;
    const timers = new Set<number>();

    async function pollOne(id: string) {
      while (!cancelled) {
        await new Promise<void>((r) => {
          const t = window.setTimeout(r, POLL_MS);
          timers.add(t);
        });
        if (cancelled) break;
        try {
          const progress = await plantsApi.status(id);
          if (cancelled) break;
          onUpdateRef.current(id, progress);
          if (progress.processingStatus === "concluido" || progress.processingStatus === "erro") {
            onCompleteRef.current?.(id);
            break;
          }
        } catch {
          break;
        }
      }
    }

    for (const plant of active) void pollOne(plant.id);

    return () => {
      cancelled = true;
      for (const t of timers) window.clearTimeout(t);
    };
  }, [plants.map((p) => `${p.id}:${p.processingStatus}`).join("|")]);
}

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PlantProcessingProgress } from "../src/api/plants";
import {
  COMPLETED_NOTICE_TTL_MS,
  beginPlantProcessingTask,
  getPlantProcessingTasks,
  hydratePlantProcessingTasksForTests,
  pruneExpiredPlantProcessingTasks,
  resetPlantProcessingTasksForTests,
  setPlantProcessingNowForTests,
  updatePlantProcessingTask,
} from "../src/services/plantProcessingTracker";

function progress(overrides: Partial<PlantProcessingProgress> = {}): PlantProcessingProgress {
  return {
    id: "plant-1",
    processingStatus: "processando",
    processingProgress: 40,
    processingStage: "A extrair",
    processingCurrentPage: 1,
    processingTotalPages: 4,
    processingStartedAt: "2026-08-19T10:00:00.000Z",
    processingUpdatedAt: "2026-08-19T10:00:10.000Z",
    errorMessage: null,
    ...overrides,
  };
}

describe("plantProcessingTracker", () => {
  beforeEach(() => {
    resetPlantProcessingTasksForTests();
  });

  afterEach(() => {
    resetPlantProcessingTasksForTests();
  });

  it("mantém tarefas em processamento", () => {
    beginPlantProcessingTask({ plantId: "plant-1", projectId: "proj-1", fileName: "planta.pdf" }, progress({ processingProgress: 8 }));
    updatePlantProcessingTask("plant-1", progress());
    pruneExpiredPlantProcessingTasks();
    expect(getPlantProcessingTasks()).toHaveLength(1);
    expect(getPlantProcessingTasks()[0].state).toBe("processing");
  });

  it("marca concluídas com TTL e remove depois de expirar", () => {
    let now = Date.parse("2026-08-19T12:00:00.000Z");
    setPlantProcessingNowForTests(() => now);
    beginPlantProcessingTask({ plantId: "plant-1", projectId: "proj-1", fileName: "planta.pdf" }, progress());
    updatePlantProcessingTask("plant-1", progress({ processingStatus: "concluido", processingProgress: 100, processingStage: "Concluído" }));
    const [task] = getPlantProcessingTasks();
    expect(task.state).toBe("completed");
    expect(task.completedAt).toBe("2026-08-19T12:00:00.000Z");
    expect(task.expiresAt).toBe(new Date(now + COMPLETED_NOTICE_TTL_MS).toISOString());

    now += COMPLETED_NOTICE_TTL_MS - 1;
    pruneExpiredPlantProcessingTasks();
    expect(getPlantProcessingTasks()).toHaveLength(1);

    now += 2;
    pruneExpiredPlantProcessingTasks();
    expect(getPlantProcessingTasks()).toHaveLength(0);
  });

  it("mantém erros até o utilizador fechar", () => {
    let now = Date.parse("2026-08-19T12:00:00.000Z");
    setPlantProcessingNowForTests(() => now);
    beginPlantProcessingTask({ plantId: "plant-1", projectId: "proj-1", fileName: "planta.pdf" }, progress());
    updatePlantProcessingTask("plant-1", progress({ processingStatus: "erro", errorMessage: "PDF ilegível" }));
    now += COMPLETED_NOTICE_TTL_MS * 5;
    pruneExpiredPlantProcessingTasks();
    expect(getPlantProcessingTasks()).toEqual([
      expect.objectContaining({ state: "error", plantId: "plant-1" }),
    ]);
  });

  it("não ressuscita uma tarefa concluída expirada após refresh", () => {
    const now = Date.parse("2026-08-19T12:00:00.000Z");
    setPlantProcessingNowForTests(() => now);
    window.sessionStorage.setItem("sigo:plant-processing-tasks", JSON.stringify([{
      plantId: "plant-1",
      projectId: "proj-1",
      fileName: "planta.pdf",
      state: "completed",
      progress: progress({ processingStatus: "concluido", processingProgress: 100 }),
      completedAt: "2026-08-19T11:59:00.000Z",
      expiresAt: "2026-08-19T11:59:10.000Z",
    }]));
    hydratePlantProcessingTasksForTests();
    expect(getPlantProcessingTasks()).toHaveLength(0);
  });

  it("descarta tarefas concluídas antigas sem timestamp", () => {
    window.sessionStorage.setItem("sigo:plant-processing-tasks", JSON.stringify([{
      plantId: "plant-1",
      projectId: "proj-1",
      fileName: "planta.pdf",
      state: "completed",
      progress: progress({ processingStatus: "concluido", processingProgress: 100 }),
    }]));
    hydratePlantProcessingTasksForTests();
    expect(getPlantProcessingTasks()).toHaveLength(0);
  });
});

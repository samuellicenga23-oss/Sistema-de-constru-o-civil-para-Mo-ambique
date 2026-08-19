import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PlantProcessingCenter from "../src/components/PlantProcessingCenter";
import type { PlantProcessingProgress } from "../src/api/plants";
import {
  beginPlantProcessingTask,
  resetPlantProcessingTasksForTests,
  updatePlantProcessingTask,
} from "../src/services/plantProcessingTracker";

vi.mock("../src/api/plants", () => ({
  plantsApi: { status: vi.fn() },
}));

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

describe("PlantProcessingCenter", () => {
  beforeEach(() => {
    resetPlantProcessingTasksForTests();
  });

  afterEach(() => {
    resetPlantProcessingTasksForTests();
  });

  it("abre a revisão e fecha o cartão com teclado quando concluído", () => {
    beginPlantProcessingTask({ plantId: "plant-1", projectId: "proj-1", fileName: "planta.pdf" }, progress());
    updatePlantProcessingTask("plant-1", progress({ processingStatus: "concluido", processingProgress: 100 }));
    render(
      <MemoryRouter>
        <PlantProcessingCenter />
      </MemoryRouter>,
    );
    expect(screen.getByText("Concluído")).toBeInTheDocument();
    const card = screen.getByRole("status");
    fireEvent.keyDown(card, { key: "Enter" });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("mantém o cartão de erro até fechar", () => {
    beginPlantProcessingTask({ plantId: "plant-1", projectId: "proj-1", fileName: "planta.pdf" }, progress());
    updatePlantProcessingTask("plant-1", progress({ processingStatus: "erro", errorMessage: "PDF ilegível" }));
    render(
      <MemoryRouter>
        <PlantProcessingCenter />
      </MemoryRouter>,
    );
    expect(screen.getByText("PDF ilegível")).toBeInTheDocument();
    expect(screen.getByText("Completar dados")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Fechar aviso"));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

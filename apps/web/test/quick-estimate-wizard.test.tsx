import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import QuickEstimateWizard from "../src/components/QuickEstimateWizard";

vi.mock("../src/api/catalog", () => ({
  catalogApi: { listMaterials: vi.fn().mockResolvedValue([]) },
}));

vi.mock("../src/api/quickEstimate", () => ({
  quickEstimateApi: { apply: vi.fn() },
}));

const structuralSummary = {
  footingsCount: 12,
  footingsAvgWidthCm: 120,
  footingsAvgLengthCm: 140,
  footingsAvgDepthCm: 45,
  columnsCount: 12,
  beamsCount: 18,
  beamsTotalLengthM: 94,
  beamsAvgWidthCm: 20,
  beamsAvgHeightCm: 40,
  beamsConcreteVolumeM3: 7.52,
  staircasesCount: 1,
  slabsCount: 2,
  slabsAvgThicknessCm: 15,
  totalSteelWeightKg: 8450,
};

describe("QuickEstimateWizard — dados manuais", () => {
  it("abre o passo correcto a partir de uma pendência e permite indicar a espessura", () => {
    render(<QuickEstimateWizard documentId="doc-1" onClose={() => {}} onApplied={() => {}} />);

    const readinessItem = screen.getByText("Lajes e espessuras").closest("div.flex");
    const manualButton = readinessItem?.querySelector("button");
    expect(manualButton).toHaveTextContent("Indicar dados");
    fireEvent.click(manualButton!);

    const slabInput = screen.getByLabelText("Espessura média da laje (m)");
    expect(slabInput).toHaveValue(null);
    fireEvent.change(slabInput, { target: { value: "0.18" } });
    expect(slabInput).toHaveValue(0.18);
  });

  it("carrega valores detectados como campos editáveis e dá prioridade à confirmação manual", () => {
    render(
      <QuickEstimateWizard
        documentId="doc-2"
        onClose={() => {}}
        onApplied={() => {}}
        structuralSummary={structuralSummary}
        structuralPlantName="Estrutura.pdf"
      />
    );

    const readinessItem = screen.getByText("Lajes e espessuras").closest("div.flex");
    const editButton = readinessItem?.querySelector("button");
    expect(editButton).toHaveTextContent("Alterar");
    fireEvent.click(editButton!);

    const slabInput = screen.getByLabelText("Espessura média da laje (m)");
    const beamInput = screen.getByLabelText("Betão em vigas (m³)");
    const steelInput = screen.getByLabelText("Peso total de aço (kg)");
    expect(slabInput).toHaveValue(0.15);
    expect(beamInput).toHaveValue(7.52);
    expect(steelInput).toHaveValue(8450);

    fireEvent.change(steelInput, { target: { value: "8625.4" } });
    expect(steelInput).toHaveValue(8625.4);
  });
});

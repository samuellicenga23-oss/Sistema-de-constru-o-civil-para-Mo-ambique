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

const architectureRooms = [
  { id: "room-1", name: "Sala", number: null, areaM2: "24.50", page: 1, floor: "Piso Térreo" },
];

describe("QuickEstimateWizard — dados manuais", () => {
  it("permite completar manualmente a espessura estrutural", () => {
    render(<QuickEstimateWizard documentId="doc-1" onClose={() => {}} onApplied={() => {}} architectureRooms={architectureRooms} />);

    fireEvent.click(screen.getByRole("button", { name: "Seguinte" }));

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
        architectureRooms={architectureRooms}
        structuralSummary={structuralSummary}
        structuralPlantName="Estrutura.pdf"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Seguinte" }));

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

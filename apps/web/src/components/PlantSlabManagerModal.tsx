import {
  buildRebarPurchasePlan,
  computeSlabRebarWeightLines,
  DEFAULT_REBAR_LENGTH_M,
  DEFAULT_SLAB_LAP_FACTOR,
  roundStructuralQty,
} from "@sigo/shared";
import Modal from "./Modal";
import { IconTrash } from "./icons";
import type { SlabRebarLayer, StructuralSlab } from "../api/plants";

type Props = {
  open: boolean;
  slabs: StructuralSlab[];
  floorOptions: string[];
  saving?: boolean;
  error?: string | null;
  onClose: () => void;
  onChange: (slabs: StructuralSlab[]) => void;
  onSave?: () => void | Promise<void>;
  saveLabel?: string;
};

function slabSteelWeight(slab: StructuralSlab): number {
  const scheduledWeight = Number(slab.bottomSteelWeightKg ?? 0) + Number(slab.topSteelWeightKg ?? 0);
  if (scheduledWeight > 0) return scheduledWeight;
  const area = Number(slab.areaM2 ?? 0);
  const toLayer = (label: string, layer?: SlabRebarLayer | null) =>
    layer && layer.xDiameterMm > 0 && layer.xSpacingCm > 0 && layer.yDiameterMm > 0 && layer.ySpacingCm > 0
      ? {
          label,
          directions: [
            { diameterMm: layer.xDiameterMm, spacingCm: layer.xSpacingCm, role: "X" },
            { diameterMm: layer.yDiameterMm, spacingCm: layer.ySpacingCm, role: "Y" },
          ],
        }
      : null;
  const layers = [toLayer("inferior", slab.bottomRebar), toLayer("superior", slab.topRebar)].filter(
    (layer): layer is NonNullable<typeof layer> => Boolean(layer),
  );
  return computeSlabRebarWeightLines({
    areaM2: area,
    layers,
    lapFactor: DEFAULT_SLAB_LAP_FACTOR,
  }).reduce((sum, line) => sum + line.weightKg, 0);
}

function slabBarPurchaseSummary(slab: StructuralSlab): string {
  const area = Number(slab.areaM2 ?? 0);
  const toLayer = (label: string, layer?: SlabRebarLayer | null) =>
    layer && layer.xDiameterMm > 0 && layer.xSpacingCm > 0 && layer.yDiameterMm > 0 && layer.ySpacingCm > 0
      ? {
          label,
          directions: [
            { diameterMm: layer.xDiameterMm, spacingCm: layer.xSpacingCm, role: "X" },
            { diameterMm: layer.yDiameterMm, spacingCm: layer.ySpacingCm, role: "Y" },
          ],
        }
      : null;
  const layers = [toLayer("inferior", slab.bottomRebar), toLayer("superior", slab.topRebar)].filter(
    (layer): layer is NonNullable<typeof layer> => Boolean(layer),
  );
  if (!layers.length && Object.keys(slab.steelByDiameter ?? {}).length === 0) return "";
  const scheduledByDiameter = Object.entries(slab.steelByDiameter ?? {}).map(([diameter, weightKg]) => ({
    diameterMm: Number(diameter),
    weightKg: Number(weightKg),
  }));
  const estimated = computeSlabRebarWeightLines({
    areaM2: area,
    layers,
    lapFactor: DEFAULT_SLAB_LAP_FACTOR,
  }).map((line) => ({ diameterMm: line.diameterMm, weightKg: line.weightKg }));
  const plan = buildRebarPurchasePlan(scheduledByDiameter.length ? scheduledByDiameter : estimated);
  return plan
    .map((item) => `Ø${item.diameterMm}: ${item.barsToBuy} varões`)
    .join(" · ");
}

export default function PlantSlabManagerModal({
  open,
  slabs,
  floorOptions,
  saving = false,
  error = null,
  onClose,
  onChange,
  onSave,
  saveLabel = "Guardar lajes",
}: Props) {
  if (!open) return null;

  const totalArea = slabs.reduce((sum, slab) => sum + Number(slab.areaM2 ?? 0), 0);
  const totalSteel = slabs.reduce((sum, slab) => sum + slabSteelWeight(slab), 0);

  function addSlab() {
    const index = slabs.length + 1;
    const defaultLayer: SlabRebarLayer = { xDiameterMm: 8, xSpacingCm: 15, yDiameterMm: 8, ySpacingCm: 15 };
    onChange([
      ...slabs,
      {
        name: `Laje ${index}`,
        floor: floorOptions[0] ?? "Piso Térreo",
        areaM2: 1,
        thicknessCm: 15,
        layers: ["inferior", "superior"],
        pages: [1],
        concreteClass: "B25",
        steelGrade: "A400",
        coverCm: 2.5,
        topRebar: { ...defaultLayer },
        bottomRebar: { ...defaultLayer },
        notes: null,
      },
    ]);
  }

  function updateSlab(index: number, patch: Partial<StructuralSlab>) {
    onChange(slabs.map((slab, slabIndex) => (slabIndex === index ? { ...slab, ...patch } : slab)));
  }

  function updateSlabLayer(index: number, layerName: "topRebar" | "bottomRebar", patch: Partial<SlabRebarLayer>) {
    onChange(slabs.map((slab, slabIndex) => {
      if (slabIndex !== index) return slab;
      const current = slab[layerName] ?? { xDiameterMm: 10, xSpacingCm: 20, yDiameterMm: 10, ySpacingCm: 20 };
      return { ...slab, [layerName]: { ...current, ...patch } };
    }));
  }

  return (
    <Modal title="Lajes do projecto" subtitle="Área, espessura e armaduras por nível" onClose={onClose} maxWidth="max-w-6xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 px-4 py-3">
        <div>
          <strong className="text-sm text-slate-900">{slabs.length} laje(s)</strong>
          <span className="ml-2 text-xs text-slate-500">
            {totalArea.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m²
            {" · "}
            {roundStructuralQty(totalSteel).toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg aço
          </span>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={addSlab}>+ Adicionar laje</button>
      </div>
      {error && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <datalist id="plant-slab-floor-list">
        {floorOptions.map((floor) => <option key={floor} value={floor} />)}
      </datalist>

      {slabs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center">
          <p className="text-sm text-slate-600">Registe uma laje para cada piso ou cobertura.</p>
          <button type="button" className="btn btn-primary btn-sm mt-3" onClick={addSlab}>Adicionar primeira laje</button>
        </div>
      ) : (
        <div className="space-y-4">
          {slabs.map((slab, index) => (
            <article key={index} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
                <div>
                  <strong className="text-sm text-slate-900">{slab.name || `Laje ${index + 1}`}</strong>
                  <span className="ml-2 text-xs text-slate-500">
                    {roundStructuralQty(Number(slab.areaM2 ?? 0) * slab.thicknessCm / 100).toFixed(2)} m³ betão · {slabSteelWeight(slab).toFixed(2)} kg aço {(slab.topSteelWeightKg ?? 0) + (slab.bottomSteelWeightKg ?? 0) > 0 ? "do mapa" : "estimado"}
                  </span>
                  {slabBarPurchaseSummary(slab) && (
                    <span className="mt-1 block text-xs font-medium text-brand-700">
                      Compra em barras de {DEFAULT_REBAR_LENGTH_M} m (+5% corte): {slabBarPurchaseSummary(slab)}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm text-red-600"
                  onClick={() => onChange(slabs.filter((_, slabIndex) => slabIndex !== index))}
                >
                  <IconTrash className="h-4 w-4" /> Remover
                </button>
              </header>
              <div className="space-y-4 p-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="sm:col-span-2">
                    <label className="label">Nome da laje</label>
                    <input className="input input-sm" value={slab.name ?? ""} placeholder="Ex.: Laje do 1.º piso" onChange={(event) => updateSlab(index, { name: event.target.value })} />
                  </div>
                  <div>
                    <label className="label">Piso / nível</label>
                    <input className="input input-sm" list="plant-slab-floor-list" value={slab.floor ?? ""} placeholder="Ex.: Piso Superior" onChange={(event) => updateSlab(index, { floor: event.target.value || null })} />
                  </div>
                  <div>
                    <label className="label">Área (m²)</label>
                    <input className="input input-sm" type="number" min="0.01" step="0.01" value={slab.areaM2 ?? ""} onChange={(event) => updateSlab(index, { areaM2: roundStructuralQty(Number(event.target.value) || 0) })} />
                  </div>
                  <div>
                    <label className="label">Espessura (cm)</label>
                    <input className="input input-sm" type="number" min="1" step="0.01" value={slab.thicknessCm} onChange={(event) => updateSlab(index, { thicknessCm: roundStructuralQty(Number(event.target.value) || 0) })} />
                  </div>
                  <div>
                    <label className="label">Classe do betão</label>
                    <input className="input input-sm" value={slab.concreteClass ?? ""} placeholder="B25" onChange={(event) => updateSlab(index, { concreteClass: event.target.value || null })} />
                  </div>
                  <div>
                    <label className="label">Classe do aço</label>
                    <input className="input input-sm" value={slab.steelGrade ?? ""} placeholder="A400" onChange={(event) => updateSlab(index, { steelGrade: event.target.value || null })} />
                  </div>
                  <div>
                    <label className="label">Recobrimento (cm)</label>
                    <input className="input input-sm" type="number" min="0" step="0.01" value={slab.coverCm ?? ""} onChange={(event) => updateSlab(index, { coverCm: event.target.value ? roundStructuralQty(Number(event.target.value)) : null })} />
                  </div>
                </div>
                {(["bottomRebar", "topRebar"] as const).map((layerName) => {
                  const layer = slab[layerName] ?? { xDiameterMm: 0, xSpacingCm: 0, yDiameterMm: 0, ySpacingCm: 0 };
                  return (
                    <div key={layerName} className={`rounded-xl border p-3 ${layerName === "bottomRebar" ? "border-blue-200 bg-blue-50/40" : "border-amber-200 bg-amber-50/40"}`}>
                      <h4 className="mb-3 text-sm font-semibold text-slate-900">Armadura {layerName === "bottomRebar" ? "inferior" : "superior"}</h4>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <div>
                          <label className="label">Diâmetro X (mm)</label>
                          <input className="input input-sm" type="number" min="4" step="0.01" value={layer.xDiameterMm} onChange={(event) => updateSlabLayer(index, layerName, { xDiameterMm: roundStructuralQty(Number(event.target.value) || 0) })} />
                        </div>
                        <div>
                          <label className="label">Espaçamento X (cm)</label>
                          <input className="input input-sm" type="number" min="5" step="0.01" value={layer.xSpacingCm} onChange={(event) => updateSlabLayer(index, layerName, { xSpacingCm: roundStructuralQty(Number(event.target.value) || 0) })} />
                        </div>
                        <div>
                          <label className="label">Diâmetro Y (mm)</label>
                          <input className="input input-sm" type="number" min="4" step="0.01" value={layer.yDiameterMm} onChange={(event) => updateSlabLayer(index, layerName, { yDiameterMm: roundStructuralQty(Number(event.target.value) || 0) })} />
                        </div>
                        <div>
                          <label className="label">Espaçamento Y (cm)</label>
                          <input className="input input-sm" type="number" min="5" step="0.01" value={layer.ySpacingCm} onChange={(event) => updateSlabLayer(index, layerName, { ySpacingCm: roundStructuralQty(Number(event.target.value) || 0) })} />
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div>
                  <label className="label">Observações</label>
                  <textarea className="input min-h-16 resize-y" value={slab.notes ?? ""} placeholder="Reforços locais, negativos, bordos, aberturas ou outras indicações" onChange={(event) => updateSlab(index, { notes: event.target.value || null })} />
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
        {onSave && (
          <button type="button" className="btn btn-primary" disabled={saving || slabs.length === 0} onClick={() => void onSave()}>
            {saving ? "A guardar" : saveLabel}
          </button>
        )}
        {!onSave && (
          <button type="button" className="btn btn-primary" onClick={onClose}>Aplicar lajes</button>
        )}
      </div>
    </Modal>
  );
}

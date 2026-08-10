import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { plantsApi, type ExtractedOpening, type ExtractedRoom, type ExtractedRebarLine, type OpeningInput, type Plant, type SlabRebarLayer, type StructuralSlab } from "../api/plants";
import { boqApi } from "../api/boq";
import { catalogApi, type Material } from "../api/catalog";
import Layout from "../components/Layout";
import Modal from "../components/Modal";
import MoneyInput from "../components/MoneyInput";
import { IconBack, IconRefresh, IconRuler, IconTrash } from "../components/icons";
import { useConfirmDialog } from "../hooks/useConfirmDialog";
import {
  buildRebarPurchasePlan,
  classifyStructuralSteelWeights,
  computeSlabRebarWeightLines,
  DEFAULT_REBAR_LENGTH_M,
  DEFAULT_SLAB_LAP_FACTOR,
  formatSteelDiameterBreakdown,
  roundStructuralQty,
  steelWeightsByFamilyAndDiameter,
} from "@sigo/shared";

const UNASSIGNED_FLOOR = "Piso não identificado";
const SECTION_STYLES = {
  arquitectura: "border-blue-200 bg-blue-50 text-blue-900",
  estrutura: "border-slate-300 bg-slate-50 text-slate-900",
  hidrossanitario: "border-cyan-200 bg-cyan-50 text-cyan-900",
  electricidade: "border-amber-200 bg-amber-50 text-amber-900",
  outro: "border-gray-200 bg-gray-50 text-gray-800",
} as const;

function pageRange(startPage: number, endPage: number) {
  return startPage === endPage ? `Página ${startPage}` : `Páginas ${startPage}–${endPage}`;
}

function gapCompletarHash(gap: string): string {
  const g = gap.toLocaleLowerCase("pt");
  if (g.includes("sapata") || g.includes("funda")) return "sapatas";
  if (g.includes("pilar")) return "pilares";
  if (g.includes("viga")) return "vigas";
  if (g.includes("laje") || g.includes("cobertura") || g.includes("armadura de laje")) return "lajes";
  if (g.includes("escada")) return "escadas";
  if (g.includes("compartiment")) return "compartimentos";
  if (g.includes("porta") || g.includes("janela") || g.includes("vão")) return "portas-janelas";
  if (g.includes("aço") || g.includes("peso")) return "sapatas";
  return "regularizacao";
}

type FamilyPopup = {
  id: string;
  title: string;
  lines: string[];
  hash: string;
};

// Ordena os pisos por senso comum de construção: térreo primeiro, depois pisos numerados a
// subir, depois zonas especiais (anexo, cobertura), e por fim o que não foi identificado.
function floorSortKey(floor: string): number {
  const f = floor.toLowerCase();
  if (f.includes("térreo") || f.includes("terreo") || f.includes("rés")) return 0;
  const numMatch = f.match(/(\d+)/);
  if (numMatch) return parseInt(numMatch[1], 10);
  if (f.includes("superior")) return 50;
  if (f.includes("anexo")) return 80;
  if (f.includes("cobertura")) return 90;
  if (f === UNASSIGNED_FLOOR) return 999;
  return 60;
}

export default function PlantReviewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { confirm, dialog } = useConfirmDialog();
  const [plant, setPlant] = useState<Plant | null>(null);
  const [rooms, setRooms] = useState<ExtractedRoom[]>([]);
  const [openings, setOpenings] = useState<ExtractedOpening[]>([]);
  const [rebarSchedules, setRebarSchedules] = useState<ExtractedRebarLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savingRoomId, setSavingRoomId] = useState<string | null>(null);
  const [reprocessing, setReprocessing] = useState(false);
  const [preparingMeasurements, setPreparingMeasurements] = useState(false);
  const [confirmingIdentity, setConfirmingIdentity] = useState(false);
  const [savingOpeningId, setSavingOpeningId] = useState<string | null>(null);
  const [catalogMaterials, setCatalogMaterials] = useState<Material[]>([]);
  const [openingPrices, setOpeningPrices] = useState<Record<string, string>>({});
  const [materialEditorOpeningId, setMaterialEditorOpeningId] = useState<string | null>(null);
  const [materialEditorMode, setMaterialEditorMode] = useState<"existing" | "new">("existing");
  const [materialSearch, setMaterialSearch] = useState("");
  const [selectedMaterialId, setSelectedMaterialId] = useState("");
  const [newMaterialName, setNewMaterialName] = useState("");
  const [materialEditorPrice, setMaterialEditorPrice] = useState("");
  const [savingMaterial, setSavingMaterial] = useState(false);
  const [openingManagerKind, setOpeningManagerKind] = useState<"porta" | "janela" | null>(null);
  const [slabManagerOpen, setSlabManagerOpen] = useState(false);
  const [slabDrafts, setSlabDrafts] = useState<StructuralSlab[]>([]);
  const [savingSlabs, setSavingSlabs] = useState(false);
  const [gapPopup, setGapPopup] = useState<string | null>(null);
  const [familyPopup, setFamilyPopup] = useState<FamilyPopup | null>(null);

  useEffect(() => {
    if (!id) return;
    plantsApi
      .detail(id)
      .then(async (detail) => {
        setPlant(detail.plant);
        setRooms(detail.rooms);
        setOpenings(detail.openings);
        setRebarSchedules(detail.rebarSchedules);
        const project = await boqApi.getProject(detail.plant.projectId);
        const availableMaterials = await catalogApi.listMaterials(project.zoneId ?? undefined);
        setCatalogMaterials(availableMaterials);
        setOpeningPrices(Object.fromEntries(detail.openings.map((opening) => {
          const material = availableMaterials.find((item) => item.id === opening.materialId)
            ?? availableMaterials.find((item) => item.name.toLocaleLowerCase("pt") === opening.material?.toLocaleLowerCase("pt"));
          return [opening.id, material ? String(material.effectiveUnitCost) : ""];
        })));
      })
      .catch((err) => setError(err.message));
  }, [id]);

  // Reprocessa o ficheiro já guardado com a lógica de extracção mais recente — útil quando o
  // sistema é melhorado depois de a planta já ter sido carregada, sem obrigar o utilizador a
  // encontrar e reenviar o PDF outra vez.
  async function handleReprocess() {
    if (!id) return;
    setReprocessing(true);
    setError(null);
    try {
      const updated = await plantsApi.reprocess(id, (progress) => setPlant((current) => current ? { ...current, ...progress } : current));
      setPlant(updated);
      const detail = await plantsApi.detail(id);
      setRooms(detail.rooms);
      setOpenings(detail.openings);
      setRebarSchedules(detail.rebarSchedules);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao reprocessar a planta");
    } finally {
      setReprocessing(false);
    }
  }

  const floorNames = useMemo(() => {
    const names = new Set(rooms.map((r) => r.floor ?? UNASSIGNED_FLOOR));
    return Array.from(names).sort((a, b) => floorSortKey(a) - floorSortKey(b));
  }, [rooms]);

  const roomsByFloor = useMemo(() => {
    const groups = new Map<string, ExtractedRoom[]>();
    for (const name of floorNames) groups.set(name, []);
    for (const room of rooms) groups.get(room.floor ?? UNASSIGNED_FLOOR)!.push(room);
    return groups;
  }, [rooms, floorNames]);

  const openingFloorNames = useMemo(() => {
    const names = new Set(openings.map((opening) => opening.floor ?? UNASSIGNED_FLOOR));
    return Array.from(names).sort((a, b) => floorSortKey(a) - floorSortKey(b));
  }, [openings]);

  const availableOpeningFloors = useMemo(
    () => Array.from(new Set([...floorNames, ...openingFloorNames])).sort((a, b) => floorSortKey(a) - floorSortKey(b)),
    [floorNames, openingFloorNames],
  );

  async function handleFloorChange(roomId: string, value: string) {
    if (!id) return;
    let newFloor: string | null = value;
    if (value === "__new__") {
      const typed = window.prompt("Nome do novo piso (ex: \"3º Piso\", \"Cave\"):");
      if (!typed || !typed.trim()) return;
      newFloor = typed.trim();
    } else if (value === UNASSIGNED_FLOOR) {
      newFloor = null;
    }
    setSavingRoomId(roomId);
    setError(null);
    try {
      const updated = await plantsApi.updateRoomFloor(id, roomId, newFloor);
      setRooms((rs) => rs.map((r) => (r.id === roomId ? updated : r)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao reatribuir piso");
    } finally {
      setSavingRoomId(null);
    }
  }

  async function handleConfirmReadyForMeasurement() {
    if (!plant) return;
    const ok = await confirm({
      title: "Dados prontos para medição?",
      message:
        "Confirma que sapatas, pilares, vigas, lajes, escadas, compartimentos e aço estão correctos? Depois desta confirmação o Assistente de Medições usa estes valores bloqueados — para alterar, volte a esta análise.",
      confirmLabel: "Confirmar e abrir assistente",
    });
    if (!ok) return;
    setPreparingMeasurements(true);
    setError(null);
    try {
      const { document } = await boqApi.prepareMeasurementWorkspace(plant.projectId);
      navigate(`/documentos/${document.id}?assistente=1&fromPlant=${plant.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível preparar as medições");
    } finally {
      setPreparingMeasurements(false);
    }
  }

  function goBackToProject() {
    if (!plant) {
      navigate(-1);
      return;
    }
    navigate(`/projectos/${plant.projectId}#plantas-do-projecto`);
  }

  async function handleConfirmIdentity() {
    if (!plant) return;
    setConfirmingIdentity(true);
    setError(null);
    try {
      const updated = await plantsApi.confirmIdentity(plant.id);
      setPlant(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível confirmar as disciplinas");
    } finally {
      setConfirmingIdentity(false);
    }
  }

  function openingPayload(opening: ExtractedOpening): OpeningInput {
    return {
      kind: opening.kind,
      code: opening.code,
      designation: opening.designation,
      widthM: opening.widthM ? Number(opening.widthM) : null,
      heightM: opening.heightM ? Number(opening.heightM) : null,
      sillHeightM: opening.sillHeightM ? Number(opening.sillHeightM) : null,
      quantity: opening.quantity,
      floor: opening.floor,
      location: opening.location,
      material: opening.material,
      materialId: opening.materialId,
      technicalSpecification: opening.technicalSpecification,
      page: opening.page,
      confirmed: !opening.needsConfirmation,
    };
  }

  async function saveOpening(opening: ExtractedOpening) {
    if (!id) return;
    setSavingOpeningId(opening.id);
    setError(null);
    try {
      const updated = await plantsApi.updateOpening(id, opening.id, { ...openingPayload(opening), confirmed: true });
      setOpenings((items) => items.map((item) => item.id === updated.id ? updated : item));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível guardar o vão");
    } finally {
      setSavingOpeningId(null);
    }
  }

  function openMaterialEditor(opening: ExtractedOpening) {
    const linked = catalogMaterials.find((material) => material.id === opening.materialId);
    setMaterialEditorOpeningId(opening.id);
    setMaterialEditorMode("existing");
    setMaterialSearch("");
    setSelectedMaterialId(linked?.id ?? "");
    setNewMaterialName("");
    setMaterialEditorPrice(linked ? String(linked.effectiveUnitCost) : "");
  }

  async function confirmOpeningMaterial() {
    const opening = openings.find((item) => item.id === materialEditorOpeningId);
    if (!opening) return;
    setSavingMaterial(true);
    setError(null);
    try {
      let linked: Material;
      const price = Math.max(0, Number(materialEditorPrice || 0));
      if (materialEditorMode === "existing") {
        const current = catalogMaterials.find((material) => material.id === selectedMaterialId);
        if (!current) throw new Error("Seleccione um material do Catálogo.");
        if (Math.abs(price - current.effectiveUnitCost) > 0.0001) {
          const saved = await catalogApi.updateMaterial(current.id, {
            baseUnitCost: price,
            priceSourceName: "Revisão da planta",
            priceDate: new Date().toISOString().slice(0, 10),
          });
          linked = { ...saved, effectiveUnitCost: price, priceBasis: "base" };
        } else {
          linked = current;
        }
      } else {
        const name = newMaterialName.trim();
        if (!name) throw new Error("Indique o nome do novo material.");
        const duplicate = catalogMaterials.find((material) => material.name.trim().localeCompare(name, "pt", { sensitivity: "base" }) === 0);
        if (duplicate) throw new Error(`O material “${duplicate.name}” já existe. Escolha-o no Catálogo para evitar duplicação.`);
        const saved = await catalogApi.createMaterial({
          name,
          category: "Portas e Janelas",
          specification: opening.technicalSpecification,
          unit: opening.kind === "porta" ? "un" : "m2",
          baseUnitCost: price,
          priceSourceName: "Revisão da planta",
          priceDate: new Date().toISOString().slice(0, 10),
          includesVat: false,
        });
        linked = { ...saved, effectiveUnitCost: price, priceBasis: "base" };
      }
      setCatalogMaterials((items) => [...items.filter((item) => item.id !== linked.id), linked]);
      setOpenings((items) => items.map((item) => item.id === opening.id ? { ...item, material: linked.name, materialId: linked.id, needsConfirmation: true } : item));
      setOpeningPrices((prices) => ({ ...prices, [opening.id]: String(linked.effectiveUnitCost) }));
      setMaterialEditorOpeningId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível associar o material");
    } finally {
      setSavingMaterial(false);
    }
  }

  function repeatPreviousOpening(openingId: string, floorOpenings: ExtractedOpening[]) {
    const index = floorOpenings.findIndex((item) => item.id === openingId);
    if (index <= 0) return;
    const previous = floorOpenings[index - 1];
    setOpenings((items) => items.map((item) => item.id === openingId ? {
      ...item,
      kind: previous.kind,
      designation: previous.designation,
      widthM: previous.widthM,
      heightM: previous.heightM,
      sillHeightM: previous.sillHeightM,
      location: previous.location,
      material: previous.material,
      materialId: previous.materialId,
      technicalSpecification: previous.technicalSpecification,
      needsConfirmation: true,
    } : item));
    setOpeningPrices((prices) => ({ ...prices, [openingId]: prices[previous.id] ?? "" }));
  }

  async function addOpening(kind: "porta" | "janela") {
    if (!id) return;
    setError(null);
    try {
      const created = await plantsApi.createOpening(id, { kind, designation: kind === "porta" ? "Nova porta" : "Nova janela", widthM: kind === "porta" ? 0.9 : 1.2, heightM: kind === "porta" ? 2.1 : 1.2, quantity: 1, floor: floorNames[0] === UNASSIGNED_FLOOR ? null : floorNames[0] ?? null, location: "exterior", page: 1, confirmed: true, materialId: null, technicalSpecification: null });
      setOpenings((items) => [...items, created]);
      setOpeningPrices((prices) => ({ ...prices, [created.id]: "" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível adicionar o vão");
    }
  }

  async function deleteOpening(openingId: string) {
    if (!id) return;
    setError(null);
    try {
      await plantsApi.deleteOpening(id, openingId);
      setOpenings((items) => items.filter((item) => item.id !== openingId));
      setOpeningPrices((prices) => {
        const next = { ...prices };
        delete next[openingId];
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível eliminar o vão");
    }
  }

  function renderOpeningCard(opening: ExtractedOpening, openingIndex: number, floorOpenings: ExtractedOpening[]) {
    const linkedMaterial = catalogMaterials.find((material) => material.id === opening.materialId);
    const materialUnit = linkedMaterial?.unit ?? (opening.kind === "porta" ? "un" : "m²");
    return (
      <div key={opening.id} className={`rounded-xl border bg-white p-4 ${opening.needsConfirmation ? "border-amber-300" : "border-slate-200"}`}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2"><strong className="text-sm text-slate-900">{opening.designation || opening.code || (opening.kind === "porta" ? "Porta" : "Janela")}</strong><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${opening.needsConfirmation ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>{opening.needsConfirmation ? "Por confirmar" : "Confirmado"}</span></div>
          <div className="flex flex-wrap items-center gap-2"><button type="button" className="btn btn-secondary btn-sm" disabled={openingIndex === 0} onClick={() => repeatPreviousOpening(opening.id, floorOpenings)}>Preencher como anterior</button><span className="text-xs text-slate-500">Página {opening.page} · confiança {Math.round(Number(opening.confidence) * 100)}%</span></div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div><label className="label">Código</label><input className="input input-sm" value={opening.code ?? ""} placeholder={opening.kind === "porta" ? "P01" : "J01"} onChange={(event) => setOpenings((items) => items.map((item) => item.id === opening.id ? { ...item, code: event.target.value || null, needsConfirmation: true } : item))} /></div>
          <div className="sm:col-span-2"><label className="label">Nome / modelo</label><input className="input input-sm" value={opening.designation ?? ""} placeholder={opening.kind === "porta" ? "Ex.: Porta principal" : "Ex.: Janela da sala"} onChange={(event) => setOpenings((items) => items.map((item) => item.id === opening.id ? { ...item, designation: event.target.value || null, needsConfirmation: true } : item))} /></div>
          <div><label className="label">Piso</label><select className="input input-sm" value={opening.floor ?? UNASSIGNED_FLOOR} onChange={(event) => setOpenings((items) => items.map((item) => item.id === opening.id ? { ...item, floor: event.target.value === UNASSIGNED_FLOOR ? null : event.target.value, needsConfirmation: true } : item))}>{availableOpeningFloors.map((name) => <option key={name} value={name}>{name}</option>)}</select></div>
          <div><label className="label">Largura (m)</label><input className="input input-sm" type="number" step="0.01" min="0" value={opening.widthM ?? ""} onChange={(event) => setOpenings((items) => items.map((item) => item.id === opening.id ? { ...item, widthM: event.target.value || null, needsConfirmation: true } : item))} /></div>
          <div><label className="label">Altura (m)</label><input className="input input-sm" type="number" step="0.01" min="0" value={opening.heightM ?? ""} onChange={(event) => setOpenings((items) => items.map((item) => item.id === opening.id ? { ...item, heightM: event.target.value || null, needsConfirmation: true } : item))} /></div>
          <div><label className="label">Quantidade</label><input className="input input-sm" type="number" step="1" min="1" value={opening.quantity} onChange={(event) => setOpenings((items) => items.map((item) => item.id === opening.id ? { ...item, quantity: Math.max(1, Number(event.target.value)), needsConfirmation: true } : item))} /></div>
          <div><label className="label">Parede</label><select className="input input-sm" value={opening.location} onChange={(event) => setOpenings((items) => items.map((item) => item.id === opening.id ? { ...item, location: event.target.value as ExtractedOpening["location"], needsConfirmation: true } : item))}><option value="desconhecida">Por definir</option><option value="interior">Interior</option><option value="exterior">Exterior</option></select></div>
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(260px,1fr)_minmax(260px,2fr)]">
          <div><label className="label">Material</label><button type="button" className="input input-sm flex w-full items-center justify-between gap-2 text-left" onClick={() => openMaterialEditor(opening)}><span className={linkedMaterial ? "truncate font-medium text-slate-900" : "text-slate-500"}>{linkedMaterial?.name ?? "Indicar material"}</span><span className="shrink-0 text-xs font-semibold text-brand-700">{linkedMaterial ? `${Number(openingPrices[opening.id] || linkedMaterial.effectiveUnitCost).toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${linkedMaterial.currency}/${materialUnit} · Alterar` : "Escolher ou criar"}</span></button></div>
          <div><label className="label">Especificação técnica</label><textarea className="input min-h-20 resize-y" value={opening.technicalSpecification ?? ""} placeholder="Perfil, acabamento, vidro, ferragens ou referência" onChange={(event) => setOpenings((items) => items.map((item) => item.id === opening.id ? { ...item, technicalSpecification: event.target.value || null, needsConfirmation: true } : item))} /></div>
        </div>
        <div className="mt-3 flex flex-wrap justify-end gap-2"><button type="button" className="btn btn-secondary btn-sm text-red-600" onClick={() => deleteOpening(opening.id)}><IconTrash className="h-4 w-4" /> Eliminar</button><button type="button" className="btn btn-primary btn-sm" disabled={savingOpeningId === opening.id || !opening.widthM || !opening.heightM || opening.location === "desconhecida"} onClick={() => saveOpening(opening)}>{savingOpeningId === opening.id ? "A guardar" : opening.needsConfirmation ? "Confirmar e guardar" : "Guardar alterações"}</button></div>
      </div>
    );
  }

  function openSlabManager() {
    setSlabDrafts((plant?.structuralSummary?.slabs ?? []).map((slab, index) => {
      const normalizedFloor = (slab.floor ?? "").toLocaleLowerCase("pt");
      let inferredArea = rooms
        .filter((room) => (room.floor ?? "").toLocaleLowerCase("pt") === normalizedFloor)
        .reduce((sum, room) => sum + Number(room.areaM2), 0);
      if (!inferredArea && /cobertura/i.test(slab.floor ?? "")) {
        const upperFloor = floorNames.filter((floor) => floor !== UNASSIGNED_FLOOR && !/cobertura/i.test(floor)).at(-1);
        inferredArea = rooms.filter((room) => room.floor === upperFloor).reduce((sum, room) => sum + Number(room.areaM2), 0);
      }
      return {
        ...slab,
        name: slab.name ?? (slab.floor ? `Laje - ${slab.floor}` : `Laje ${index + 1}`),
        areaM2: slab.areaM2 ?? (inferredArea || undefined),
        topRebar: slab.topRebar ? { ...slab.topRebar } : null,
        bottomRebar: slab.bottomRebar ? { ...slab.bottomRebar } : null,
      };
    }));
    setSlabManagerOpen(true);
  }

  function addSlab() {
    const index = slabDrafts.length + 1;
    const defaultLayer: SlabRebarLayer = { xDiameterMm: 0, xSpacingCm: 0, yDiameterMm: 0, ySpacingCm: 0 };
    setSlabDrafts((items) => [...items, {
      name: `Laje ${index}`,
      floor: availableOpeningFloors.find((floor) => floor !== UNASSIGNED_FLOOR) ?? null,
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
    }]);
  }

  function updateSlab(index: number, patch: Partial<StructuralSlab>) {
    setSlabDrafts((items) => items.map((slab, slabIndex) => slabIndex === index ? { ...slab, ...patch } : slab));
  }

  function updateSlabLayer(index: number, layerName: "topRebar" | "bottomRebar", patch: Partial<SlabRebarLayer>) {
    setSlabDrafts((items) => items.map((slab, slabIndex) => {
      if (slabIndex !== index) return slab;
      const current = slab[layerName] ?? { xDiameterMm: 10, xSpacingCm: 20, yDiameterMm: 10, ySpacingCm: 20 };
      return { ...slab, [layerName]: { ...current, ...patch } };
    }));
  }

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
    const scheduledByDiameter = Object.entries(slab.steelByDiameter ?? {}).map(([diameter, weightKg]) => ({
      diameterMm: Number(diameter),
      weightKg: Number(weightKg),
    })).filter((line) => line.diameterMm > 0 && line.weightKg > 0);
    const weightLines = scheduledByDiameter.length ? scheduledByDiameter : computeSlabRebarWeightLines({
      areaM2: area, layers, lapFactor: DEFAULT_SLAB_LAP_FACTOR,
    });
    const plan = buildRebarPurchasePlan(
      weightLines.map((line) => ({ diameterMm: line.diameterMm, weightKg: line.weightKg * 1.05 })),
      DEFAULT_REBAR_LENGTH_M,
    );
    return plan.map((line) => `Ø${line.diameterMm}: ${line.barsToBuy} varões`).join(" · ");
  }

  async function saveSlabs() {
    if (!plant) return;
    const layerIsValid = (layer?: SlabRebarLayer | null) => Boolean(layer && layer.xDiameterMm > 0 && layer.xSpacingCm > 0 && layer.yDiameterMm > 0 && layer.ySpacingCm > 0);
    if (slabDrafts.some((slab) => {
      const hasScheduledWeight = Number(slab.topSteelWeightKg ?? 0) + Number(slab.bottomSteelWeightKg ?? 0) > 0;
      const hasValidMesh = layerIsValid(slab.topRebar) && layerIsValid(slab.bottomRebar);
      return !slab.name?.trim() || !slab.areaM2 || slab.areaM2 <= 0 || slab.thicknessCm <= 0 || (!hasScheduledWeight && !hasValidMesh);
    })) {
      setError("Preencha nome, área e espessura. A armadura pode vir do mapa de aço ou de uma malha superior/inferior confirmada.");
      return;
    }
    setSavingSlabs(true);
    setError(null);
    try {
      const updated = await plantsApi.updateSlabs(plant.id, slabDrafts.map((slab) => ({
        ...slab,
        name: slab.name?.trim(),
        floor: slab.floor || null,
        layers: [...(slab.bottomRebar ? ["inferior" as const] : []), ...(slab.topRebar ? ["superior" as const] : [])],
        pages: slab.pages.length ? slab.pages : [1],
      })));
      setPlant(updated);
      setSlabManagerOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível guardar as lajes");
    } finally {
      setSavingSlabs(false);
    }
  }

  if (!plant) {
    return <div className="min-h-screen flex items-center justify-center text-gray-400">A carregar...</div>;
  }

  const totalRoomsArea = rooms.reduce((s, r) => s + Number(r.areaM2), 0);
  const roomsWithPerimeter = rooms.filter((room) => room.perimeterM != null && Number(room.perimeterM) > 0).length;
  const identityBlocked = Boolean(
    plant.documentAnalysis?.requiresIdentityConfirmation
    && !plant.documentAnalysis.identityConfirmed,
  );
  const identityFieldLabels = {
    owner: "Dono / cliente",
    location: "Localização",
    project_title: "Título da obra",
  } as const;
  const totalRebarWeight = rebarSchedules.reduce((s, r) => s + Number(r.weightKg), 0);
  const rebarPurchasePlan = buildRebarPurchasePlan(
    rebarSchedules.map((line) => ({ diameterMm: Number(line.diameterMm), weightKg: Number(line.weightKg) })),
  );
  const materialEditorOpening = openings.find((opening) => opening.id === materialEditorOpeningId) ?? null;
  const managedOpenings = openingManagerKind ? openings.filter((opening) => opening.kind === openingManagerKind) : [];
  const managedOpeningFloorNames = Array.from(new Set(managedOpenings.map((opening) => opening.floor ?? UNASSIGNED_FLOOR))).sort((a, b) => floorSortKey(a) - floorSortKey(b));
  const filteredOpeningMaterials = catalogMaterials.filter((material) => {
    const query = materialSearch.trim().toLocaleLowerCase("pt");
    return !query || material.name.toLocaleLowerCase("pt").includes(query) || material.category.toLocaleLowerCase("pt").includes(query);
  });

  // Lacunas de extracção: o utilizador pediu explicitamente para ser informado do que não foi
  // possível puxar automaticamente da planta, sem lhe perguntar como reformatar o ficheiro — por
  // isso listamos factos concretos (o quê não foi encontrado) e nunca pedimos para reenviar nada.
  const structuredQualityIssues = plant.documentAnalysis?.qualityIssues ?? [];
  const gaps: string[] = structuredQualityIssues
    .filter((issue) => issue.severity !== "info")
    .map((issue) => issue.message);
  const detectedDisciplines = new Set(plant.documentAnalysis?.sections.map((section) => section.discipline));
  const hasArchitecture = detectedDisciplines.size > 0 ? detectedDisciplines.has("arquitectura") : plant.discipline === "arquitectura";
  const hasStructure = detectedDisciplines.size > 0 ? detectedDisciplines.has("estrutura") : plant.discipline === "estrutura";
  const hydrosanitarySummary = plant.documentAnalysis?.hydrosanitarySummary ?? null;
  const measuredHydroPipes = hydrosanitarySummary?.pipes.filter((pipe) => pipe.measuredLengthM != null) ?? [];
  const displayedHydroPipes = measuredHydroPipes.length > 0
    ? measuredHydroPipes
    : hydrosanitarySummary?.pipes.filter((pipe) => pipe.evidenceKind === "planta").slice(0, 12) ?? [];
  const measuredHydroTotalM = measuredHydroPipes.reduce((total, pipe) => total + Number(pipe.measuredLengthM ?? 0), 0);
  const quantifiedHydroEquipment = hydrosanitarySummary?.equipment.filter((item) => item.quantity != null && item.source !== "vector_topology") ?? [];
  const estimatedHydroAccessories = hydrosanitarySummary?.equipment.filter((item) => item.quantity != null && item.source === "vector_topology") ?? [];
  const structuralSummary = plant.structuralSummary ?? {
    footingsCount: 0, footingsAvgWidthCm: 0, footingsAvgLengthCm: 0, footingsAvgDepthCm: 0,
    columnsCount: 0, beamsCount: 0, beamsTotalLengthM: 0, beamsAvgWidthCm: 0, beamsAvgHeightCm: 0,
    beamsConcreteVolumeM3: 0, beamGroups: [], staircasesCount: 0, slabsCount: 0, slabsAvgThicknessCm: 0, slabs: [],
    footingsSteelWeightKg: 0, columnsSteelWeightKg: 0, beamsSteelWeightKg: 0, slabsSteelWeightKg: 0,
    stairsSteelWeightKg: 0, totalSteelWeightKg: 0,
  };
  const steelByFamily = classifyStructuralSteelWeights(
    rebarSchedules.map((line) => ({ element: line.element, weightKg: Number(line.weightKg) })),
  );
  const steelByFamilyDiameter = steelWeightsByFamilyAndDiameter(
    rebarSchedules.map((line) => ({
      element: line.element,
      diameterMm: Number(line.diameterMm),
      weightKg: Number(line.weightKg),
    })),
  );
  const footingDiameterLabel = formatSteelDiameterBreakdown(steelByFamilyDiameter.footings);
  const columnDiameterLabel = formatSteelDiameterBreakdown(steelByFamilyDiameter.columns);
  const beamDiameterLabel = formatSteelDiameterBreakdown(steelByFamilyDiameter.beams);
  const slabDiameterLabel = formatSteelDiameterBreakdown(steelByFamilyDiameter.slabs);
  const stairDiameterLabel = formatSteelDiameterBreakdown(steelByFamilyDiameter.stairs);
  if (plant.processingStatus === "erro") {
    gaps.push(
      plant.errorMessage
        ? `Não foi possível processar este ficheiro: ${plant.errorMessage}.`
        : "Não foi possível processar este ficheiro."
    );
  } else if (structuredQualityIssues.length === 0) {
    if (hasStructure) {
      const s = plant.structuralSummary;
      if (!s) {
        gaps.push(
          "Não foi possível identificar nenhum elemento estrutural (sapatas, pilares ou vigas) nesta planta — o formato deste desenho ainda não é reconhecido pelo sistema."
        );
      } else {
        if (s.footingsCount === 0) gaps.push("Não foram identificadas sapatas/fundações.");
        if (s.columnsCount === 0) gaps.push("Não foram identificados pilares.");
        if (s.beamsCount === 0) gaps.push("Não foram identificadas vigas.");
        if (s.slabsCount === 0) gaps.push("Não foi identificada armadura de laje/cobertura.");
        if (s.totalSteelWeightKg === 0 && rebarSchedules.length === 0 && (s.footingsCount > 0 || s.columnsCount > 0 || s.beamsCount > 0)) {
          gaps.push(
            "Não foi possível determinar o peso total de aço — este desenho não parece incluir resumos de peso por elemento, apenas posições/comprimentos de varões."
          );
        }
      }
    }
    if (hasArchitecture && rooms.length === 0) {
      gaps.push("Não foram identificados compartimentos (áreas) nas páginas de arquitectura.");
    }
    if (hasArchitecture && openings.length === 0) {
      gaps.push("Não foram encontrados quadros ou etiquetas inequívocas de portas e janelas. Registe os vãos manualmente antes de calcular as paredes líquidas.");
    } else if (openings.some((opening) => opening.needsConfirmation || !opening.widthM || !opening.heightM || opening.location === "desconhecida")) {
      gaps.push(`${openings.filter((opening) => opening.needsConfirmation || !opening.widthM || !opening.heightM || opening.location === "desconhecida").length} vão(s) precisam de confirmação de dimensão ou localização.`);
    }
  }

  return (
    <Layout
      title={plant.originalFileName ?? "Planta"}
      actions={
        <div className="flex gap-2">
          <button type="button" onClick={goBackToProject} className="btn btn-ghost btn-sm">
            <IconBack className="w-3.5 h-3.5" />
            Voltar ao projecto
          </button>
          <a href={`/api/files/plants/${plant.id}`} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
            Ver PDF original
          </a>
          <button onClick={handleReprocess} disabled={reprocessing} className="btn btn-ghost btn-sm">
            <IconRefresh className="w-3.5 h-3.5" />
            {reprocessing ? `A reprocessar ${plant.processingProgress}%` : "Reprocessar"}
          </button>
        </div>
      }
    >
      <div className="mx-auto w-full max-w-4xl space-y-5">
        {error && <p className="text-sm text-red-600">{error}</p>}

        <section className="card overflow-hidden border-t-4 border-t-brand-600">
          <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
                {gaps.length > 0 ? "Análise parcial — acção necessária" : "Análise concluída"}
              </p>
              <h2 className="mt-1 text-lg font-bold text-slate-900">
                {gaps.length > 0 ? "Alguns dados em falta — preencha ou aguarde a revisão" : "Resumo da planta — confirme só se necessário"}
              </h2>
              <p className="mt-1 max-w-2xl text-sm text-slate-600">
                {rooms.length} compartimento(s) · {totalRoomsArea.toFixed(2)} m² · {gaps.length > 0
                  ? "pode completar no formulário dedicado enquanto a equipa melhora o motor (resposta em até 5h)."
                  : "pode medir já ou corrigir pisos abaixo."}
              </p>
            </div>
            <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
            <button type="button" onClick={goBackToProject} className="btn btn-ghost sm:order-last">
              <IconBack className="h-4 w-4" />
              Voltar
            </button>
            <Link to={`/plantas/${plant.id}/completar`} className="btn btn-secondary">
              Editar dados
            </Link>
            <button
              type="button"
              onClick={() => void handleConfirmReadyForMeasurement()}
              disabled={plant.processingStatus !== "concluido" || preparingMeasurements || identityBlocked}
              className="btn btn-primary"
            >
              <IconRuler className="h-4 w-4" />
              {preparingMeasurements ? "A preparar…" : "Confirmar dados e medir"}
            </button>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3 text-xs text-slate-600">
            <span>{identityBlocked ? "A combinação automática está suspensa até confirmar as disciplinas." : "Tem outra disciplina? Adicione-a antes ou depois; os dados serão combinados automaticamente."}</span>
            <Link to={`/projectos/${plant.projectId}#plantas-do-projecto`} className="font-semibold text-brand-700 hover:underline">Adicionar outro projecto →</Link>
          </div>
        </section>

        {identityBlocked && plant.documentAnalysis && (
          <section className="card overflow-hidden border-amber-300 bg-amber-50">
            <div className="p-5">
              <p className="text-xs font-bold uppercase tracking-wide text-amber-700">Confirmação necessária</p>
              <h2 className="mt-1 text-lg font-bold text-slate-950">As disciplinas podem pertencer a obras diferentes</h2>
              <p className="mt-1 text-sm text-slate-700">As medições não serão combinadas até validar os dados abaixo.</p>
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {plant.documentAnalysis.identityConflicts.map((conflict) => (
                  <div key={conflict.field} className="rounded-xl border border-amber-200 bg-white p-4">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{identityFieldLabels[conflict.field]}</p>
                    <div className="mt-2 space-y-2">
                      {conflict.values.map((entry) => (
                        <div key={`${conflict.field}-${entry.value}`} className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                          <span className="font-semibold text-slate-900">{entry.value}</span>
                          <span className="text-xs text-slate-500">{entry.disciplines.join(", ")} · pág. {entry.pages.join(", ")}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <button type="button" onClick={handleConfirmIdentity} disabled={confirmingIdentity} className="btn btn-primary mt-4">
                {confirmingIdentity ? "A confirmar..." : "Confirmar que pertencem à mesma obra"}
              </button>
            </div>
          </section>
        )}

        {plant.documentAnalysis && (
          <details className="card overflow-hidden">
            <summary className="cursor-pointer px-5 py-4 font-semibold text-slate-900">Detalhes da leitura do PDF ({plant.documentAnalysis.pageCount} páginas)</summary>
            <div className="grid gap-3 border-t border-slate-100 p-5 sm:grid-cols-2 lg:grid-cols-3">
              {plant.documentAnalysis.sections.map((section, index) => (
                <div key={`${section.discipline}-${section.startPage}-${index}`} className={`rounded-lg border p-3 ${SECTION_STYLES[section.discipline]}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold">{section.label}</p>
                      <p className="mt-0.5 text-xs opacity-75">{pageRange(section.startPage, section.endPage)} · {section.pageCount} página(s)</p>
                      <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide opacity-70">Secção organizada</p>
                      {section.identity && (section.identity.owner || section.identity.location || section.identity.projectTitle) && (
                        <div className="mt-2 space-y-0.5 text-[11px] leading-snug opacity-80">
                          {section.identity.projectTitle && <p><span className="font-semibold">Obra:</span> {section.identity.projectTitle}</p>}
                          {section.identity.owner && <p><span className="font-semibold">Dono:</span> {section.identity.owner}</p>}
                          {section.identity.location && <p><span className="font-semibold">Local:</span> {section.identity.location}</p>}
                        </div>
                      )}
                    </div>
                    <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-semibold tabular-nums">{Math.round(section.confidence * 100)}%</span>
                  </div>
                  {section.evidence.length > 0 && <p className="mt-2 text-[11px] leading-relaxed opacity-75">Reconhecido por {section.evidence.slice(0, 2).join(" e ")}.</p>}
                </div>
              ))}
            </div>
          </details>
        )}

        {gaps.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            {gaps.length} ponto(s) por regularizar — consulte a lista de validação no final desta página, ou{" "}
            <Link to={`/plantas/${plant.id}/completar`} className="font-semibold underline">edite os dados agora</Link>.
          </div>
        )}

        {hydrosanitarySummary && (
          <section className="card card-pad">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="section-title">Redes hidrossanitárias</h2>
                <p className="muted mt-1">
                  {measuredHydroPipes.length > 0
                    ? `${measuredHydroTotalM.toFixed(2)} m medidos em traçados com escala confirmada.`
                    : "Diâmetros encontrados nas pranchas; comprimentos continuam por confirmar."}
                </p>
              </div>
              <Link to={`/plantas/${plant.id}/completar`} className="btn btn-secondary btn-sm">Confirmar redes</Link>
            </div>
            <div className="flex flex-wrap gap-2">
              {hydrosanitarySummary.systems.map((system) => (
                <span key={system} className="badge badge-neutral">{system.replaceAll("_", " ")}</span>
              ))}
              {hydrosanitarySummary.septicTankDetected && <span className="badge badge-neutral">fossa séptica</span>}
              {hydrosanitarySummary.poolDetected && <span className="badge badge-neutral">piscina</span>}
            </div>
            {displayedHydroPipes.length > 0 && (
              <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[620px] text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr><th className="px-4 py-3">Rede</th><th className="px-4 py-3">Piso</th><th className="px-4 py-3">Material</th><th className="px-4 py-3">Diâmetro</th><th className="px-4 py-3">{measuredHydroPipes.length > 0 ? "Comprimento" : "Ocorrências"}</th><th className="px-4 py-3">Origem</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {displayedHydroPipes.map((pipe, index) => (
                      <tr key={`${pipe.system}-${pipe.page}-${pipe.diameterMm}-${pipe.diameterInch}-${index}`}>
                        <td className="px-4 py-3 font-medium text-slate-900">{pipe.system.replaceAll("_", " ")}</td>
                        <td className="px-4 py-3 text-slate-600">{pipe.floor ?? "por confirmar"}</td>
                        <td className="px-4 py-3 text-slate-600">{pipe.material ?? "por confirmar"}</td>
                        <td className="px-4 py-3 tabular-nums">{pipe.diameterMm != null ? `Ø ${pipe.diameterMm.toFixed(0)} mm` : pipe.diameterInch ? `Ø ${pipe.diameterInch}″` : "por confirmar"}</td>
                        <td className="px-4 py-3 font-semibold tabular-nums text-slate-900">{pipe.measuredLengthM != null ? `${pipe.measuredLengthM.toFixed(2)} m` : pipe.occurrences}</td>
                        <td className="px-4 py-3 text-slate-500">vetor · pág. {pipe.page}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {quantifiedHydroEquipment.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Equipamentos e pontos identificados</p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {quantifiedHydroEquipment.map((item, index) => (
                    <div key={`${item.kind}-${item.page}-${item.code}-${index}`} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{item.kind.replaceAll("_", " ")}{item.code ? ` ${item.code}` : ""}</p>
                        <p className="text-xs text-slate-500">{item.floor ?? `pág. ${item.page}`}{item.capacityL ? ` · ${item.capacityL.toFixed(0)} L` : ""}{item.requiresConfirmation ? " · confirmar" : ""}</p>
                      </div>
                      <span className="text-base font-bold tabular-nums text-brand-700">{item.quantity}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {estimatedHydroAccessories.length > 0 && (
              <details className="mt-4 rounded-lg border border-amber-200 bg-amber-50">
                <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-amber-950">Acessórios estimados pelo traçado ({estimatedHydroAccessories.reduce((total, item) => total + Number(item.quantity ?? 0), 0)})</summary>
                <div className="flex flex-wrap gap-2 border-t border-amber-200 px-3 py-3">
                  {estimatedHydroAccessories.map((item, index) => (
                    <span key={`${item.kind}-${item.page}-${index}`} className="rounded-full bg-white px-2.5 py-1 text-xs text-amber-950">{item.kind.replaceAll("_", " ")}: {item.quantity} · {item.floor ?? `pág. ${item.page}`}</span>
                  ))}
                </div>
              </details>
            )}
          </section>
        )}

        {hasStructure && (
          <section className="card card-pad">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <IconRuler className="w-4 h-4 text-brand-700" />
                <h2 className="section-title">Resumo estrutural detectado</h2>
              </div>
              <Link to={`/plantas/${plant.id}/completar`} className="btn btn-secondary btn-sm">
                Editar estrutura
              </Link>
            </div>
            <div className="mb-3 grid grid-cols-2 gap-3 text-center sm:grid-cols-3 xl:grid-cols-5">
              <button
                type="button"
                className="rounded-lg border border-gray-200 p-3 text-left transition-colors hover:border-brand-300 hover:bg-brand-50"
                onClick={() => setFamilyPopup({
                  id: "sapatas",
                  title: "Sapatas / fundações",
                  hash: "sapatas",
                  lines: [
                    `${structuralSummary.footingsCount} sapata(s)`,
                    `Medidas médias ${(Number(structuralSummary.footingsAvgWidthCm) / 100).toFixed(2)} × ${(Number(structuralSummary.footingsAvgLengthCm) / 100).toFixed(2)} m · h ${Number(structuralSummary.footingsAvgDepthCm).toFixed(2)} cm`,
                    `Aço ${roundStructuralQty(Number(structuralSummary.footingsSteelWeightKg ?? steelByFamily.footingsSteelWeightKg)).toFixed(2)} kg`,
                    `Armaduras: ${footingDiameterLabel}`,
                  ],
                })}
              >
                <p className="text-xl font-semibold text-gray-900">{structuralSummary.footingsCount}</p>
                <p className="muted">sapatas · {roundStructuralQty(Number(structuralSummary.footingsSteelWeightKg ?? steelByFamily.footingsSteelWeightKg)).toFixed(2)} kg aço</p>
                <p className="mt-1 text-[11px] leading-snug text-slate-500">{footingDiameterLabel}</p>
                <span className="mt-1 block text-xs font-semibold text-brand-700">Ver / editar</span>
              </button>
              <button
                type="button"
                className="rounded-lg border border-gray-200 p-3 text-left transition-colors hover:border-brand-300 hover:bg-brand-50"
                onClick={() => setFamilyPopup({
                  id: "pilares",
                  title: "Pilares",
                  hash: "pilares",
                  lines: [
                    `${structuralSummary.columnsCount} pilar(es)`,
                    `Aço ${roundStructuralQty(Number(structuralSummary.columnsSteelWeightKg ?? steelByFamily.columnsSteelWeightKg)).toFixed(2)} kg`,
                    `Armaduras: ${columnDiameterLabel}`,
                  ],
                })}
              >
                <p className="text-xl font-semibold text-gray-900">{structuralSummary.columnsCount}</p>
                <p className="muted">pilares · {roundStructuralQty(Number(structuralSummary.columnsSteelWeightKg ?? steelByFamily.columnsSteelWeightKg)).toFixed(2)} kg aço</p>
                <p className="mt-1 text-[11px] leading-snug text-slate-500">{columnDiameterLabel}</p>
                <span className="mt-1 block text-xs font-semibold text-brand-700">Ver / editar</span>
              </button>
              <button
                type="button"
                className="rounded-lg border border-gray-200 p-3 text-left transition-colors hover:border-brand-300 hover:bg-brand-50"
                onClick={() => setFamilyPopup({
                  id: "vigas",
                  title: "Vigas por laje",
                  hash: "vigas",
                  lines: [
                    `${structuralSummary.beamsCount} viga(s) · ${Number(structuralSummary.beamsTotalLengthM).toFixed(2)} ml · ${Number(structuralSummary.beamsConcreteVolumeM3).toFixed(2)} m³`,
                    `Aço ${roundStructuralQty(Number(structuralSummary.beamsSteelWeightKg ?? steelByFamily.beamsSteelWeightKg)).toFixed(2)} kg`,
                    `Armaduras: ${beamDiameterLabel}`,
                    ...((structuralSummary.beamGroups?.length ?? 0) > 0
                      ? structuralSummary.beamGroups!.map((g) => `${g.label}: ${g.beamsCount} un · ${Number(g.totalLengthM).toFixed(2)} m · ${Number(g.steelWeightKg ?? 0).toFixed(2)} kg`)
                      : ["Ainda sem grupos por laje — edite em Completar dados"]),
                  ],
                })}
              >
                <p className="text-xl font-semibold text-gray-900">{structuralSummary.beamsCount}</p>
                <p className="muted">vigas · {Number(structuralSummary.beamsTotalLengthM).toFixed(2)} ml · {roundStructuralQty(Number(structuralSummary.beamsSteelWeightKg ?? steelByFamily.beamsSteelWeightKg)).toFixed(2)} kg</p>
                <p className="mt-1 text-[11px] leading-snug text-slate-500">{beamDiameterLabel}</p>
                <span className="mt-1 block text-xs font-semibold text-brand-700">Por laje · editar</span>
              </button>
              <button type="button" className="rounded-lg border border-gray-200 p-3 text-left transition-colors hover:border-brand-300 hover:bg-brand-50" onClick={openSlabManager}>
                <p className="text-xl font-semibold text-gray-900">{structuralSummary.slabsCount}</p>
                <p className="muted">laje(s) · {roundStructuralQty(Number(structuralSummary.slabsSteelWeightKg ?? steelByFamily.slabsSteelWeightKg)).toFixed(2)} kg</p>
                <p className="mt-1 text-[11px] leading-snug text-slate-500">{slabDiameterLabel}</p>
                <span className="mt-1 block text-xs font-semibold text-brand-700">Indicar ou corrigir</span>
              </button>
              <button
                type="button"
                className="rounded-lg border border-gray-200 p-3 text-left transition-colors hover:border-brand-300 hover:bg-brand-50"
                onClick={() => setFamilyPopup({
                  id: "escadas",
                  title: "Escadas",
                  hash: "escadas",
                  lines: [
                    `${structuralSummary.staircasesCount} escada(s)`,
                    `Aço ${roundStructuralQty(Number(structuralSummary.stairsSteelWeightKg ?? steelByFamily.stairsSteelWeightKg)).toFixed(2)} kg`,
                    `Armaduras: ${stairDiameterLabel}`,
                    `Total de aço do projecto ${Number(structuralSummary.totalSteelWeightKg).toFixed(2)} kg`,
                  ],
                })}
              >
                <p className="text-xl font-semibold text-gray-900">{structuralSummary.staircasesCount}</p>
                <p className="muted">escada(s) · {roundStructuralQty(Number(structuralSummary.stairsSteelWeightKg ?? steelByFamily.stairsSteelWeightKg)).toFixed(2)} kg</p>
                <p className="mt-1 text-[11px] leading-snug text-slate-500">{stairDiameterLabel}</p>
                <span className="mt-1 block text-xs font-semibold text-brand-700">Ver / editar</span>
              </button>
            </div>
            <div className="mb-3 grid grid-cols-2 gap-2 text-center sm:grid-cols-5">
              <div className="rounded-lg bg-slate-50 px-2 py-2 text-xs text-slate-600">
                Sapatas <strong className="block text-sm text-slate-900">{roundStructuralQty(Number(structuralSummary.footingsSteelWeightKg ?? steelByFamily.footingsSteelWeightKg)).toFixed(2)} kg</strong>
              </div>
              <div className="rounded-lg bg-slate-50 px-2 py-2 text-xs text-slate-600">
                Pilares <strong className="block text-sm text-slate-900">{roundStructuralQty(Number(structuralSummary.columnsSteelWeightKg ?? steelByFamily.columnsSteelWeightKg)).toFixed(2)} kg</strong>
              </div>
              <div className="rounded-lg bg-slate-50 px-2 py-2 text-xs text-slate-600">
                Vigas <strong className="block text-sm text-slate-900">{roundStructuralQty(Number(structuralSummary.beamsSteelWeightKg ?? steelByFamily.beamsSteelWeightKg)).toFixed(2)} kg</strong>
              </div>
              <div className="rounded-lg bg-slate-50 px-2 py-2 text-xs text-slate-600">
                Lajes <strong className="block text-sm text-slate-900">{roundStructuralQty(Number(structuralSummary.slabsSteelWeightKg ?? steelByFamily.slabsSteelWeightKg)).toFixed(2)} kg</strong>
              </div>
              <div className="rounded-lg bg-slate-50 px-2 py-2 text-xs text-slate-600">
                Escadas <strong className="block text-sm text-slate-900">{roundStructuralQty(Number(structuralSummary.stairsSteelWeightKg ?? steelByFamily.stairsSteelWeightKg)).toFixed(2)} kg</strong>
              </div>
            </div>
            {(structuralSummary.beamGroups?.length ?? 0) > 0 && (
              <div className="mb-3 grid gap-2 sm:grid-cols-2">
                {structuralSummary.beamGroups!.map((group, index) => (
                  <div key={group.id ?? `${group.label}-${index}`} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                    <strong className="text-slate-900">{group.label}</strong>
                    <span className="mt-0.5 block text-xs text-slate-500">
                      {group.beamsCount} viga(s) · {Number(group.totalLengthM).toFixed(2)} m · {Number(group.steelWeightKg ?? 0).toFixed(2)} kg
                      {group.floor ? ` · ${group.floor}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {(structuralSummary.slabs?.length ?? 0) > 0 && (
              <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {structuralSummary.slabs!.map((slab, index) => (
                  <div key={`${slab.floor ?? "laje"}-${slab.thicknessCm}-${index}`} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <strong className="block text-sm text-slate-900">{slab.name ?? slab.floor ?? `Laje ${index + 1}`}</strong>
                    <span className="text-xs text-slate-500">{slab.areaM2 ? `${slab.areaM2.toFixed(2)} m² · ` : ""}espessura {slab.thicknessCm.toFixed(2)} cm{(slab.topSteelWeightKg ?? 0) + (slab.bottomSteelWeightKg ?? 0) > 0 ? ` · ${((slab.topSteelWeightKg ?? 0) + (slab.bottomSteelWeightKg ?? 0)).toFixed(2)} kg` : slab.topRebar && slab.bottomRebar ? " · armadura superior e inferior" : ""}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="mb-1 text-sm font-semibold text-slate-800">
              Total aço: {Number(structuralSummary.totalSteelWeightKg || steelByFamily.totalSteelWeightKg).toFixed(2)} kg
              {steelByFamily.otherSteelWeightKg > 0 ? ` (inclui ${steelByFamily.otherSteelWeightKg.toFixed(2)} kg não classificados)` : ""}
            </p>
            <p className="text-xs text-gray-500 mb-3">
              Clique em cada família para ver o detalhe ou editar em Completar dados. Os números alimentam medições e orçamento
              (sapatas, pilares, vigas por laje, lajes e escadas).
            </p>
          </section>
        )}

        {rooms.length > 0 && (
          <section className="card card-pad">
            <div className="flex items-center gap-2 mb-3">
              <IconRuler className="w-4 h-4 text-brand-700" />
              <h2 className="section-title">Compartimentos ({rooms.length})</h2>
            </div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-gray-600">
              <span><strong className="text-gray-900">{totalRoomsArea.toFixed(2)} m²</strong> · {floorNames.length} piso(s) · {roomsWithPerimeter}/{rooms.length} perímetros</span>
              {roomsWithPerimeter < rooms.length && (
                <Link to={`/plantas/${plant.id}/completar#compartimentos`} className="btn btn-secondary btn-sm">Preencher perímetros</Link>
              )}
            </div>
            <div className="space-y-4">
              {floorNames.map((floorName) => {
                const floorRooms = roomsByFloor.get(floorName) ?? [];
                const floorArea = floorRooms.reduce((s, r) => s + Number(r.areaM2), 0);
                return (
                  <div key={floorName} className="rounded-lg border border-gray-200">
                    <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200 rounded-t-lg">
                      <span className="font-medium text-gray-900 text-sm">{floorName}</span>
                      <span className="muted">
                        {floorRooms.length} compartimento(s) · {floorArea.toFixed(2)} m²
                      </span>
                    </div>
                    <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-sm">
                      <thead><tr className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-500"><th className="px-3 py-2 text-left">Compartimento</th><th className="py-2 text-left">N.º</th><th className="py-2 text-right">Área</th><th className="py-2 text-right">Perímetro</th><th className="px-3 py-2 text-right">Piso</th></tr></thead>
                      <tbody>
                        {floorRooms.map((r) => (
                          <tr key={r.id} className="table-row">
                            <td className="py-1.5 pl-3">{r.name}</td>
                            <td className="text-gray-400">{r.number}</td>
                            <td className="text-right tabular-nums">{Number(r.areaM2).toFixed(2)} m²</td>
                            <td className={`text-right tabular-nums ${r.perimeterM ? "text-slate-700" : "font-medium text-amber-700"}`}>{r.perimeterM ? `${Number(r.perimeterM).toFixed(2)} m` : "Por preencher"}</td>
                            <td className="text-right pr-3 w-48">
                              <select
                                value={r.floor ?? UNASSIGNED_FLOOR}
                                disabled={savingRoomId === r.id}
                                onChange={(e) => handleFloorChange(r.id, e.target.value)}
                                className="input input-sm"
                              >
                                {floorNames.map((f) => (
                                  <option key={f} value={f}>
                                    {f}
                                  </option>
                                ))}
                                <option value="__new__">+ Novo piso...</option>
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table></div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {hasArchitecture && (
          <section id="portas-janelas" className="card card-pad scroll-mt-24">
            <div className="mb-4"><h2 className="section-title">Portas e janelas</h2><p className="mt-1 text-xs text-slate-500">Organizadas separadamente por tipo e piso.</p></div>
            <div className="grid gap-3 sm:grid-cols-2">
              {(["janela", "porta"] as const).map((kind) => {
                const typedOpenings = openings.filter((opening) => opening.kind === kind);
                const total = typedOpenings.reduce((sum, opening) => sum + opening.quantity, 0);
                const pending = typedOpenings.filter((opening) => opening.needsConfirmation || !opening.widthM || !opening.heightM || opening.location === "desconhecida").length;
                return (
                  <button key={kind} type="button" className="group flex min-h-28 items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 text-left transition-colors hover:border-brand-300 hover:bg-brand-50/40" onClick={() => setOpeningManagerKind(kind)}>
                    <span><strong className="block text-base text-slate-900">{kind === "janela" ? "Janelas" : "Portas"}</strong><span className="mt-1 block text-sm text-slate-500">{total} unidade(s) · {typedOpenings.length} modelo(s)</span>{pending > 0 && <span className="mt-2 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">{pending} por confirmar</span>}</span>
                    <span className="btn btn-secondary btn-sm group-hover:border-brand-300 group-hover:text-brand-700">Gerir</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {rebarSchedules.length > 0 && (
          <section className="card card-pad">
            <h2 className="section-title mb-3">Aço estrutural detectado ({rebarSchedules.length} linhas)</h2>
            <p className="text-sm text-gray-600 mb-3">
              Peso total: <span className="font-semibold text-gray-900">{totalRebarWeight.toFixed(2)} kg</span>
              {" · "}Sapatas {steelByFamily.footingsSteelWeightKg.toFixed(2)} · Pilares {steelByFamily.columnsSteelWeightKg.toFixed(2)} · Vigas {steelByFamily.beamsSteelWeightKg.toFixed(2)} · Lajes {steelByFamily.slabsSteelWeightKg.toFixed(2)} · Escadas {steelByFamily.stairsSteelWeightKg.toFixed(2)}
              {steelByFamily.otherSteelWeightKg > 0 ? ` · Outros ${steelByFamily.otherSteelWeightKg.toFixed(2)}` : ""} kg.
              Lista de compra por diâmetro (varões de 5,75 m).
            </p>
            <div className="mb-4 overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="table-head-row">
                    <th className="px-3 py-2 text-left">Elemento</th>
                    {[6, 8, 10, 12, 16].map((diameter) => (
                      <th key={diameter} className="px-2 py-2 text-right">Ø{diameter}</th>
                    ))}
                    <th className="pr-3 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {([
                    ["Sapatas", steelByFamilyDiameter.footings, steelByFamily.footingsSteelWeightKg],
                    ["Pilares", steelByFamilyDiameter.columns, steelByFamily.columnsSteelWeightKg],
                    ["Vigas", steelByFamilyDiameter.beams, steelByFamily.beamsSteelWeightKg],
                    ["Lajes", steelByFamilyDiameter.slabs, steelByFamily.slabsSteelWeightKg],
                    ["Escadas", steelByFamilyDiameter.stairs, steelByFamily.stairsSteelWeightKg],
                  ] as const).map(([label, rows, totalKg]) => {
                    const byDiameter = Object.fromEntries(rows.map((row) => [row.diameterMm, row.weightKg]));
                    return (
                      <tr key={label} className="table-row">
                        <td className="px-3 py-2 font-semibold text-slate-900">{label}</td>
                        {[6, 8, 10, 12, 16].map((diameter) => (
                          <td key={diameter} className="px-2 py-2 text-right tabular-nums text-slate-700">
                            {byDiameter[diameter] ? `${Number(byDiameter[diameter]).toFixed(1)}` : "—"}
                          </td>
                        ))}
                        <td className="pr-3 py-2 text-right font-semibold tabular-nums">{totalKg.toFixed(1)} kg</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mb-4 overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[660px] text-sm">
                <thead><tr className="table-head-row"><th className="px-3 py-2 text-left">Diâmetro</th><th className="text-right">Peso do mapa</th><th className="text-right">Comprimento</th><th className="text-right">Varões de 5,75 m</th><th className="pr-3 text-right">Peso de compra</th></tr></thead>
                <tbody>
                  {rebarPurchasePlan.map((line) => (
                    <tr key={line.diameterMm} className="table-row">
                      <td className="px-3 py-2 font-semibold">Ø{line.diameterMm} mm</td>
                      <td className="text-right tabular-nums">{line.scheduledWeightKg.toFixed(2)} kg</td>
                      <td className="text-right tabular-nums">{line.requiredLengthM.toFixed(2)} m</td>
                      <td className="text-right text-base font-bold tabular-nums text-brand-700">{line.barsToBuy}</td>
                      <td className="pr-3 text-right tabular-nums">{line.purchaseWeightKg.toFixed(2)} kg</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="overflow-x-auto max-h-80 overflow-y-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="table-head-row">
                    <th className="text-left py-1.5">Elemento</th>
                    <th className="text-left">Diâmetro</th>
                    <th className="text-right">Peso (kg)</th>
                    <th className="text-right">Página</th>
                  </tr>
                </thead>
                <tbody>
                  {rebarSchedules.map((r) => (
                    <tr key={r.id} className="table-row">
                      <td className="py-1.5">{r.element}</td>
                      <td>Ø{Number(r.diameterMm)}mm</td>
                      <td className="text-right tabular-nums">{Number(r.weightKg).toFixed(2)}</td>
                      <td className="text-right tabular-nums">{r.page}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section id="regularizacao-leitura" className="card overflow-hidden scroll-mt-24">
          <div className="border-b border-slate-100 bg-slate-50 px-5 py-4">
            <h2 className="section-title">Validação técnica</h2>
            <p className="mt-1 text-sm text-slate-600">
              Confirme apenas os pontos que o desenho não permitiu medir com segurança.
            </p>
          </div>
          <div className="space-y-3 p-4">
            {gaps.length === 0 ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                Sem lacunas críticas. Os dados estão prontos para medição.
              </div>
            ) : (
              gaps.map((gap, index) => (
                <button
                  key={`${gap}-${index}`}
                  type="button"
                  className="block w-full rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm text-amber-950 hover:border-amber-400"
                  onClick={() => setGapPopup(gap)}
                >
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">Ponto {index + 1}</span>
                  <span className="mt-1 block">{gap}</span>
                  <span className="mt-2 block text-xs font-semibold text-brand-700">Abrir →</span>
                </button>
              ))
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              <Link to={`/plantas/${plant.id}/completar`} className="btn btn-secondary btn-sm">
                Editar em Completar dados
              </Link>
              <button
                type="button"
                onClick={() => void handleConfirmReadyForMeasurement()}
                disabled={preparingMeasurements || identityBlocked || plant.processingStatus !== "concluido"}
                className="btn btn-primary btn-sm"
              >
                <IconRuler className="h-3.5 w-3.5" />
                {preparingMeasurements ? "A preparar…" : "Confirmar dados e medir"}
              </button>
            </div>
          </div>
        </section>
      </div>
      {gapPopup && (
        <Modal
          title="Regularizar este ponto"
          subtitle="Edite o elemento em Completar dados ou confirme após a revisão do motor"
          onClose={() => setGapPopup(null)}
          maxWidth="max-w-lg"
        >
          <p className="text-sm leading-relaxed text-slate-800">{gapPopup}</p>
          <p className="mt-3 text-xs text-slate-500">
            Em medições profissionais, cada família (sapatas, pilares, vigas da laje N, lajes, escadas) deve ter
            quantidade, geometria e kg de aço separados — assim o orçamento não mistura armaduras.
          </p>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => setGapPopup(null)}>Fechar</button>
            {gapCompletarHash(gapPopup) === "portas-janelas" ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setGapPopup(null);
                  document.getElementById("portas-janelas")?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                Ir às portas/janelas
              </button>
            ) : (
              <Link
                to={`/plantas/${plant.id}/completar#${gapCompletarHash(gapPopup)}`}
                className="btn btn-primary"
                onClick={() => setGapPopup(null)}
              >
                Editar este elemento
              </Link>
            )}
          </div>
        </Modal>
      )}
      {familyPopup && (
        <Modal
          title={familyPopup.title}
          subtitle="Dados detectados — edite no formulário dedicado se precisar corrigir"
          onClose={() => setFamilyPopup(null)}
          maxWidth="max-w-lg"
        >
          <ul className="space-y-2 text-sm text-slate-800">
            {familyPopup.lines.map((line) => (
              <li key={line} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">{line}</li>
            ))}
          </ul>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => setFamilyPopup(null)}>Fechar</button>
            {familyPopup.hash === "lajes" ? (
              <button type="button" className="btn btn-primary" onClick={() => { setFamilyPopup(null); openSlabManager(); }}>
                Gerir lajes
              </button>
            ) : (
              <Link
                to={`/plantas/${plant.id}/completar#${familyPopup.hash}`}
                className="btn btn-primary"
                onClick={() => setFamilyPopup(null)}
              >
                Editar em Completar dados
              </Link>
            )}
          </div>
        </Modal>
      )}
      {slabManagerOpen && (
        <Modal title="Lajes do projecto" subtitle="Área, espessura e armaduras por nível" onClose={() => setSlabManagerOpen(false)} maxWidth="max-w-6xl">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 px-4 py-3">
            <div><strong className="text-sm text-slate-900">{slabDrafts.length} laje(s)</strong><span className="ml-2 text-xs text-slate-500">{slabDrafts.reduce((sum, slab) => sum + Number(slab.areaM2 ?? 0), 0).toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m²</span></div>
            <button type="button" className="btn btn-primary btn-sm" onClick={addSlab}>+ Adicionar laje</button>
          </div>
          {error && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <datalist id="slab-floor-list">{availableOpeningFloors.filter((floor) => floor !== UNASSIGNED_FLOOR).map((floor) => <option key={floor} value={floor} />)}</datalist>

          {slabDrafts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center"><p className="text-sm text-slate-600">Registe uma laje para cada piso ou cobertura.</p><button type="button" className="btn btn-primary btn-sm mt-3" onClick={addSlab}>Adicionar primeira laje</button></div>
          ) : (
            <div className="space-y-4">
              {slabDrafts.map((slab, index) => (
                <article key={index} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
                    <div><strong className="text-sm text-slate-900">{slab.name || `Laje ${index + 1}`}</strong><span className="ml-2 text-xs text-slate-500">{(Number(slab.areaM2 ?? 0) * slab.thicknessCm / 100).toFixed(2)} m³ betão · {slabSteelWeight(slab).toFixed(2)} kg aço {(slab.topSteelWeightKg ?? 0) + (slab.bottomSteelWeightKg ?? 0) > 0 ? "do mapa" : "estimado"}</span>{slabBarPurchaseSummary(slab) && <span className="mt-1 block text-xs font-medium text-brand-700">Compra em barras de {DEFAULT_REBAR_LENGTH_M} m (+5% corte): {slabBarPurchaseSummary(slab)}</span>}</div>
                    <button type="button" className="btn btn-secondary btn-sm text-red-600" onClick={() => setSlabDrafts((items) => items.filter((_, slabIndex) => slabIndex !== index))}><IconTrash className="h-4 w-4" /> Remover</button>
                  </header>
                  <div className="space-y-4 p-4">
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <div className="sm:col-span-2"><label className="label">Nome da laje</label><input className="input input-sm" value={slab.name ?? ""} placeholder="Ex.: Laje do 1.º piso" onChange={(event) => updateSlab(index, { name: event.target.value })} /></div>
                      <div><label className="label">Piso / nível</label><input className="input input-sm" list="slab-floor-list" value={slab.floor ?? ""} placeholder="Ex.: Piso Superior" onChange={(event) => updateSlab(index, { floor: event.target.value || null })} /></div>
                      <div><label className="label">Área (m²)</label><input className="input input-sm" type="number" min="0.01" step="0.01" value={slab.areaM2 ?? ""} onChange={(event) => updateSlab(index, { areaM2: Number(event.target.value) })} /></div>
                      <div><label className="label">Espessura (cm)</label><input className="input input-sm" type="number" min="1" step="0.01" value={slab.thicknessCm} onChange={(event) => updateSlab(index, { thicknessCm: Number(event.target.value) })} /></div>
                      <div><label className="label">Classe do betão</label><input className="input input-sm" value={slab.concreteClass ?? ""} placeholder="B25" onChange={(event) => updateSlab(index, { concreteClass: event.target.value || null })} /></div>
                      <div><label className="label">Classe do aço</label><input className="input input-sm" value={slab.steelGrade ?? ""} placeholder="A400" onChange={(event) => updateSlab(index, { steelGrade: event.target.value || null })} /></div>
                      <div><label className="label">Recobrimento (cm)</label><input className="input input-sm" type="number" min="0" step="0.01" value={slab.coverCm ?? ""} onChange={(event) => updateSlab(index, { coverCm: event.target.value ? Number(event.target.value) : null })} /></div>
                    </div>
                    {(["bottomRebar", "topRebar"] as const).map((layerName) => {
                      const layer = slab[layerName] ?? { xDiameterMm: 0, xSpacingCm: 0, yDiameterMm: 0, ySpacingCm: 0 };
                      return (
                        <div key={layerName} className={`rounded-xl border p-3 ${layerName === "bottomRebar" ? "border-blue-200 bg-blue-50/40" : "border-amber-200 bg-amber-50/40"}`}>
                          <h4 className="mb-3 text-sm font-semibold text-slate-900">Armadura {layerName === "bottomRebar" ? "inferior" : "superior"}</h4>
                          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            <div><label className="label">Diâmetro X (mm)</label><input className="input input-sm" type="number" min="4" step="0.01" value={layer.xDiameterMm} onChange={(event) => updateSlabLayer(index, layerName, { xDiameterMm: Number(event.target.value) })} /></div>
                            <div><label className="label">Espaçamento X (cm)</label><input className="input input-sm" type="number" min="5" step="0.01" value={layer.xSpacingCm} onChange={(event) => updateSlabLayer(index, layerName, { xSpacingCm: Number(event.target.value) })} /></div>
                            <div><label className="label">Diâmetro Y (mm)</label><input className="input input-sm" type="number" min="4" step="0.01" value={layer.yDiameterMm} onChange={(event) => updateSlabLayer(index, layerName, { yDiameterMm: Number(event.target.value) })} /></div>
                            <div><label className="label">Espaçamento Y (cm)</label><input className="input input-sm" type="number" min="5" step="0.01" value={layer.ySpacingCm} onChange={(event) => updateSlabLayer(index, layerName, { ySpacingCm: Number(event.target.value) })} /></div>
                          </div>
                        </div>
                      );
                    })}
                    <div><label className="label">Observações</label><textarea className="input min-h-16 resize-y" value={slab.notes ?? ""} placeholder="Reforços locais, negativos, bordos, aberturas ou outras indicações" onChange={(event) => updateSlab(index, { notes: event.target.value || null })} /></div>
                  </div>
                </article>
              ))}
            </div>
          )}
          <div className="mt-5 flex flex-wrap justify-end gap-2"><button type="button" className="btn btn-secondary" onClick={() => setSlabManagerOpen(false)}>Cancelar</button><button type="button" className="btn btn-primary" disabled={savingSlabs || slabDrafts.length === 0} onClick={saveSlabs}>{savingSlabs ? "A guardar" : "Guardar lajes"}</button></div>
        </Modal>
      )}
      {openingManagerKind && (
        <Modal
          title={openingManagerKind === "janela" ? "Janelas" : "Portas"}
          subtitle="Cadastro organizado por piso"
          onClose={() => setOpeningManagerKind(null)}
          maxWidth="max-w-6xl"
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 px-4 py-3">
            <div><strong className="text-sm text-slate-900">{managedOpenings.reduce((sum, opening) => sum + opening.quantity, 0)} unidade(s)</strong><span className="ml-2 text-xs text-slate-500">{managedOpenings.length} modelo(s)</span></div>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => addOpening(openingManagerKind)}>+ Adicionar {openingManagerKind === "janela" ? "janela" : "porta"}</button>
          </div>

          {managedOpenings.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center"><p className="text-sm font-medium text-slate-700">Nenhuma {openingManagerKind === "janela" ? "janela" : "porta"} registada.</p><button type="button" className="btn btn-primary btn-sm mt-3" onClick={() => addOpening(openingManagerKind)}>Adicionar agora</button></div>
          ) : (
            <div className="space-y-4">
              {managedOpeningFloorNames.map((floor) => {
                const floorOpenings = managedOpenings.filter((opening) => (opening.floor ?? UNASSIGNED_FLOOR) === floor);
                return (
                  <article key={floor} className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50/70">
                    <header className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-100/80 px-4 py-3"><h3 className="font-semibold text-slate-900">{floor}</h3><span className="text-xs font-medium text-slate-600">{floorOpenings.reduce((sum, opening) => sum + opening.quantity, 0)} unidade(s)</span></header>
                    <div className="space-y-3 p-3">{floorOpenings.map((opening, openingIndex) => renderOpeningCard(opening, openingIndex, floorOpenings))}</div>
                  </article>
                );
              })}
            </div>
          )}
        </Modal>
      )}
      {materialEditorOpening && (
        <Modal
          title="Material da porta ou janela"
          subtitle={materialEditorOpening.designation || materialEditorOpening.code || (materialEditorOpening.kind === "porta" ? "Porta" : "Janela")}
          onClose={() => setMaterialEditorOpeningId(null)}
          maxWidth="max-w-2xl"
        >
          <div className="mb-4 grid grid-cols-2 rounded-lg bg-slate-100 p-1">
            <button type="button" className={`rounded-md px-3 py-2 text-sm font-semibold ${materialEditorMode === "existing" ? "bg-white text-brand-700 shadow-sm" : "text-slate-600"}`} onClick={() => setMaterialEditorMode("existing")}>Escolher do Catálogo</button>
            <button type="button" className={`rounded-md px-3 py-2 text-sm font-semibold ${materialEditorMode === "new" ? "bg-white text-brand-700 shadow-sm" : "text-slate-600"}`} onClick={() => setMaterialEditorMode("new")}>Criar novo material</button>
          </div>

          {materialEditorMode === "existing" ? (
            <div className="space-y-4">
              <div><label className="label">Pesquisar material</label><input type="search" className="input" value={materialSearch} placeholder="Nome ou categoria" onChange={(event) => setMaterialSearch(event.target.value)} /></div>
              <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border border-slate-200 p-2">
                {filteredOpeningMaterials.length === 0 ? <p className="px-3 py-5 text-center text-sm text-slate-500">Nenhum material encontrado.</p> : filteredOpeningMaterials.map((material) => (
                  <button key={material.id} type="button" className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-3 text-left ${selectedMaterialId === material.id ? "border-brand-500 bg-brand-50" : "border-slate-200 hover:border-slate-300"}`} onClick={() => { setSelectedMaterialId(material.id); setMaterialEditorPrice(String(material.effectiveUnitCost)); }}>
                    <span><strong className="block text-sm text-slate-900">{material.name}</strong><span className="text-xs text-slate-500">{material.category} · {material.unit}</span></span>
                    <span className="shrink-0 text-sm font-semibold text-slate-900">{material.effectiveUnitCost.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {material.currency}</span>
                  </button>
                ))}
              </div>
              <div><label className="label">Preço aplicado (MZN)</label><MoneyInput className="input" value={materialEditorPrice} onValueChange={setMaterialEditorPrice} /></div>
            </div>
          ) : (
            <div className="space-y-4">
              <div><label className="label">Nome do novo material</label><input className="input" value={newMaterialName} placeholder={materialEditorOpening.kind === "porta" ? "Ex.: Porta de madeira maciça 0,90 × 2,10 m" : "Ex.: Janela de alumínio e vidro 1,20 × 1,20 m"} onChange={(event) => setNewMaterialName(event.target.value)} /></div>
              <div><label className="label">Preço (MZN/{materialEditorOpening.kind === "porta" ? "un" : "m²"})</label><MoneyInput className="input" value={materialEditorPrice} onValueChange={setMaterialEditorPrice} /></div>
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">Antes de criar, pesquise no Catálogo. Materiais com o mesmo nome serão reutilizados, não duplicados.</p>
            </div>
          )}

          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => setMaterialEditorOpeningId(null)}>Cancelar</button>
            <button type="button" className="btn btn-primary" disabled={savingMaterial || (materialEditorMode === "existing" ? !selectedMaterialId : !newMaterialName.trim())} onClick={confirmOpeningMaterial}>{savingMaterial ? "A guardar" : materialEditorMode === "existing" ? "Associar material" : "Criar e associar"}</button>
          </div>
        </Modal>
      )}
      {dialog}
    </Layout>
  );
}

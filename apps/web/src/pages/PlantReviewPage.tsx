import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { plantsApi, type ExtractedOpening, type ExtractedRoom, type ExtractedRebarLine, type OpeningInput, type Plant, type SlabRebarLayer, type StructuralSlab } from "../api/plants";
import { boqApi } from "../api/boq";
import { catalogApi, type Material } from "../api/catalog";
import Layout from "../components/Layout";
import Modal from "../components/Modal";
import { IconBack, IconRefresh, IconRuler, IconTrash } from "../components/icons";
import { buildRebarPurchasePlan } from "@sigo/shared";

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
  const [plant, setPlant] = useState<Plant | null>(null);
  const [rooms, setRooms] = useState<ExtractedRoom[]>([]);
  const [openings, setOpenings] = useState<ExtractedOpening[]>([]);
  const [rebarSchedules, setRebarSchedules] = useState<ExtractedRebarLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savingRoomId, setSavingRoomId] = useState<string | null>(null);
  const [reprocessing, setReprocessing] = useState(false);
  const [preparingMeasurements, setPreparingMeasurements] = useState(false);
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

  async function handleContinueToMeasurements() {
    if (!plant) return;
    setPreparingMeasurements(true);
    setError(null);
    try {
      const { document } = await boqApi.prepareMeasurementWorkspace(plant.projectId);
      navigate(`/documentos/${document.id}?assistente=1`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível preparar as medições");
    } finally {
      setPreparingMeasurements(false);
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
    const emptyLayer: SlabRebarLayer = { xDiameterMm: 0, xSpacingCm: 0, yDiameterMm: 0, ySpacingCm: 0 };
    setSlabDrafts((plant?.structuralSummary?.slabs ?? []).map((slab) => ({
      ...slab,
      topRebar: slab.topRebar ? { ...slab.topRebar } : { ...emptyLayer },
      bottomRebar: slab.bottomRebar ? { ...slab.bottomRebar } : { ...emptyLayer },
    })));
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
    const area = Number(slab.areaM2 ?? 0);
    const layerWeight = (layer?: SlabRebarLayer | null) => layer && layer.xDiameterMm > 0 && layer.xSpacingCm > 0 && layer.yDiameterMm > 0 && layer.ySpacingCm > 0
      ? area * (((layer.xDiameterMm ** 2 / 162) / (layer.xSpacingCm / 100)) + ((layer.yDiameterMm ** 2 / 162) / (layer.ySpacingCm / 100)))
      : 0;
    return layerWeight(slab.topRebar) + layerWeight(slab.bottomRebar);
  }

  function slabBarPurchaseSummary(slab: StructuralSlab): string {
    const area = Number(slab.areaM2 ?? 0);
    const lengths = new Map<number, number>();
    for (const layer of [slab.bottomRebar, slab.topRebar]) {
      if (!layer) continue;
      if (layer.xDiameterMm > 0 && layer.xSpacingCm > 0) lengths.set(layer.xDiameterMm, (lengths.get(layer.xDiameterMm) ?? 0) + area / (layer.xSpacingCm / 100));
      if (layer.yDiameterMm > 0 && layer.ySpacingCm > 0) lengths.set(layer.yDiameterMm, (lengths.get(layer.yDiameterMm) ?? 0) + area / (layer.ySpacingCm / 100));
    }
    return [...lengths.entries()].sort(([a], [b]) => a - b).map(([diameter, length]) => `Ø${diameter}: ${Math.ceil((length * 1.05) / 5.75)} varões`).join(" · ");
  }

  async function saveSlabs() {
    if (!plant) return;
    const layerIsValid = (layer?: SlabRebarLayer | null) => Boolean(layer && layer.xDiameterMm > 0 && layer.xSpacingCm > 0 && layer.yDiameterMm > 0 && layer.ySpacingCm > 0);
    if (slabDrafts.some((slab) => !slab.name?.trim() || !slab.areaM2 || slab.areaM2 <= 0 || slab.thicknessCm <= 0 || !layerIsValid(slab.topRebar) || !layerIsValid(slab.bottomRebar))) {
      setError("Preencha nome, área, espessura e os diâmetros/espaçamentos das armaduras superior e inferior de cada laje.");
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
  const gaps: string[] = [];
  const detectedDisciplines = new Set(plant.documentAnalysis?.sections.map((section) => section.discipline));
  const hasArchitecture = detectedDisciplines.size > 0 ? detectedDisciplines.has("arquitectura") : plant.discipline === "arquitectura";
  const hasStructure = detectedDisciplines.size > 0 ? detectedDisciplines.has("estrutura") : plant.discipline === "estrutura";
  const structuralSummary = plant.structuralSummary ?? {
    footingsCount: 0, footingsAvgWidthCm: 0, footingsAvgLengthCm: 0, footingsAvgDepthCm: 0,
    columnsCount: 0, beamsCount: 0, beamsTotalLengthM: 0, beamsAvgWidthCm: 0, beamsAvgHeightCm: 0,
    beamsConcreteVolumeM3: 0, staircasesCount: 0, slabsCount: 0, slabsAvgThicknessCm: 0, slabs: [], totalSteelWeightKg: 0,
  };
  if (plant.processingStatus === "erro") {
    gaps.push(
      plant.errorMessage
        ? `Não foi possível processar este ficheiro: ${plant.errorMessage}.`
        : "Não foi possível processar este ficheiro."
    );
  } else {
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
          <a href={`/api/files/plants/${plant.id}`} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
            Ver PDF original
          </a>
          <button onClick={handleReprocess} disabled={reprocessing} className="btn btn-ghost btn-sm">
            <IconRefresh className="w-3.5 h-3.5" />
            {reprocessing ? `A reprocessar ${plant.processingProgress}%` : "Reprocessar"}
          </button>
          <Link to={`/projectos/${plant.projectId}`} className="btn btn-ghost btn-sm">
            <IconBack className="w-3.5 h-3.5" />
            Voltar ao projecto
          </Link>
        </div>
      }
    >
      <div className="mx-auto w-full max-w-4xl space-y-5">
        {error && <p className="text-sm text-red-600">{error}</p>}

        <section className="card overflow-hidden border-t-4 border-t-brand-600">
          <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">Análise concluída</p>
              <h2 className="mt-1 text-lg font-bold text-slate-900">Resumo da planta — confirme só se necessário</h2>
              <p className="mt-1 max-w-2xl text-sm text-slate-600">
                {rooms.length} compartimento(s) · {totalRoomsArea.toFixed(2)} m² · pode medir já ou corrigir pisos abaixo.
              </p>
            </div>
            <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={handleContinueToMeasurements}
              disabled={plant.processingStatus !== "concluido" || preparingMeasurements}
              className="btn btn-primary"
            >
              <IconRuler className="h-4 w-4" />
              {preparingMeasurements ? "A abrir..." : "Medir agora"}
            </button>
            <Link to={`/projectos/${plant.projectId}#plantas-do-projecto`} className="btn btn-secondary">Voltar ao projecto</Link>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3 text-xs text-slate-600">
            <span>Tem outra disciplina? Adicione-a antes ou depois; os dados serão combinados automaticamente.</span>
            <Link to={`/projectos/${plant.projectId}#plantas-do-projecto`} className="font-semibold text-brand-700 hover:underline">Adicionar outro projecto →</Link>
          </div>
        </section>

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
          <section className="card card-pad border-amber-200 bg-amber-50">
            <div className="flex items-center gap-2 mb-2">
              <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-amber-600 shrink-0">
                <path
                  d="M12 3.5 2 20h20L12 3.5Z M12 9.5v4.5 M12 17h.01"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <h2 className="section-title text-amber-900">O que não foi possível extrair automaticamente</h2>
            </div>
            <ul className="text-sm text-amber-900 space-y-1 list-disc pl-5">
              {gaps.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
            <p className="text-xs text-amber-700 mt-2">
              Estes pontos podem ser preenchidos à mão no Assistente de Medições ou directamente no Mapa de
              Quantidades — o resto da planta continua a ser usado normalmente.
            </p>
            <button
              type="button"
              onClick={handleContinueToMeasurements}
              disabled={preparingMeasurements}
              className="btn btn-secondary btn-sm mt-3"
            >
              <IconRuler className="h-3.5 w-3.5" />
              {preparingMeasurements ? "A preparar os campos..." : "Indicar dados manualmente"}
            </button>
          </section>
        )}

        {hasStructure && (
          <section className="card card-pad">
            <div className="flex items-center gap-2 mb-3">
              <IconRuler className="w-4 h-4 text-brand-700" />
              <h2 className="section-title">Resumo estrutural detectado</h2>
            </div>
            <div className="mb-3 grid grid-cols-2 gap-3 text-center sm:grid-cols-3 xl:grid-cols-5">
              <div className="rounded-lg border border-gray-200 p-3">
                <p className="text-xl font-semibold text-gray-900">{structuralSummary.footingsCount}</p>
                <p className="muted">
                  sapatas ·{" "}
                  {((structuralSummary.footingsAvgWidthCm / 100) * (structuralSummary.footingsAvgLengthCm / 100)).toFixed(2)}{" "}
                  m² méd.
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 p-3">
                <p className="text-xl font-semibold text-gray-900">{structuralSummary.columnsCount}</p>
                <p className="muted">pilares</p>
              </div>
              <div className="rounded-lg border border-gray-200 p-3">
                <p className="text-xl font-semibold text-gray-900">{structuralSummary.beamsCount}</p>
                <p className="muted">
                  vigas · {structuralSummary.beamsTotalLengthM.toFixed(2)} ml · {structuralSummary.beamsConcreteVolumeM3.toFixed(2)} m³
                </p>
              </div>
              <button type="button" className="rounded-lg border border-gray-200 p-3 transition-colors hover:border-brand-300 hover:bg-brand-50" onClick={openSlabManager}>
                <p className="text-xl font-semibold text-gray-900">{structuralSummary.slabsCount}</p>
                <p className="muted">laje(s) física(s) por nível</p>
                <span className="mt-1 block text-xs font-semibold text-brand-700">Indicar ou corrigir</span>
              </button>
              <div className="rounded-lg border border-gray-200 p-3">
                <p className="text-xl font-semibold text-gray-900">{structuralSummary.totalSteelWeightKg.toFixed(2)}</p>
                <p className="muted">kg de aço total</p>
              </div>
            </div>
            {structuralSummary.staircasesCount > 0 && (
              <p className="text-sm text-gray-600 mb-3">
                {structuralSummary.staircasesCount} escada(s) detectada(s) — o aço da(s) escada(s) já está incluído no
                total acima.
              </p>
            )}
            {(structuralSummary.slabs?.length ?? 0) > 0 && (
              <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {structuralSummary.slabs!.map((slab, index) => (
                  <div key={`${slab.floor ?? "laje"}-${slab.thicknessCm}-${index}`} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <strong className="block text-sm text-slate-900">{slab.name ?? slab.floor ?? `Laje ${index + 1}`}</strong>
                    <span className="text-xs text-slate-500">{slab.areaM2 ? `${slab.areaM2.toFixed(2)} m² · ` : ""}espessura {slab.thicknessCm.toFixed(2)} cm{slab.topRebar && slab.bottomRebar ? " · armadura superior e inferior" : ""}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-gray-500 mb-3">
              Estes números vêm do quadro de elementos de fundação, do quadro de pilares/vigas, das folhas de armadura
              de laje/cobertura por piso, do detalhe de escadas e do resumo de aço do projecto estrutural. Ao abrir o
              Assistente de Medições num Mapa de Quantidades deste projecto, o nº de sapatas, a área/profundidade
              média, o volume real de betão em vigas (comprimento × secção de cada vão), a espessura real da laje e o
              peso total de aço já vêm preenchidos automaticamente — não precisa de os medir à mão outra vez, e nenhum
              item novo é criado (só os itens-padrão de fundação/estrutura ficam mais precisos). O volume de betão em
              pilares continua a usar uma estimativa genérica — a secção de cada pilar não vem
              como um dado limpo neste tipo de ficheiro (só o desenho da cofragem, sem um valor de largura×altura
              isolado), pelo que não é seguro extraí-la automaticamente.
            </p>
          </section>
        )}

        {rooms.length > 0 && (
          <section className="card card-pad">
            <div className="flex items-center gap-2 mb-3">
              <IconRuler className="w-4 h-4 text-brand-700" />
              <h2 className="section-title">Compartimentos detectados ({rooms.length}) — confirme o piso de cada um</h2>
            </div>
            <p className="text-sm text-gray-600 mb-3">
              Área total: <span className="font-semibold text-gray-900">{totalRoomsArea.toFixed(2)} m²</span>, em{" "}
              {floorNames.length} piso(s) detectado(s). A detecção automática (pelo texto da folha) pode falhar em
              casos ambíguos — reveja e corrija o piso de qualquer compartimento antes de continuar. Cada piso vira um
              piso próprio no Assistente de Medições; nenhum item é criado por compartimento.
            </p>
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
                    <table className="w-full text-sm">
                      <tbody>
                        {floorRooms.map((r) => (
                          <tr key={r.id} className="table-row">
                            <td className="py-1.5 pl-3">{r.name}</td>
                            <td className="text-gray-400">{r.number}</td>
                            <td className="text-right tabular-nums">{Number(r.areaM2).toFixed(2)} m²</td>
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
                    </table>
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
              Peso total: <span className="font-semibold text-gray-900">{totalRebarWeight.toFixed(2)} kg</span>. Este
              total já está incluído no resumo estrutural acima. A lista de compra abaixo agrupa o mapa por diâmetro
              e converte o peso em varões comerciais de 5,75 m.
            </p>
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
      </div>
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
                    <div><strong className="text-sm text-slate-900">{slab.name || `Laje ${index + 1}`}</strong><span className="ml-2 text-xs text-slate-500">{(Number(slab.areaM2 ?? 0) * slab.thicknessCm / 100).toFixed(2)} m³ betão · {slabSteelWeight(slab).toFixed(2)} kg aço estimado</span>{slabBarPurchaseSummary(slab) && <span className="mt-1 block text-xs font-medium text-brand-700">Compra em barras de 5,75 m (+5%): {slabBarPurchaseSummary(slab)}</span>}</div>
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
              <div><label className="label">Preço aplicado (MZN)</label><input className="input" type="number" min="0" step="0.01" value={materialEditorPrice} onChange={(event) => setMaterialEditorPrice(event.target.value)} /></div>
            </div>
          ) : (
            <div className="space-y-4">
              <div><label className="label">Nome do novo material</label><input className="input" value={newMaterialName} placeholder={materialEditorOpening.kind === "porta" ? "Ex.: Porta de madeira maciça 0,90 × 2,10 m" : "Ex.: Janela de alumínio e vidro 1,20 × 1,20 m"} onChange={(event) => setNewMaterialName(event.target.value)} /></div>
              <div><label className="label">Preço (MZN/{materialEditorOpening.kind === "porta" ? "un" : "m²"})</label><input className="input" type="number" min="0" step="0.01" value={materialEditorPrice} onChange={(event) => setMaterialEditorPrice(event.target.value)} /></div>
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">Antes de criar, pesquise no Catálogo. Materiais com o mesmo nome serão reutilizados, não duplicados.</p>
            </div>
          )}

          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => setMaterialEditorOpeningId(null)}>Cancelar</button>
            <button type="button" className="btn btn-primary" disabled={savingMaterial || (materialEditorMode === "existing" ? !selectedMaterialId : !newMaterialName.trim())} onClick={confirmOpeningMaterial}>{savingMaterial ? "A guardar" : materialEditorMode === "existing" ? "Associar material" : "Criar e associar"}</button>
          </div>
        </Modal>
      )}
    </Layout>
  );
}

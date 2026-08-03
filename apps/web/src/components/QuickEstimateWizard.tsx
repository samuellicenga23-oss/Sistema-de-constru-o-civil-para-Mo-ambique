import { useEffect, useState } from "react";
import { catalogApi, type Material } from "../api/catalog";
import { quickEstimateApi, type FoundationType, type RoofType, type QuickEstimateResult, type SoilType } from "../api/quickEstimate";
import type { ExtractedOpening, ExtractedRoom, StructuralSummary } from "../api/plants";
import { IconBack, IconPlus, IconRuler, IconTrash } from "./icons";
import CalculationReportView from "./CalculationReportView";
import ModalPortal from "./ModalPortal";

type RoomForm = { key: string; name: string; type: "seco" | "humido"; length: string; width: string; perimeterM?: string; areaOnly?: boolean };
type FloorForm = { key: string; label?: string; ceilingHeight: string; perimeter: string; rooms: RoomForm[] };
type SlabForm = { key: string; label: string; areaM2: string; thicknessM: string; source: "planta" | "manual" };
type OpeningForm = { key: string; kind: "porta" | "janela"; code: string; widthM: string; heightM: string; quantity: string; location: "interior" | "exterior" | "desconhecida"; confirmed: boolean };

const UNASSIGNED_FLOOR = "Piso não identificado";

// Ordena os pisos por senso comum de construção: térreo primeiro, depois pisos numerados a
// subir, depois zonas especiais (anexo, cobertura), e por fim o que não foi identificado —
// mesmo critério usado no ecrã de confirmação da planta (PlantReviewPage).
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

let keySeq = 0;
function nextKey() {
  keySeq += 1;
  return `k${keySeq}`;
}

function newRoom(name = "", type: "seco" | "humido" = "seco"): RoomForm {
  return { key: nextKey(), name, type, length: "", width: "" };
}

// Compartimentos "húmidos" levam impermeabilização/revestimentos diferentes — classificação
// simples pelo nome, usada quando os compartimentos vêm de uma planta de arquitectura (que só
// dá a área, não o tipo).
function classifyRoomType(name: string): "seco" | "humido" {
  const n = name.toLowerCase();
  return /\bwc\b|casa de banho|banho|cozinha|lavandaria|duche|copa|sanit[aá]rio/.test(n) ? "humido" : "seco";
}

// Pré-visualização no ecrã do dimensionamento de fossa séptica/infiltração — mesma fórmula usada
// no motor de cálculo (apps/api/src/services/quickEstimate.ts), duplicada aqui só para dar
// feedback imediato antes de aplicar; o valor gravado vem sempre do cálculo no servidor.
function previewSepticTankVolumeM3(numberOfPeople: number, dailyFlowLPerPerson: number): { volumeM3: number; compartments: number } {
  const retentionDays = numberOfPeople <= 60 ? 3 : 2;
  const liquidVolume = dailyFlowLPerPerson * numberOfPeople * retentionDays;
  const digestedSludgeVolume = 0.11 * numberOfPeople * (365 - 60);
  const digestingSludgeVolume = (0.45 * numberOfPeople * 60) / 2;
  const totalVolumeL = Math.max(liquidVolume + digestedSludgeVolume + digestingSludgeVolume, 3000);
  return { volumeM3: totalVolumeL / 1000, compartments: numberOfPeople < 20 ? 2 : 3 };
}

const INFILTRATION_AREA_PER_PERSON_M2: Record<SoilType, number | null> = {
  areia_grossa: 1.5,
  areia_fina: 2.5,
  argila_arenosa: 5,
  argila_compacta: null,
};

const SOIL_TYPE_LABELS: Record<SoilType, string> = {
  areia_grossa: "Areia grossa / godo",
  areia_fina: "Areia fina",
  argila_arenosa: "Argila com elevado teor de areia",
  argila_compacta: "Argila compacta",
};

// A planta só dá a área — guarda-se num único campo (areaOnly) em vez de duplicar o valor
// em comprimento e largura iguais (√área), o que parecia “medição duplicada” no ecrã.
function roomsFromExtracted(rooms: ExtractedRoom[]): RoomForm[] {
  return rooms.map((r) => ({
    key: nextKey(),
    name: r.number ? `${r.name} (${r.number})` : r.name,
    type: classifyRoomType(r.name),
    length: Number(r.areaM2).toFixed(2),
    width: "",
    perimeterM: r.perimeterM ?? undefined,
    areaOnly: true,
  }));
}

function newFloor(): FloorForm {
  return {
    key: nextKey(),
    ceilingHeight: "2.8",
    perimeter: "",
    rooms: [newRoom("Sala"), newRoom("Quarto 1"), newRoom("Cozinha", "humido"), newRoom("WC 1", "humido")],
  };
}

function floorFromRooms(label: string | undefined, rooms: ExtractedRoom[]): FloorForm {
  const roomForms = roomsFromExtracted(rooms);
  const totalArea = roomForms.reduce((s, r) => s + Number(r.length), 0);
  return {
    key: nextKey(),
    label,
    ceilingHeight: "2.8",
    perimeter: (4 * Math.sqrt(totalArea)).toFixed(2),
    rooms: roomForms,
  };
}

// Um edifício com vários pisos (térreo, superior, anexo...) não pode entrar como um piso só —
// cada piso detectado na planta (já confirmado/corrigido pelo utilizador em PlantReviewPage)
// vira o seu próprio piso no Assistente, com o seu próprio perímetro e pé-direito a ajustar.
function floorsFromExtractedRooms(rooms: ExtractedRoom[]): FloorForm[] {
  const groups = new Map<string, ExtractedRoom[]>();
  for (const room of rooms) {
    const key = room.floor ?? UNASSIGNED_FLOOR;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(room);
  }
  const labels = Array.from(groups.keys()).sort((a, b) => floorSortKey(a) - floorSortKey(b));
  return labels.map((label) => floorFromRooms(label, groups.get(label)!));
}

function floorFormArea(floor: FloorForm): number {
  return floor.rooms.reduce((sum, room) => {
    if (room.areaOnly) return sum + (Number(room.length) || 0);
    return sum + (Number(room.length) || 0) * (Number(room.width) || 0);
  }, 0);
}

function initialSlabs(floors: FloorForm[], summary?: StructuralSummary | null): SlabForm[] {
  const detected = summary?.slabs ?? [];
  if (detected.length) {
    return detected.map((slab, index) => {
      const label = slab.floor ?? `Laje ${index + 1}`;
      const normalized = label.toLocaleLowerCase("pt");
      const matchingFloor = floors.find((floor) => {
        const floorLabel = (floor.label ?? "").toLocaleLowerCase("pt");
        return floorLabel && (floorLabel.includes(normalized) || normalized.includes(floorLabel));
      });
      const fallbackFloor = /cobertura/i.test(label) ? floors[floors.length - 1] : floors[Math.min(index, floors.length - 1)];
      return {
        key: nextKey(),
        label,
        areaM2: floorFormArea(matchingFloor ?? fallbackFloor).toFixed(2),
        thicknessM: (slab.thicknessCm / 100).toFixed(3),
        source: "planta",
      };
    });
  }
  const fallbackThickness = summary?.slabsAvgThicknessCm ? (summary.slabsAvgThicknessCm / 100).toFixed(3) : "";
  return floors.map((floor, index) => ({
    key: nextKey(),
    label: floor.label ? `Laje — ${floor.label}` : `Laje ${index + 1}`,
    areaM2: floorFormArea(floor).toFixed(2),
    thicknessM: fallbackThickness,
    source: summary?.slabsAvgThicknessCm ? "planta" : "manual",
  }));
}

const STEPS = ["Espaços", "Estrutura", "Confirmar"];

const FOUNDATION_LABELS: Record<FoundationType, string> = {
  sapata_isolada: "Sapata isolada",
  sapata_corrida: "Sapata corrida",
  laje: "Laje de fundação",
};
const ROOF_LABELS: Record<RoofType, string> = {
  laje_plana: "Laje plana (betão)",
  chapa_metalica: "Chapa metálica / cobertura leve",
};

type Props = {
  documentId: string;
  onClose: () => void;
  onApplied: () => void;
  structuralSummary?: StructuralSummary | null;
  structuralPlantName?: string | null;
  architectureRooms?: ExtractedRoom[] | null;
  architectureOpenings?: ExtractedOpening[] | null;
  architecturePlantName?: string | null;
  zoneId?: string | null;
  documentCurrency?: string;
};

export default function QuickEstimateWizard({
  documentId,
  onClose,
  onApplied,
  structuralSummary,
  structuralPlantName,
  architectureRooms,
  architectureOpenings,
  architecturePlantName,
  zoneId,
  documentCurrency = "MZN",
}: Props) {
  const hasStructuralFootings = !!structuralSummary && structuralSummary.footingsCount > 0;
  const hasArchitectureRooms = !!architectureRooms && architectureRooms.length > 0;
  const hasPlantData = hasArchitectureRooms || hasStructuralFootings;
  const [step, setStep] = useState(0);
  const [floors, setFloors] = useState<FloorForm[]>(
    hasArchitectureRooms ? floorsFromExtractedRooms(architectureRooms!) : [newFloor()]
  );
  // O projecto estrutural analisado descreve sempre sapatas isoladas — assume-se esse tipo
  // quando há dados importados, mas o utilizador pode mudar (o que faz cair para preenchimento manual).
  const [foundationType, setFoundationType] = useState<FoundationType>("sapata_isolada");
  const [useStructuralFooting, setUseStructuralFooting] = useState(hasStructuralFootings);
  const [foundationConfirmed, setFoundationConfirmed] = useState(hasStructuralFootings);
  const [footingCount, setFootingCount] = useState(
    hasStructuralFootings ? String(structuralSummary!.footingsCount) : "4"
  );
  const [footingAvgArea, setFootingAvgArea] = useState(
    hasStructuralFootings
      ? (((structuralSummary!.footingsAvgWidthCm / 100) * (structuralSummary!.footingsAvgLengthCm / 100)).toFixed(2))
      : "0.6"
  );
  const [footingAvgDepth, setFootingAvgDepth] = useState(
    hasStructuralFootings ? (structuralSummary!.footingsAvgDepthCm / 100).toFixed(2) : "0.8"
  );
  const [slabThickness, setSlabThickness] = useState("0.35");
  const [beamConcreteVolumeM3, setBeamConcreteVolumeM3] = useState(
    structuralSummary?.beamsConcreteVolumeM3 ? structuralSummary.beamsConcreteVolumeM3.toFixed(3) : ""
  );
  const [floorSlabs, setFloorSlabs] = useState<SlabForm[]>(() => initialSlabs(floors, structuralSummary));
  const [openings, setOpenings] = useState<OpeningForm[]>(() => (architectureOpenings ?? []).map((opening) => ({
    key: opening.id,
    kind: opening.kind,
    code: opening.code ?? "",
    widthM: opening.widthM ?? "",
    heightM: opening.heightM ?? "",
    quantity: String(opening.quantity),
    location: opening.location,
    confirmed: !opening.needsConfirmation,
  })));
  const [steelWeightKg, setSteelWeightKg] = useState(
    structuralSummary?.totalSteelWeightKg ? structuralSummary.totalSteelWeightKg.toFixed(2) : ""
  );
  const [concreteClass, setConcreteClass] = useState<"B20" | "B25" | "B30">("B25");
  const [roofType, setRoofType] = useState<RoofType>("laje_plana");
  const [roofArea, setRoofArea] = useState("");
  const [roofAreaTouched, setRoofAreaTouched] = useState(false);
  // Ajustes avançados: itens que por omissão usam sempre um rácio genérico (nenhuma planta dá
  // estes dados) — se o utilizador souber o valor real, substitui a estimativa. Vazio = manter
  // o rácio genérico.
  const [columnConcreteVolumeM3, setColumnConcreteVolumeM3] = useState("");
  const [formworkAreaM2, setFormworkAreaM2] = useState("");
  const [backfillEarthVolumeM3, setBackfillEarthVolumeM3] = useState("");
  const [sewerPipe110M, setSewerPipe110M] = useState("");
  const [sewerPipe40M, setSewerPipe40M] = useState("");
  const [downpipeLengthM, setDownpipeLengthM] = useState("");
  const [waterSupplyPipeM, setWaterSupplyPipeM] = useState("");
  const [toilets, setToilets] = useState("1");
  const [sinks, setSinks] = useState("1");
  const [showers, setShowers] = useState("1");
  const [kitchenSinks, setKitchenSinks] = useState("1");
  const [laundryTanks, setLaundryTanks] = useState("1");
  const [manholeCount, setManholeCount] = useState("1");
  const [hasWaterTank, setHasWaterTank] = useState(true);
  const [useSepticTank, setUseSepticTank] = useState(false);
  const [septicPeople, setSepticPeople] = useState("4");
  const [septicFlow, setSepticFlow] = useState("100");
  const [septicSoilType, setSepticSoilType] = useState<SoilType>("areia_fina");
  const [hydraulicInitialized, setHydraulicInitialized] = useState(false);
  const [criticalMaterials, setCriticalMaterials] = useState<Material[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QuickEstimateResult | null>(null);

  useEffect(() => {
    setCatalogLoading(true);
    catalogApi
      .listMaterials(zoneId ?? undefined)
      .then(setCriticalMaterials)
      .catch(() => setCriticalMaterials([]))
      .finally(() => setCatalogLoading(false));
  }, [zoneId]);

  const criticalCosts = [
    { key: "cement", label: "Cimento (saco 50kg)", material: criticalMaterials.find((m) => m.name === "Cimento (saco 50kg)") },
    { key: "steel", label: "Aço A400", material: criticalMaterials.find((m) => m.name === "Aço A400") },
    { key: "block", label: "Bloco de cimento 20x20x40", material: criticalMaterials.find((m) => m.name === "Bloco de cimento 20x20x40") },
  ].map((item) => ({
    ...item,
    price: item.material ? Number(item.material.zonePrice ?? item.material.baseUnitCost) : null,
    source: item.material?.zonePrice != null ? "Preço da zona do projecto" : "Preço base do catálogo",
  }));
  const criticalCostsReady = criticalCosts.every((item) => item.price != null && item.price > 0);

  // Área de cobertura sugerida a partir do último piso do corpo principal (+10% de beirado) —
  // ignora pisos "Anexo"/"Cobertura" nesta escolha (têm cobertura própria, normalmente mais
  // pequena, e não devem definir a cobertura do corpo principal do edifício); só enquanto o
  // utilizador não editar o campo manualmente.
  useEffect(() => {
    if (roofAreaTouched) return;
    const mainFloors = floors.filter((f) => !/anexo|cobertura/i.test(f.label ?? ""));
    const candidates = mainFloors.length > 0 ? mainFloors : floors;
    const topFloor = candidates[candidates.length - 1];
    const topFloorArea = topFloor.rooms.reduce((s, r) => s + roomArea(r), 0);
    if (topFloorArea > 0) setRoofArea((topFloorArea * 1.1).toFixed(2));
  }, [floors, roofAreaTouched]);

  // Sugere aparelhos sanitários e habitantes a partir dos compartimentos — uma vez, ao abrir.
  useEffect(() => {
    if (hydraulicInitialized) return;
    const wetCount = floors.reduce((s, f) => s + f.rooms.filter((r) => r.type === "humido").length, 0);
    const totalRooms = floors.reduce((s, f) => s + f.rooms.length, 0);
    const suggested = Math.max(1, wetCount);
    setToilets(String(suggested));
    setSinks(String(suggested));
    setShowers(String(suggested));
    setKitchenSinks(String(Math.max(1, floors.some((f) => f.rooms.some((r) => /cozinha/i.test(r.name))) ? 1 : 0)));
    setSepticPeople(String(Math.max(4, totalRooms * 2)));
    setHydraulicInitialized(true);
  }, [floors, hydraulicInitialized]);

  function updateFloor(key: string, patch: Partial<FloorForm>) {
    setFloors((fs) => fs.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  }
  function updateRoom(floorKey: string, roomKey: string, patch: Partial<RoomForm>) {
    setFloors((fs) =>
      fs.map((f) => (f.key !== floorKey ? f : { ...f, rooms: f.rooms.map((r) => (r.key === roomKey ? { ...r, ...patch } : r)) }))
    );
  }
  function addRoom(floorKey: string) {
    setFloors((fs) => fs.map((f) => (f.key === floorKey ? { ...f, rooms: [...f.rooms, newRoom()] } : f)));
  }
  function removeRoom(floorKey: string, roomKey: string) {
    setFloors((fs) => fs.map((f) => (f.key !== floorKey ? f : { ...f, rooms: f.rooms.filter((r) => r.key !== roomKey) })));
  }
  function addFloor() {
    const floor = newFloor();
    setFloors((fs) => [...fs, floor]);
    setFloorSlabs((slabs) => [...slabs, { key: nextKey(), label: `Laje ${slabs.length + 1}`, areaM2: "", thicknessM: "", source: "manual" }]);
  }
  function removeFloor(key: string) {
    setFloors((fs) => (fs.length > 1 ? fs.filter((f) => f.key !== key) : fs));
  }
  // Duplica um piso inteiro (pé-direito, perímetro e todos os compartimentos) para o fim da
  // lista — poupa reintroduzir os mesmos compartimentos à mão em edifícios com pisos repetidos
  // (ex: piso 1 igual ao piso 2/3). O novo piso fica editável desde logo, sem afectar o original.
  function duplicateFloor(key: string) {
    setFloors((fs) => {
      const source = fs.find((f) => f.key === key);
      if (!source) return fs;
      const copy: FloorForm = {
        key: nextKey(),
        label: undefined,
        ceilingHeight: source.ceilingHeight,
        perimeter: source.perimeter,
        rooms: source.rooms.map((r) => ({ ...r, key: nextKey() })),
      };
      return [...fs, copy];
    });
  }

  function updateSlab(key: string, patch: Partial<SlabForm>) {
    setFloorSlabs((slabs) => slabs.map((slab) => (slab.key === key ? { ...slab, ...patch, source: "manual" } : slab)));
  }

  function addSlab() {
    setFloorSlabs((slabs) => [...slabs, { key: nextKey(), label: `Laje ${slabs.length + 1}`, areaM2: "", thicknessM: "", source: "manual" }]);
  }

  function removeSlab(key: string) {
    setFloorSlabs((slabs) => slabs.filter((slab) => slab.key !== key));
  }

  function roomArea(room: RoomForm): number {
    if (room.areaOnly) return Number(room.length) || 0;
    return (Number(room.length) || 0) * (Number(room.width) || 0);
  }

  function roomDimensions(room: RoomForm): { length: number; width: number } {
    if (room.areaOnly) {
      const area = Number(room.length);
      if (!(area > 0)) return { length: 0, width: 0 };
      const side = Math.sqrt(area);
      return { length: side, width: side };
    }
    return { length: Number(room.length), width: Number(room.width) };
  }

  function expandRoomDimensions(floorKey: string, roomKey: string) {
    setFloors((fs) =>
      fs.map((f) => {
        if (f.key !== floorKey) return f;
        return {
          ...f,
          rooms: f.rooms.map((r) => {
            if (r.key !== roomKey || !r.areaOnly) return r;
            const { length, width } = roomDimensions(r);
            return { ...r, areaOnly: false, length: length.toFixed(2), width: width.toFixed(2) };
          }),
        };
      }),
    );
  }

  const step1Valid = floors.every(
    (f) =>
      Number(f.ceilingHeight) > 0 &&
      Number(f.perimeter) > 0 &&
      f.rooms.length > 0 &&
      f.rooms.every((r) => {
        if (!r.name.trim()) return false;
        if (r.areaOnly) return Number(r.length) > 0;
        return Number(r.length) > 0 && Number(r.width) > 0;
      })
  );

  const slabsValid = floorSlabs.length > 0 && floorSlabs.every((slab) => slab.label.trim() && Number(slab.areaM2) > 0 && Number(slab.thicknessM) > 0);
  const step2Valid =
    Number(roofArea) > 0 &&
    slabsValid &&
    (foundationType === "laje"
      ? Number(slabThickness) > 0
      : Number(footingCount) > 0 && Number(footingAvgArea) > 0 && Number(footingAvgDepth) > 0);

  const readinessChecks = [
    { label: "Compartimentos e áreas por piso", ready: step1Valid, impact: "Indique manualmente todos os compartimentos e dimensões.", targetStep: 0 },
    { label: "Perímetro exterior e pé-direito", ready: floors.every((f) => Number(f.perimeter) > 0 && Number(f.ceilingHeight) > 0), impact: "Necessário para paredes, rebocos, pintura e revestimentos.", targetStep: 0 },
    { label: "Sapatas e fundações", ready: foundationConfirmed && (foundationType === "laje" ? Number(slabThickness) > 0 : Number(footingCount) > 0 && Number(footingAvgArea) > 0 && Number(footingAvgDepth) > 0), impact: "Confirme quantidade, área e profundidade médias.", targetStep: 1 },
    { label: "Vigas estruturais", ready: Number(beamConcreteVolumeM3) > 0, impact: "Indique o volume de betão das vigas para evitar um rácio genérico.", targetStep: 1 },
    { label: "Lajes por nível", ready: slabsValid, impact: "Confirme a área e a espessura de cada laje.", targetStep: 1 },
    { label: "Mapa de aço", ready: Number(steelWeightKg) > 0, impact: "Indique o peso do mapa de aço para evitar estimativas por kg/m³.", targetStep: 1 },
    { label: "Redes hidráulicas", ready: true, impact: "Estimadas a partir dos compartimentos húmidos e perímetro — ajuste na confirmação se necessário.", targetStep: 2 },
    {
      label: "Custos críticos do catálogo",
      ready: criticalCostsReady,
      impact: "Cimento, aço e bloco — aviso na confirmação; não bloqueia a medição.",
      targetStep: 2,
    },
  ];
  const readyCount = readinessChecks.filter((item) => item.ready).length;
  const readinessPercent = Math.round((readyCount / readinessChecks.length) * 100);

  function canProceed() {
    if (step === 0) return step1Valid;
    if (step === 1) return step2Valid;
    return true;
  }

  async function handleApply() {
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        floors: floors.map((f) => ({
          label: f.label,
          ceilingHeight: Number(f.ceilingHeight),
          perimeter: Number(f.perimeter),
          rooms: f.rooms.map((r) => {
            const { length, width } = roomDimensions(r);
            return { name: r.name.trim(), type: r.type, length, width, perimeterM: Number(r.perimeterM) > 0 ? Number(r.perimeterM) : undefined };
          }),
        })),
        foundationType,
        ...(foundationType === "laje"
          ? { slabThickness: Number(slabThickness) }
          : { footing: { count: Number(footingCount), avgArea: Number(footingAvgArea), avgDepth: Number(footingAvgDepth) } }),
        concreteClass,
        roofType,
        roofArea: Number(roofArea),
        steelWeightKg: Number(steelWeightKg) > 0 ? Number(steelWeightKg) : undefined,
        beamConcreteVolumeM3: Number(beamConcreteVolumeM3) > 0 ? Number(beamConcreteVolumeM3) : undefined,
        floorSlabs: floorSlabs.map((slab) => ({
          label: slab.label.trim(),
          areaM2: Number(slab.areaM2),
          thicknessM: Number(slab.thicknessM),
        })),
        openings: openings
          .filter((opening) => Number(opening.widthM) > 0 && Number(opening.heightM) > 0 && Number(opening.quantity) > 0)
          .map((opening) => ({
            kind: opening.kind,
            widthM: Number(opening.widthM),
            heightM: Number(opening.heightM),
            quantity: Number(opening.quantity),
            location: opening.location,
            confirmed: opening.confirmed,
          })),
        columnConcreteVolumeM3: columnConcreteVolumeM3 ? Number(columnConcreteVolumeM3) : undefined,
        formworkAreaM2: formworkAreaM2 ? Number(formworkAreaM2) : undefined,
        backfillEarthVolumeM3: backfillEarthVolumeM3 ? Number(backfillEarthVolumeM3) : undefined,
        sewerPipe110M: sewerPipe110M ? Number(sewerPipe110M) : undefined,
        sewerPipe40M: sewerPipe40M ? Number(sewerPipe40M) : undefined,
        downpipeLengthM: downpipeLengthM ? Number(downpipeLengthM) : undefined,
        waterSupplyPipeM: waterSupplyPipeM ? Number(waterSupplyPipeM) : undefined,
        hydraulic: {
          toilets: Number(toilets) || 0,
          sinks: Number(sinks) || 0,
          showers: Number(showers) || 0,
          kitchenSinks: Number(kitchenSinks) || 0,
          laundryTanks: Number(laundryTanks) || 0,
          hasWaterTank,
          manholeCount: Number(manholeCount) || 0,
        },
        ...(useSepticTank
          ? {
              septicTank: {
                numberOfPeople: Number(septicPeople) || 1,
                dailyFlowLPerPerson: Number(septicFlow) || 100,
                soilType: septicSoilType,
              },
            }
          : {}),
      };
      const res = await quickEstimateApi.apply(documentId, payload);
      setResult(res);
      onApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao aplicar a estimativa");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 bg-gray-900/50 flex items-center justify-center p-4">
      <div className="card w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-slate-900 text-white">
          <div className="flex items-center gap-2">
            <IconRuler className="w-5 h-5" />
            <h2 className="font-semibold">Assistente de Medições</h2>
          </div>
          <button onClick={onClose} className="text-brand-200 hover:text-white text-sm">
            Fechar ✕
          </button>
        </div>

        {!result && (
          <div className="flex items-center gap-1 px-5 py-3 border-b border-gray-100 overflow-x-auto">
            {STEPS.map((label, i) => (
              <div key={label} className="flex items-center gap-1 shrink-0">
                <span
                  className={`w-5 h-5 rounded-full text-[11px] font-semibold flex items-center justify-center ${
                    i === step ? "bg-brand-700 text-white" : i < step ? "bg-brand-100 text-brand-700" : "bg-gray-100 text-gray-400"
                  }`}
                >
                  {i + 1}
                </span>
                <span className={`text-xs ${i === step ? "text-gray-900 font-medium" : "text-gray-400"}`}>{label}</span>
                {i < STEPS.length - 1 && <span className="w-4 h-px bg-gray-200 mx-1" />}
              </div>
            ))}
          </div>
        )}

        <div className="p-5 overflow-y-auto flex-1">
          {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

          {!result ? (
            <>
              {step === 0 && readinessPercent < 100 && (
                <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  <span className={`badge ${readinessPercent >= 75 ? "badge-green" : "badge-yellow"}`}>{readinessPercent}% prontidão</span>
                  <span>{readyCount} de {readinessChecks.length} grupos de dados confirmados — pode continuar; o relatório marca estimativas.</span>
                  {hasPlantData && <span className="text-brand-700">Dados da planta importados.</span>}
                </div>
              )}
              {step === 0 && (
                <div className="space-y-4">
                  <p className="text-sm text-gray-500">
                    Indique, por piso, o pé-direito, o perímetro exterior e a lista de compartimentos (nome, tipo e
                    dimensões). Compartimentos "húmidos" (WC, cozinha, lavandaria) levam impermeabilização e revestimentos
                    diferentes.
                  </p>
                  {hasArchitectureRooms && (
                    <div className="rounded-lg bg-brand-50 border border-brand-200 p-3 text-sm text-brand-900">
                      <p className="font-medium">
                        {architectureRooms!.length} compartimento(s) importado(s) da planta de arquitectura
                        {architecturePlantName ? ` (${architecturePlantName})` : ""}, em {floors.length} piso(s).
                      </p>
                      <p className="mt-1 text-brand-700">
                        A planta traz a área de cada compartimento — use o campo «Área (m²)» abaixo.
                        Se souber comprimento e largura reais, clique em «Dimensões» no compartimento.
                      </p>
                    </div>
                  )}
                  {floors.map((floor, fi) => (
                    <div key={floor.key} className="rounded-lg border border-gray-200 p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="section-title">{floor.label || `Piso ${fi + 1}`}</h3>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => duplicateFloor(floor.key)}
                            className="btn btn-ghost btn-sm"
                            title={`Duplicar para Piso ${floors.length + 1}`}
                          >
                            Duplicar para Piso {floors.length + 1}
                          </button>
                          {floors.length > 1 && (
                            <button onClick={() => removeFloor(floor.key)} className="icon-btn-danger">
                              <IconTrash className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="label">Pé-direito (m)</label>
                          <input
                            type="number"
                            step="0.05"
                            min="0"
                            value={floor.ceilingHeight}
                            onChange={(e) => updateFloor(floor.key, { ceilingHeight: e.target.value })}
                            className="input"
                          />
                        </div>
                        <div>
                          <label className="label">Perímetro exterior (m)</label>
                          <input
                            type="number"
                            step="0.1"
                            min="0"
                            value={floor.perimeter}
                            onChange={(e) => updateFloor(floor.key, { perimeter: e.target.value })}
                            className="input"
                            placeholder="ex: 40"
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        {floor.rooms.map((room) => (
                          <div key={room.key} className="space-y-1.5">
                            <div
                              className={
                                room.areaOnly
                                  ? "grid grid-cols-[1fr_6rem_6rem_auto] items-end gap-2 sm:grid-cols-[1fr_6rem_7rem_auto]"
                                  : "grid grid-cols-2 items-end gap-2 sm:grid-cols-[1fr_6rem_5rem_5rem_auto]"
                              }
                            >
                              <input
                                value={room.name}
                                onChange={(e) => updateRoom(floor.key, room.key, { name: e.target.value })}
                                className="input input-sm col-span-2 sm:col-span-1"
                                placeholder="Nome (ex: Quarto 1)"
                              />
                              <select
                                value={room.type}
                                onChange={(e) => updateRoom(floor.key, room.key, { type: e.target.value as "seco" | "humido" })}
                                className="input input-sm"
                              >
                                <option value="seco">Seco</option>
                                <option value="humido">Húmido</option>
                              </select>
                              {room.areaOnly ? (
                                <div>
                                  <label className="mb-0.5 block text-[10px] font-medium text-slate-500">Área (m²)</label>
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={room.length}
                                    onChange={(e) => updateRoom(floor.key, room.key, { length: e.target.value })}
                                    className="input input-sm"
                                  />
                                </div>
                              ) : (
                                <>
                                  <div>
                                    <label className="mb-0.5 block text-[10px] font-medium text-slate-500">Compr. (m)</label>
                                    <input
                                      type="number"
                                      step="0.1"
                                      min="0"
                                      value={room.length}
                                      onChange={(e) => updateRoom(floor.key, room.key, { length: e.target.value })}
                                      className="input input-sm"
                                    />
                                  </div>
                                  <div>
                                    <label className="mb-0.5 block text-[10px] font-medium text-slate-500">Larg. (m)</label>
                                    <input
                                      type="number"
                                      step="0.1"
                                      min="0"
                                      value={room.width}
                                      onChange={(e) => updateRoom(floor.key, room.key, { width: e.target.value })}
                                      className="input input-sm"
                                    />
                                  </div>
                                </>
                              )}
                              <button onClick={() => removeRoom(floor.key, room.key)} className="icon-btn-danger self-end">
                                <IconTrash className="w-4 h-4" />
                              </button>
                            </div>
                            {room.areaOnly && (
                              <button
                                type="button"
                                onClick={() => expandRoomDimensions(floor.key, room.key)}
                                className="text-[11px] font-medium text-brand-700 hover:text-brand-900"
                              >
                                Dimensões (compr. × larg.)
                              </button>
                            )}
                          </div>
                        ))}
                        <button onClick={() => addRoom(floor.key)} className="btn btn-ghost btn-sm">
                          <IconPlus className="w-3.5 h-3.5" />
                          Compartimento
                        </button>
                      </div>
                    </div>
                  ))}
                  <button onClick={addFloor} className="btn btn-secondary btn-sm">
                    <IconPlus className="w-3.5 h-3.5" />
                    Adicionar piso
                  </button>
                </div>
              )}

              {step === 1 && (
                <div className="max-w-2xl space-y-4">
                  <p className="text-sm text-gray-500">
                    Confirme os valores detectados ou substitua-os pelas quantidades do projectista. Os valores manuais
                    têm prioridade no cálculo e ficam registados no relatório da medição.
                  </p>

                  {structuralSummary && (
                    <div className="rounded-lg bg-brand-50 border border-brand-200 p-3 text-sm text-brand-900">
                      <p className="font-medium">
                        Planta estrutural importada{structuralPlantName ? ` (${structuralPlantName})` : ""}: {structuralSummary.footingsCount}{" "}
                        sapatas, {structuralSummary.columnsCount} pilares, {structuralSummary.beamsCount} vigas
                        {structuralSummary.slabsCount > 0 ? `, ${structuralSummary.slabsCount} folha(s) de laje` : ""}
                        {structuralSummary.staircasesCount > 0 ? ` e ${structuralSummary.staircasesCount} escada(s)` : ""} detectados.
                      </p>
                      {hasStructuralFootings && (
                        <p className="mt-1 text-brand-700">
                          Os dados de fundação abaixo já vêm preenchidos a partir da planta — não precisa de os medir à mão. Os
                          volumes de betão em vigas e em lajes também já usam dados reais (comprimento/secção das vigas,
                          espessura real da laje), em vez de estimativas genéricas.
                        </p>
                      )}
                    </div>
                  )}

                  <section className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-900">Quantidades estruturais confirmadas</h3>
                        <p className="mt-0.5 text-xs text-slate-500">Altere qualquer valor que não corresponda ao projecto executivo.</p>
                      </div>
                      <span className="badge badge-gray">Valor manual prevalece</span>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="label" htmlFor="measurement-beam-concrete">Betão em vigas (m³)</label>
                        <input
                          id="measurement-beam-concrete"
                          type="number"
                          step="0.001"
                          min="0"
                          value={beamConcreteVolumeM3}
                          onChange={(event) => setBeamConcreteVolumeM3(event.target.value)}
                          className="input"
                          placeholder="Ex.: 12,450"
                        />
                        <p className="mt-1 text-[11px] text-slate-500">{structuralSummary?.beamsConcreteVolumeM3 ? "Preenchido pela planta; editável." : "Indique o volume do mapa estrutural."}</p>
                      </div>
                      <div>
                        <label className="label" htmlFor="measurement-steel-weight">Peso total de aço (kg)</label>
                        <input
                          id="measurement-steel-weight"
                          type="number"
                          step="0.01"
                          min="0"
                          value={steelWeightKg}
                          onChange={(event) => setSteelWeightKg(event.target.value)}
                          className="input"
                          placeholder="Ex.: 8450,00"
                        />
                        <p className="mt-1 text-[11px] text-slate-500">{structuralSummary?.totalSteelWeightKg ? "Preenchido pelo mapa de aço; editável." : "Indique o total do mapa de aço."}</p>
                      </div>
                    </div>
                    <div className="mt-4 border-t border-slate-200 pt-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <h4 className="text-sm font-semibold text-slate-900">Lajes por nível</h4>
                          <p className="text-xs text-slate-500">Área × espessura de cada laje, sem médias entre pisos.</p>
                        </div>
                        <button type="button" onClick={addSlab} className="btn btn-secondary btn-sm"><IconPlus className="h-3.5 w-3.5" />Adicionar laje</button>
                      </div>
                      <div className="space-y-2">
                        {floorSlabs.map((slab, index) => (
                          <div key={slab.key} className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[minmax(150px,1fr)_120px_120px_40px] sm:items-end">
                            <div>
                              <label className="label" htmlFor={`slab-label-${slab.key}`}>Nível</label>
                              <input id={`slab-label-${slab.key}`} className="input" value={slab.label} onChange={(event) => updateSlab(slab.key, { label: event.target.value })} />
                            </div>
                            <div>
                              <label className="label" htmlFor={`slab-area-${slab.key}`}>Área (m²)</label>
                              <input id={`slab-area-${slab.key}`} aria-label={`Área da ${slab.label || `laje ${index + 1}`} (m²)`} className="input" type="number" min="0" step="0.01" value={slab.areaM2} onChange={(event) => updateSlab(slab.key, { areaM2: event.target.value })} />
                            </div>
                            <div>
                              <label className="label" htmlFor={`slab-thickness-${slab.key}`}>Espessura (m)</label>
                              <input id={`slab-thickness-${slab.key}`} aria-label={`Espessura da ${slab.label || `laje ${index + 1}`} (m)`} className="input" type="number" min="0" step="0.001" value={slab.thicknessM} onChange={(event) => updateSlab(slab.key, { thicknessM: event.target.value })} />
                            </div>
                            <button type="button" onClick={() => removeSlab(slab.key)} className="btn-icon h-10 w-10" aria-label={`Remover ${slab.label || `laje ${index + 1}`}`}><IconTrash className="h-4 w-4" /></button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </section>

                  <div>
                    <label className="label">Tipo de fundação</label>
                    <select
                      value={foundationType}
                      onChange={(e) => { setFoundationType(e.target.value as FoundationType); setFoundationConfirmed(true); }}
                      className="input"
                    >
                      {(Object.keys(FOUNDATION_LABELS) as FoundationType[]).map((k) => (
                        <option key={k} value={k}>
                          {FOUNDATION_LABELS[k]}
                        </option>
                      ))}
                    </select>
                  </div>

                  {foundationType === "laje" ? (
                    <div>
                      <label className="label">Espessura da laje de fundação (m)</label>
                      <input
                        type="number"
                        step="0.05"
                        min="0"
                        value={slabThickness}
                        onChange={(e) => { setSlabThickness(e.target.value); setFoundationConfirmed(true); }}
                        className="input"
                      />
                    </div>
                  ) : hasStructuralFootings && useStructuralFooting ? (
                    <div className="rounded-lg border border-gray-200 p-3 text-sm">
                      <div className="grid grid-cols-3 gap-3 text-center">
                        <div>
                          <p className="text-lg font-semibold text-gray-900">{footingCount}</p>
                          <p className="muted">sapatas</p>
                        </div>
                        <div>
                          <p className="text-lg font-semibold text-gray-900">{footingAvgArea} m²</p>
                          <p className="muted">área média</p>
                        </div>
                        <div>
                          <p className="text-lg font-semibold text-gray-900">{footingAvgDepth} m</p>
                          <p className="muted">profundidade média</p>
                        </div>
                      </div>
                      <button onClick={() => { setUseStructuralFooting(false); setFoundationConfirmed(false); }} className="btn btn-ghost btn-sm mt-2">
                        Prefiro inserir manualmente
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-3">
                      {hasStructuralFootings && (
                        <div className="col-span-3">
                          <button onClick={() => { setUseStructuralFooting(true); setFoundationConfirmed(true); }} className="btn btn-ghost btn-sm">
                            Usar os dados da planta estrutural
                          </button>
                        </div>
                      )}
                      <div>
                        <label className="label">Nº de sapatas</label>
                        <input
                          type="number"
                          step="1"
                          min="1"
                          value={footingCount}
                          onChange={(e) => { setFootingCount(e.target.value); setFoundationConfirmed(true); }}
                          className="input"
                        />
                      </div>
                      <div>
                        <label className="label">Área média (m²)</label>
                        <input
                          type="number"
                          step="0.05"
                          min="0"
                          value={footingAvgArea}
                          onChange={(e) => { setFootingAvgArea(e.target.value); setFoundationConfirmed(true); }}
                          className="input"
                        />
                      </div>
                      <div>
                        <label className="label">Profundidade média (m)</label>
                        <input
                          type="number"
                          step="0.05"
                          min="0"
                          value={footingAvgDepth}
                          onChange={(e) => { setFootingAvgDepth(e.target.value); setFoundationConfirmed(true); }}
                          className="input"
                        />
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="label">Classe do betão</label>
                    <select value={concreteClass} onChange={(e) => setConcreteClass(e.target.value as "B20" | "B25" | "B30")} className="input">
                      <option value="B20">B20</option>
                      <option value="B25">B25</option>
                      <option value="B30">B30</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">Tipo de cobertura</label>
                    <select value={roofType} onChange={(e) => setRoofType(e.target.value as RoofType)} className="input">
                      {(Object.keys(ROOF_LABELS) as RoofType[]).map((k) => (
                        <option key={k} value={k}>
                          {ROOF_LABELS[k]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">Área de cobertura (m²) — sugerida automaticamente, pode ajustar</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      value={roofArea}
                      onChange={(e) => {
                        setRoofArea(e.target.value);
                        setRoofAreaTouched(true);
                      }}
                      className="input"
                    />
                  </div>

                  <details className="rounded-lg border border-gray-200 p-3">
                    <summary className="text-sm font-medium text-gray-700 cursor-pointer">
                      Ajustes avançados (opcional) — insira um valor real em vez da estimativa genérica
                    </summary>
                    <p className="text-xs text-gray-500 mt-2 mb-3">
                      Estes itens não vêm de nenhuma planta importada — por omissão usam sempre um rácio genérico de
                      mercado. Se souber o valor real para este edifício, indique-o aqui; deixe em branco para manter o
                      rácio genérico.
                    </p>
                    <div className="grid grid-cols-1 gap-3">
                      <div>
                        <label className="label">Volume de betão em pilares (m³)</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={columnConcreteVolumeM3}
                          onChange={(e) => setColumnConcreteVolumeM3(e.target.value)}
                          className="input"
                        />
                      </div>
                      <div>
                        <label className="label">Área de cofragem (m²)</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={formworkAreaM2}
                          onChange={(e) => setFormworkAreaM2(e.target.value)}
                          className="input"
                        />
                      </div>
                      <div>
                        <label className="label">Volume de aterro com terras de empréstimo (m³)</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={backfillEarthVolumeM3}
                          onChange={(e) => setBackfillEarthVolumeM3(e.target.value)}
                          className="input"
                        />
                      </div>
                    </div>
                  </details>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-4 text-sm">
                  <p className="text-gray-500">Confirme os dados e ajuste instalações sanitárias se necessário. Tubagens são estimadas automaticamente pelo motor de cálculo.</p>
                  {floors.map((f, i) => (
                    <div key={f.key} className="rounded-lg border border-gray-200 p-3">
                      <p className="font-medium text-gray-900 mb-1">
                        {f.label || `Piso ${i + 1}`} — pé-direito {f.ceilingHeight} m, perímetro {f.perimeter} m
                      </p>
                      <p className="text-gray-500 text-xs">
                        {f.rooms.map((r) => {
                          const dims = roomDimensions(r);
                          const area = roomArea(r);
                          return r.areaOnly
                            ? `${r.name} (${r.type}, ${area.toFixed(2)} m²)`
                            : `${r.name} (${r.type}, ${dims.length}×${dims.width} m)`;
                        }).join(" · ")}
                      </p>
                    </div>
                  ))}
                  <div className="rounded-lg border border-gray-200 p-3 text-gray-500">
                    Fundação: <span className="text-gray-900">{FOUNDATION_LABELS[foundationType]}</span>
                    {foundationType === "laje" ? (
                      <span className="text-gray-900"> (espessura {slabThickness} m)</span>
                    ) : (
                      <span className="text-gray-900"> ({footingCount} sapatas × {footingAvgArea} m² × {footingAvgDepth} m)</span>
                    )}
                    {" · Betão: "}<span className="text-gray-900">{concreteClass}</span>
                    {" · Cobertura: "}<span className="text-gray-900">{ROOF_LABELS[roofType]} ({roofArea} m²)</span>
                  </div>

                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div><p className="font-semibold text-slate-900">Portas e janelas</p><p className="text-xs text-slate-500">Só os vãos confirmados e localizados são descontados das paredes.</p></div>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpenings((items) => [...items, { key: nextKey(), kind: "janela", code: "", widthM: "", heightM: "", quantity: "1", location: "exterior", confirmed: true }])}><IconPlus className="h-3.5 w-3.5" />Adicionar</button>
                    </div>
                    {openings.length === 0 ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Nenhum vão confirmado. Adicione portas e janelas para obter áreas líquidas.</p> : (
                      <div className="space-y-2">
                        {openings.map((opening) => (
                          <div key={opening.key} className="grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-[100px_90px_90px_80px_130px_110px_40px] sm:items-end">
                            <div><label className="label">Tipo</label><select className="input" value={opening.kind} onChange={(event) => setOpenings((items) => items.map((item) => item.key === opening.key ? { ...item, kind: event.target.value as OpeningForm["kind"] } : item))}><option value="porta">Porta</option><option value="janela">Janela</option></select></div>
                            <div><label className="label">Largura</label><input className="input" type="number" min="0" step="0.01" value={opening.widthM} onChange={(event) => setOpenings((items) => items.map((item) => item.key === opening.key ? { ...item, widthM: event.target.value } : item))} /></div>
                            <div><label className="label">Altura</label><input className="input" type="number" min="0" step="0.01" value={opening.heightM} onChange={(event) => setOpenings((items) => items.map((item) => item.key === opening.key ? { ...item, heightM: event.target.value } : item))} /></div>
                            <div><label className="label">Qtd.</label><input className="input" type="number" min="1" step="1" value={opening.quantity} onChange={(event) => setOpenings((items) => items.map((item) => item.key === opening.key ? { ...item, quantity: event.target.value } : item))} /></div>
                            <div><label className="label">Parede</label><select className="input" value={opening.location} onChange={(event) => setOpenings((items) => items.map((item) => item.key === opening.key ? { ...item, location: event.target.value as OpeningForm["location"] } : item))}><option value="desconhecida">Por definir</option><option value="interior">Interior</option><option value="exterior">Exterior</option></select></div>
                            <label className="flex h-10 items-center gap-2 text-xs font-medium text-slate-700"><input type="checkbox" checked={opening.confirmed} onChange={(event) => setOpenings((items) => items.map((item) => item.key === opening.key ? { ...item, confirmed: event.target.checked } : item))} />Confirmado</label>
                            <button type="button" className="btn-icon h-10 w-10" aria-label="Remover vão" onClick={() => setOpenings((items) => items.filter((item) => item.key !== opening.key))}><IconTrash className="h-4 w-4" /></button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl border border-slate-200 p-4">
                    <p className="text-sm font-semibold text-slate-900 mb-3">Instalações sanitárias</p>
                    <div className="grid grid-cols-2 gap-3 max-w-md">
                    <div>
                      <label className="label">Sanitas</label>
                      <input type="number" step="1" min="0" value={toilets} onChange={(e) => setToilets(e.target.value)} className="input" />
                    </div>
                    <div>
                      <label className="label">Lavatórios</label>
                      <input type="number" step="1" min="0" value={sinks} onChange={(e) => setSinks(e.target.value)} className="input" />
                    </div>
                    <div>
                      <label className="label">Chuveiros</label>
                      <input type="number" step="1" min="0" value={showers} onChange={(e) => setShowers(e.target.value)} className="input" />
                    </div>
                    <div>
                      <label className="label">Pias de cozinha</label>
                      <input
                        type="number"
                        step="1"
                        min="0"
                        value={kitchenSinks}
                        onChange={(e) => setKitchenSinks(e.target.value)}
                        className="input"
                      />
                    </div>
                    <div>
                      <label className="label">Tanques de lavandaria</label>
                      <input
                        type="number"
                        step="1"
                        min="0"
                        value={laundryTanks}
                        onChange={(e) => setLaundryTanks(e.target.value)}
                        className="input"
                      />
                    </div>
                    <div>
                      <label className="label">Caixas de visita/inspecção (esgotos)</label>
                      <input
                        type="number"
                        step="1"
                        min="0"
                        value={manholeCount}
                        onChange={(e) => setManholeCount(e.target.value)}
                        className="input"
                      />
                    </div>
                  </div>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input type="checkbox" checked={hasWaterTank} onChange={(e) => setHasWaterTank(e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-brand-700 focus:ring-brand-500" />
                    Prever reservatório de água
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input type="checkbox" checked={useSepticTank} onChange={(e) => setUseSepticTank(e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-brand-700 focus:ring-brand-500" />
                    Fossa séptica (sem rede pública)
                  </label>
                  {useSepticTank && (
                    <div className="grid grid-cols-2 gap-3 max-w-md">
                      <div>
                        <label className="label">Habitantes</label>
                        <input type="number" step="1" min="1" value={septicPeople} onChange={(e) => setSepticPeople(e.target.value)} className="input" />
                      </div>
                      <div>
                        <label className="label">Capitação (L/pessoa/dia)</label>
                        <select value={septicFlow} onChange={(e) => setSepticFlow(e.target.value)} className="input">
                          <option value="20">20 — sem canalização</option>
                          <option value="60">60 — torneira exterior</option>
                          <option value="100">100 — canalização interior</option>
                        </select>
                      </div>
                    </div>
                  )}

                  <details className="rounded-lg border border-gray-200 p-3">
                    <summary className="cursor-pointer text-sm font-medium text-gray-700">Tubagens — valores reais (opcional)</summary>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <div><label className="label">Esgoto Ø110 (ml)</label><input type="number" step="0.1" min="0" value={sewerPipe110M} onChange={(e) => setSewerPipe110M(e.target.value)} className="input" placeholder="Auto" /></div>
                      <div><label className="label">Esgoto Ø40 (ml)</label><input type="number" step="0.1" min="0" value={sewerPipe40M} onChange={(e) => setSewerPipe40M(e.target.value)} className="input" placeholder="Auto" /></div>
                    </div>
                  </details>

                  {!catalogLoading && !criticalCostsReady && (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      Alguns custos do catálogo estão em falta — a medição calcula quantidades; actualize preços antes de orçamentar.
                    </p>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg bg-green-50 border border-green-200 p-4">
                <p className="font-medium text-green-800">{result!.itemsUpdated} itens preenchidos automaticamente.</p>
                <p className="text-sm text-green-700 mt-1">Quantidades marcadas como estimativa — ajuste na régua de medições.</p>
              </div>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div className="card card-pad !p-3"><dt className="muted">Área construída</dt><dd className="font-semibold">{result!.summary.totalBuiltArea.toFixed(2)} m²</dd></div>
                <div className="card card-pad !p-3"><dt className="muted">Betão estrutural</dt><dd className="font-semibold">{result!.summary.concreteVolume.toFixed(2)} m³</dd></div>
                <div className="card card-pad !p-3"><dt className="muted">Aço</dt><dd className="font-semibold">{result!.summary.steelWeight.toFixed(0)} kg</dd></div>
                <div className="card card-pad !p-3"><dt className="muted">Aparelhos sanitários</dt><dd className="font-semibold">{result!.summary.totalFixtures}</dd></div>
              </dl>
              <CalculationReportView entries={result!.report} />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-5 py-4 border-t border-gray-100">
          {result ? (
            <>
              <span />
              <button onClick={onClose} className="btn btn-primary">Ver Mapa de Quantidades</button>
            </>
          ) : (
            <>
              <button onClick={() => (step === 0 ? onClose() : setStep((s) => s - 1))} className="btn btn-ghost">
                <IconBack className="w-3.5 h-3.5" />
                {step === 0 ? "Cancelar" : "Voltar"}
              </button>
              {step < STEPS.length - 1 ? (
                <button onClick={() => canProceed() && setStep((s) => s + 1)} disabled={!canProceed()} className="btn btn-primary">Seguinte</button>
              ) : (
                <button onClick={handleApply} disabled={submitting} className="btn btn-primary">
                  <IconRuler className="w-4 h-4" />
                  {submitting ? "A calcular..." : "Calcular quantidades"}
                </button>
              )}
            </>
          )}
        </div>
      </div>
      </div>
    </ModalPortal>
  );
}

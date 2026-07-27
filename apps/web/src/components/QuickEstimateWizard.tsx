import { useEffect, useState } from "react";
import { catalogApi } from "../api/catalog";
import { quickEstimateApi, type FoundationType, type RoofType, type QuickEstimateResult, type SoilType } from "../api/quickEstimate";
import type { StructuralSummary } from "../api/plants";
import type { ExtractedRoom } from "../api/plants";
import { IconBack, IconPlus, IconTrash, IconWand } from "./icons";
import CalculationReportView from "./CalculationReportView";

type RoomForm = { key: string; name: string; type: "seco" | "humido"; length: string; width: string };
type FloorForm = { key: string; label?: string; ceilingHeight: string; perimeter: string; rooms: RoomForm[] };

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

// A planta de arquitectura só dá a área de cada compartimento, não o comprimento/largura —
// aproxima-se como quadrado (lado = √área) só para o cálculo de perímetro de paredes; o
// utilizador pode corrigir para as dimensões reais em qualquer compartimento.
function roomsFromExtracted(rooms: ExtractedRoom[]): RoomForm[] {
  return rooms.map((r) => {
    const area = Number(r.areaM2);
    const side = Math.sqrt(area);
    return {
      key: nextKey(),
      name: r.number ? `${r.name} (${r.number})` : r.name,
      type: classifyRoomType(r.name),
      length: side.toFixed(2),
      width: side.toFixed(2),
    };
  });
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
  const totalArea = roomForms.reduce((s, r) => s + Number(r.length) * Number(r.width), 0);
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

const STEPS = ["Pisos e Compartimentos", "Estrutura", "Hidráulica", "Preços", "Revisão"];

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
  architecturePlantName?: string | null;
};

export default function QuickEstimateWizard({
  documentId,
  onClose,
  onApplied,
  structuralSummary,
  structuralPlantName,
  architectureRooms,
  architecturePlantName,
}: Props) {
  const hasStructuralFootings = !!structuralSummary && structuralSummary.footingsCount > 0;
  const hasArchitectureRooms = !!architectureRooms && architectureRooms.length > 0;
  const [step, setStep] = useState(0);
  const [readinessAccepted, setReadinessAccepted] = useState(false);
  const [floors, setFloors] = useState<FloorForm[]>(
    hasArchitectureRooms ? floorsFromExtractedRooms(architectureRooms!) : [newFloor()]
  );
  // O projecto estrutural analisado descreve sempre sapatas isoladas — assume-se esse tipo
  // quando há dados importados, mas o utilizador pode mudar (o que faz cair para preenchimento manual).
  const [foundationType, setFoundationType] = useState<FoundationType>("sapata_isolada");
  const [useStructuralFooting, setUseStructuralFooting] = useState(hasStructuralFootings);
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
  const [cementPrice, setCementPrice] = useState("");
  const [steelPrice, setSteelPrice] = useState("");
  const [blockPrice, setBlockPrice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QuickEstimateResult | null>(null);

  useEffect(() => {
    catalogApi
      .listMaterials()
      .then((materials) => {
        const cement = materials.find((m) => m.name === "Cimento (saco 50kg)");
        const steel = materials.find((m) => m.name === "Aço A400");
        const block = materials.find((m) => m.name === "Bloco de cimento 20x20x40");
        if (cement) setCementPrice(Number(cement.baseUnitCost).toString());
        if (steel) setSteelPrice(Number(steel.baseUnitCost).toString());
        if (block) setBlockPrice(Number(block.baseUnitCost).toString());
      })
      .catch(() => {});
  }, []);

  // Área de cobertura sugerida a partir do último piso do corpo principal (+10% de beirado) —
  // ignora pisos "Anexo"/"Cobertura" nesta escolha (têm cobertura própria, normalmente mais
  // pequena, e não devem definir a cobertura do corpo principal do edifício); só enquanto o
  // utilizador não editar o campo manualmente.
  useEffect(() => {
    if (roofAreaTouched) return;
    const mainFloors = floors.filter((f) => !/anexo|cobertura/i.test(f.label ?? ""));
    const candidates = mainFloors.length > 0 ? mainFloors : floors;
    const topFloor = candidates[candidates.length - 1];
    const topFloorArea = topFloor.rooms.reduce((s, r) => s + (Number(r.length) || 0) * (Number(r.width) || 0), 0);
    if (topFloorArea > 0) setRoofArea((topFloorArea * 1.1).toFixed(2));
  }, [floors, roofAreaTouched]);

  // Nº de aparelhos sanitários sugerido a partir dos compartimentos húmidos do Passo 1 —
  // só a primeira vez que se entra no passo de Hidráulica, para não sobrepor edições depois.
  useEffect(() => {
    if (step !== 2 || hydraulicInitialized) return;
    const wetCount = floors.reduce((s, f) => s + f.rooms.filter((r) => r.type === "humido").length, 0);
    const suggested = Math.max(1, wetCount);
    setToilets(String(suggested));
    setSinks(String(suggested));
    setShowers(String(suggested));
    setHydraulicInitialized(true);
  }, [step, hydraulicInitialized, floors]);

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
    setFloors((fs) => [...fs, newFloor()]);
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

  const step1Valid = floors.every(
    (f) =>
      Number(f.ceilingHeight) > 0 &&
      Number(f.perimeter) > 0 &&
      f.rooms.length > 0 &&
      f.rooms.every((r) => r.name.trim().length > 0 && Number(r.length) > 0 && Number(r.width) > 0)
  );

  const step2Valid =
    Number(roofArea) > 0 &&
    (foundationType === "laje"
      ? Number(slabThickness) > 0
      : Number(footingCount) > 0 && Number(footingAvgArea) > 0 && Number(footingAvgDepth) > 0);

  const readinessChecks = [
    { label: "Compartimentos e áreas por piso", ready: hasArchitectureRooms, impact: "Sem planta de arquitectura, indique manualmente todos os compartimentos e dimensões." },
    { label: "Perímetro exterior e pé-direito", ready: floors.every((f) => Number(f.perimeter) > 0 && Number(f.ceilingHeight) > 0), impact: "Necessário para paredes, rebocos, pintura e revestimentos." },
    { label: "Sapatas e fundações", ready: hasStructuralFootings, impact: "Sem planta estrutural, confirme quantidade, área e profundidade médias." },
    { label: "Vigas estruturais", ready: Boolean(structuralSummary?.beamsConcreteVolumeM3), impact: "Sem volume real, o sistema usará um rácio genérico de betão." },
    { label: "Lajes e espessuras", ready: Boolean(structuralSummary?.slabsAvgThicknessCm), impact: "Sem espessura real, o volume das lajes será estimado." },
    { label: "Mapa de aço", ready: Boolean(structuralSummary?.totalSteelWeightKg), impact: "Sem quadro de armaduras, o peso será calculado por kg/m³ de betão." },
    { label: "Redes hidráulicas e sanitárias", ready: Boolean(sewerPipe110M || sewerPipe40M || waterSupplyPipeM), impact: "Confirme comprimentos de tubagem; contagens de aparelhos não definem o traçado real." },
    { label: "Preços críticos da obra", ready: Boolean(cementPrice && steelPrice && blockPrice), impact: "Sem confirmação, permanecem os preços do catálogo e da zona seleccionada." },
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
          ceilingHeight: Number(f.ceilingHeight),
          perimeter: Number(f.perimeter),
          rooms: f.rooms.map((r) => ({ name: r.name.trim(), type: r.type, length: Number(r.length), width: Number(r.width) })),
        })),
        foundationType,
        ...(foundationType === "laje"
          ? { slabThickness: Number(slabThickness) }
          : { footing: { count: Number(footingCount), avgArea: Number(footingAvgArea), avgDepth: Number(footingAvgDepth) } }),
        concreteClass,
        roofType,
        roofArea: Number(roofArea),
        steelWeightKg: structuralSummary?.totalSteelWeightKg && structuralSummary.totalSteelWeightKg > 0 ? structuralSummary.totalSteelWeightKg : undefined,
        beamConcreteVolumeM3:
          structuralSummary?.beamsConcreteVolumeM3 && structuralSummary.beamsConcreteVolumeM3 > 0
            ? structuralSummary.beamsConcreteVolumeM3
            : undefined,
        floorSlabThicknessM:
          structuralSummary?.slabsAvgThicknessCm && structuralSummary.slabsAvgThicknessCm > 0
            ? structuralSummary.slabsAvgThicknessCm / 100
            : undefined,
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
        prices: {
          cementBagPrice: cementPrice ? Number(cementPrice) : undefined,
          steelKgPrice: steelPrice ? Number(steelPrice) : undefined,
          blockUnitPrice: blockPrice ? Number(blockPrice) : undefined,
        },
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
    <div className="fixed inset-0 z-50 bg-gray-900/50 flex items-center justify-center p-4">
      <div className="card w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-brand-800 to-brand-900 text-white">
          <div className="flex items-center gap-2">
            <IconWand className="w-5 h-5" />
            <h2 className="font-semibold">Assistente de Medições</h2>
          </div>
          <button onClick={onClose} className="text-brand-200 hover:text-white text-sm">
            Fechar ✕
          </button>
        </div>

        {!result && readinessAccepted && (
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

          {!result && !readinessAccepted ? (
            <div className="space-y-5">
              <div>
                <div className="flex items-end justify-between gap-3">
                  <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Diagnóstico antes de medir</p><h3 className="mt-1 text-xl font-bold text-slate-900">Prontidão dos dados: {readinessPercent}%</h3></div>
                  <span className={`badge ${readinessPercent >= 75 ? "badge-green" : readinessPercent >= 45 ? "badge-yellow" : "badge-red"}`}>{readyCount} de {readinessChecks.length} confirmados</span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full ${readinessPercent >= 75 ? "bg-emerald-500" : readinessPercent >= 45 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${readinessPercent}%` }} /></div>
                <p className="mt-3 text-sm text-slate-600">O SIGA não vai esconder pressupostos. Veja primeiro o que já está confirmado, o que falta e onde uma estimativa genérica seria usada.</p>
              </div>
              <div className="divide-y divide-slate-200 rounded-xl border border-slate-200">
                {readinessChecks.map((item) => (
                  <div key={item.label} className="flex gap-3 p-3.5">
                    <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-xs font-bold ${item.ready ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{item.ready ? "✓" : "!"}</span>
                    <div><p className="text-sm font-medium text-slate-900">{item.label}</p><p className="mt-0.5 text-xs text-slate-500">{item.ready ? "Dados disponíveis para o cálculo." : item.impact}</p></div>
                  </div>
                ))}
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><strong>Pode continuar com estimativas,</strong> mas cada dado em falta ficará identificado no relatório final para revisão e ponderação do utilizador.</div>
            </div>
          ) : result ? (
            <div className="space-y-4">
              <div className="rounded-lg bg-green-50 border border-green-200 p-4">
                <p className="font-medium text-green-800">
                  {result.itemsUpdated} itens do Mapa de Quantidades foram preenchidos automaticamente.
                </p>
                <p className="text-sm text-green-700 mt-1">
                  As quantidades ficam identificadas como "estimativa" — pode abrir a régua de medições em qualquer item e
                  ajustar como preferir.
                </p>
              </div>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div className="card card-pad !p-3">
                  <dt className="muted">Área total construída</dt>
                  <dd className="font-semibold text-gray-900">{result.summary.totalBuiltArea.toFixed(2)} m²</dd>
                </div>
                <div className="card card-pad !p-3">
                  <dt className="muted">Área do piso térreo</dt>
                  <dd className="font-semibold text-gray-900">{result.summary.groundFloorArea.toFixed(2)} m²</dd>
                </div>
                <div className="card card-pad !p-3">
                  <dt className="muted">Volume de betão estrutural</dt>
                  <dd className="font-semibold text-gray-900">{result.summary.concreteVolume.toFixed(2)} m³</dd>
                </div>
                <div className="card card-pad !p-3">
                  <dt className="muted">Peso de aço estimado</dt>
                  <dd className="font-semibold text-gray-900">{result.summary.steelWeight.toFixed(0)} kg</dd>
                </div>
                <div className="card card-pad !p-3">
                  <dt className="muted">Área de paredes exteriores</dt>
                  <dd className="font-semibold text-gray-900">{result.summary.totalExteriorWallArea.toFixed(2)} m²</dd>
                </div>
                <div className="card card-pad !p-3">
                  <dt className="muted">Compartimentos húmidos</dt>
                  <dd className="font-semibold text-gray-900">{result.summary.wetRoomsCount}</dd>
                </div>
                <div className="card card-pad !p-3">
                  <dt className="muted">Volume de betão em fundações</dt>
                  <dd className="font-semibold text-gray-900">{result.summary.footingConcreteVolume.toFixed(2)} m³</dd>
                </div>
                <div className="card card-pad !p-3">
                  <dt className="muted">Aparelhos sanitários previstos</dt>
                  <dd className="font-semibold text-gray-900">{result.summary.totalFixtures}</dd>
                </div>
              </dl>
              <CalculationReportView entries={result.report} />
            </div>
          ) : (
            <>
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
                        A planta só dá a área de cada compartimento — o comprimento/largura abaixo são uma aproximação
                        (quadrado de área equivalente). Corrija-os se souber as dimensões reais, para o perímetro das
                        paredes ficar mais exacto. O piso de cada compartimento já foi confirmado no ecrã da planta —
                        se precisar de o corrigir, volte lá.
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
                          <div key={room.key} className="grid grid-cols-[1fr_6rem_5rem_5rem_auto] gap-2 items-center">
                            <input
                              value={room.name}
                              onChange={(e) => updateRoom(floor.key, room.key, { name: e.target.value })}
                              className="input input-sm"
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
                            <input
                              type="number"
                              step="0.1"
                              min="0"
                              value={room.length}
                              onChange={(e) => updateRoom(floor.key, room.key, { length: e.target.value })}
                              className="input input-sm"
                              placeholder="Compr. m"
                            />
                            <input
                              type="number"
                              step="0.1"
                              min="0"
                              value={room.width}
                              onChange={(e) => updateRoom(floor.key, room.key, { width: e.target.value })}
                              className="input input-sm"
                              placeholder="Larg. m"
                            />
                            <button onClick={() => removeRoom(floor.key, room.key)} className="icon-btn-danger">
                              <IconTrash className="w-4 h-4" />
                            </button>
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
                <div className="space-y-4 max-w-md">
                  <p className="text-sm text-gray-500">
                    Estas escolhas ajustam os rácios de betão, aço e movimento de terras usados na estimativa.
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

                  <div>
                    <label className="label">Tipo de fundação</label>
                    <select
                      value={foundationType}
                      onChange={(e) => setFoundationType(e.target.value as FoundationType)}
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
                        onChange={(e) => setSlabThickness(e.target.value)}
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
                      <button onClick={() => setUseStructuralFooting(false)} className="btn btn-ghost btn-sm mt-2">
                        Prefiro inserir manualmente
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-3">
                      {hasStructuralFootings && (
                        <div className="col-span-3">
                          <button onClick={() => setUseStructuralFooting(true)} className="btn btn-ghost btn-sm">
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
                          onChange={(e) => setFootingCount(e.target.value)}
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
                          onChange={(e) => setFootingAvgArea(e.target.value)}
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
                          onChange={(e) => setFootingAvgDepth(e.target.value)}
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
                <div className="space-y-4 max-w-md">
                  <p className="text-sm text-gray-500">
                    Indique os aparelhos sanitários previstos — os valores já vêm sugeridos a partir dos compartimentos
                    húmidos indicados no Passo 1, mas pode ajustar livremente.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
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
                  <p className="text-xs text-gray-500">
                    Nº de caixas de visita/inspecção: não há um rácio genérico sensato para isto (depende do traçado da
                    rede — mudanças de direcção, distância entre troços), por isso indique directamente quantas estão
                    previstas na planta ou no levantamento.
                  </p>
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={hasWaterTank}
                      onChange={(e) => setHasWaterTank(e.target.checked)}
                      className="w-4 h-4 rounded border-gray-300 text-brand-700 focus:ring-brand-500"
                    />
                    Prever reservatório de água (depósito)
                  </label>

                  <details className="rounded-lg border border-gray-200 p-3">
                    <summary className="text-sm font-medium text-gray-700 cursor-pointer">
                      Ajustes avançados (opcional) — insira um valor real em vez da estimativa genérica
                    </summary>
                    <p className="text-xs text-gray-500 mt-2 mb-3">
                      Estes comprimentos de tubagem usam sempre um rácio genérico por aparelho/compartimento. Se souber o
                      comprimento real (ex: de um levantamento ou planta hidráulica), indique-o aqui.
                    </p>
                    <div className="grid grid-cols-1 gap-3">
                      <div>
                        <label className="label">Tubagem de esgoto Ø110mm (ml)</label>
                        <input type="number" step="0.1" min="0" value={sewerPipe110M} onChange={(e) => setSewerPipe110M(e.target.value)} className="input" />
                      </div>
                      <div>
                        <label className="label">Tubagem de esgoto Ø40mm (ml)</label>
                        <input type="number" step="0.1" min="0" value={sewerPipe40M} onChange={(e) => setSewerPipe40M(e.target.value)} className="input" />
                      </div>
                      <div>
                        <label className="label">Tubo de queda pluvial (m)</label>
                        <input type="number" step="0.1" min="0" value={downpipeLengthM} onChange={(e) => setDownpipeLengthM(e.target.value)} className="input" />
                      </div>
                      <div>
                        <label className="label">Rede de distribuição de água fria (ml)</label>
                        <input type="number" step="0.1" min="0" value={waterSupplyPipeM} onChange={(e) => setWaterSupplyPipeM(e.target.value)} className="input" />
                      </div>
                    </div>
                  </details>

                  <div className="rounded-lg border border-gray-200 p-3">
                    <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={useSepticTank}
                        onChange={(e) => setUseSepticTank(e.target.checked)}
                        className="w-4 h-4 rounded border-gray-300 text-brand-700 focus:ring-brand-500"
                      />
                      Este projecto usa fossa séptica (sem ligação à rede pública de esgotos)
                    </label>

                    {useSepticTank && (
                      <div className="mt-3 space-y-3">
                        <p className="text-xs text-gray-500">
                          Volume da fossa e área de infiltração dimensionados pelo método de Morais (1962)/Bartolomeu
                          (1996), a mesma base de cálculo usada em Portugal e Moçambique para saneamento autónomo.
                        </p>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="label">Nº de pessoas (habitantes)</label>
                            <input
                              type="number"
                              step="1"
                              min="1"
                              value={septicPeople}
                              onChange={(e) => setSepticPeople(e.target.value)}
                              className="input"
                            />
                          </div>
                          <div>
                            <label className="label">Capitação (L/pessoa/dia)</label>
                            <select value={septicFlow} onChange={(e) => setSepticFlow(e.target.value)} className="input">
                              <option value="20">20 — sem ligação domiciliária</option>
                              <option value="60">60 — torneira no quintal</option>
                              <option value="100">100 — canalização interior</option>
                            </select>
                          </div>
                          <div className="col-span-2">
                            <label className="label">Tipo de solo (para a vala/poço de infiltração)</label>
                            <select
                              value={septicSoilType}
                              onChange={(e) => setSepticSoilType(e.target.value as SoilType)}
                              className="input"
                            >
                              {(Object.keys(SOIL_TYPE_LABELS) as SoilType[]).map((s) => (
                                <option key={s} value={s}>
                                  {SOIL_TYPE_LABELS[s]}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        {(() => {
                          const people = Number(septicPeople) || 0;
                          const flow = Number(septicFlow) || 100;
                          if (!(people > 0)) return null;
                          const tank = previewSepticTankVolumeM3(people, flow);
                          const areaPerPerson = INFILTRATION_AREA_PER_PERSON_M2[septicSoilType];
                          return (
                            <div className="rounded-lg bg-brand-50 border border-brand-100 p-3 text-sm space-y-1">
                              <p>
                                Fossa séptica: <span className="font-semibold text-brand-900">{tank.volumeM3.toFixed(2)} m³</span> (
                                {(tank.volumeM3 * 1000).toFixed(0)} L, {tank.compartments} compartimentos)
                              </p>
                              {areaPerPerson !== null ? (
                                <p>
                                  Área de infiltração:{" "}
                                  <span className="font-semibold text-brand-900">{(people * areaPerPerson).toFixed(2)} m²</span>
                                </p>
                              ) : (
                                <p className="text-amber-700">
                                  Argila compacta não tem solução por infiltração simples segundo a tabela de referência —
                                  considere um poço absorvente mais profundo, aterro filtrante, ou outra solução com
                                  acompanhamento de um especialista.
                                </p>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-4 max-w-md">
                  <p className="text-sm text-gray-500">
                    Actualize os preços-chave que mais pesam no orçamento — ficam gravados no catálogo da empresa (sem
                    alterar o catálogo partilhado). Deixe em branco para manter o preço actual.
                  </p>
                  <div>
                    <label className="label">Cimento — MZN por saco 50kg</label>
                    <input type="number" step="1" min="0" value={cementPrice} onChange={(e) => setCementPrice(e.target.value)} className="input" />
                  </div>
                  <div>
                    <label className="label">Aço A400 — MZN por kg</label>
                    <input type="number" step="0.5" min="0" value={steelPrice} onChange={(e) => setSteelPrice(e.target.value)} className="input" />
                  </div>
                  <div>
                    <label className="label">Bloco de cimento 20x20x40 — MZN por unidade</label>
                    <input type="number" step="0.5" min="0" value={blockPrice} onChange={(e) => setBlockPrice(e.target.value)} className="input" />
                  </div>
                </div>
              )}

              {step === 4 && (
                <div className="space-y-3 text-sm">
                  <p className="text-gray-500">Confirme os dados antes de gerar as quantidades.</p>
                  {floors.map((f, i) => (
                    <div key={f.key} className="rounded-lg border border-gray-200 p-3">
                      <p className="font-medium text-gray-900 mb-1">
                        {f.label || `Piso ${i + 1}`} — pé-direito {f.ceilingHeight} m, perímetro {f.perimeter} m
                      </p>
                      <p className="text-gray-500">
                        {f.rooms.map((r) => `${r.name} (${r.type}, ${r.length}×${r.width}m)`).join(" · ")}
                      </p>
                    </div>
                  ))}
                  <div className="rounded-lg border border-gray-200 p-3">
                    <p className="text-gray-500">
                      Fundação: <span className="text-gray-900">{FOUNDATION_LABELS[foundationType]}</span>{" "}
                      {foundationType === "laje" ? (
                        <span className="text-gray-900">(espessura {slabThickness} m)</span>
                      ) : (
                        <span className="text-gray-900">
                          ({footingCount} sapatas × {footingAvgArea} m² × {footingAvgDepth} m)
                        </span>
                      )}{" "}
                      · Betão: <span className="text-gray-900">{concreteClass}</span> · Cobertura:{" "}
                      <span className="text-gray-900">
                        {ROOF_LABELS[roofType]} ({roofArea} m²)
                      </span>
                    </p>
                  </div>
                  <div className="rounded-lg border border-gray-200 p-3">
                    <p className="text-gray-500">
                      Hidráulica: <span className="text-gray-900">{toilets} sanitas</span>,{" "}
                      <span className="text-gray-900">{sinks} lavatórios</span>,{" "}
                      <span className="text-gray-900">{showers} chuveiros</span>,{" "}
                      <span className="text-gray-900">{kitchenSinks} pias de cozinha</span>,{" "}
                      <span className="text-gray-900">{laundryTanks} tanques</span>,{" "}
                      <span className="text-gray-900">{manholeCount} caixas de visita</span>
                      {hasWaterTank ? ", com reservatório de água" : ", sem reservatório de água"}
                      {useSepticTank && (
                        <>
                          {" · Fossa séptica: "}
                          <span className="text-gray-900">
                            {previewSepticTankVolumeM3(Number(septicPeople) || 1, Number(septicFlow) || 100).volumeM3.toFixed(2)} m³
                          </span>
                          {" para "}
                          <span className="text-gray-900">{septicPeople} pessoa(s)</span>
                          {" · Solo: "}
                          <span className="text-gray-900">{SOIL_TYPE_LABELS[septicSoilType]}</span>
                        </>
                      )}
                    </p>
                  </div>
                  <div className="rounded-lg border border-gray-200 p-3">
                    <p className="text-gray-500">
                      Cimento: <span className="text-gray-900">{cementPrice || "—"} MZN</span> · Aço:{" "}
                      <span className="text-gray-900">{steelPrice || "—"} MZN</span> · Bloco:{" "}
                      <span className="text-gray-900">{blockPrice || "—"} MZN</span>
                    </p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-between px-5 py-4 border-t border-gray-100">
          {result ? (
            <>
              <span />
              <button onClick={onClose} className="btn btn-primary">
                Ver Mapa de Quantidades
              </button>
            </>
          ) : !readinessAccepted ? (
            <>
              <button onClick={onClose} className="btn btn-ghost">Cancelar</button>
              <button onClick={() => setReadinessAccepted(true)} className="btn btn-primary">Rever e preencher dados</button>
            </>
          ) : (
            <>
              <button onClick={() => (step === 0 ? onClose() : setStep((s) => s - 1))} className="btn btn-ghost">
                <IconBack className="w-3.5 h-3.5" />
                {step === 0 ? "Cancelar" : "Voltar"}
              </button>
              {step < STEPS.length - 1 ? (
                <button onClick={() => canProceed() && setStep((s) => s + 1)} disabled={!canProceed()} className="btn btn-primary">
                  Seguinte
                </button>
              ) : (
                <button onClick={handleApply} disabled={submitting} className="btn btn-primary">
                  <IconWand className="w-4 h-4" />
                  {submitting ? "A calcular..." : "Aplicar Estimativa"}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

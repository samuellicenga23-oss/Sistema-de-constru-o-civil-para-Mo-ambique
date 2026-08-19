import { useEffect, useMemo, useState } from "react";
import {
  buildRebarPurchasePlan,
  computeSlabRebarWeightLines,
  DEFAULT_REBAR_LENGTH_M,
  DEFAULT_SLAB_LAP_FACTOR,
} from "@sigo/shared";
import { catalogApi, type CostComposition, type CostCompositionDetail, type PriceZone } from "../api/catalog";
import { quickCalcApi, downloadBlob, type QuickCalcResult } from "../api/quickCalc";
import Layout from "../components/Layout";
import { IconRuler, IconDownload } from "../components/icons";

type ConcreteMixing = "obra_betoneira" | "caminho_betoneira";
type LayerMode = "single" | "dual";

function normalize(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function isBetoneiraLine(name: string) {
  return normalize(name).includes("betoneira");
}

function compositionCostWithoutMixer(detail: CostCompositionDetail, volumeM3: number, mixing: ConcreteMixing) {
  if (mixing === "obra_betoneira") {
    return { total: volumeM3 * detail.unitCost, mixerRemoved: 0 };
  }
  const mixerPerUnit = detail.equipmentLines
    .filter((line) => isBetoneiraLine(line.name))
    .reduce((sum, line) => sum + Number(line.qtyPerUnit) * Number(line.unitCost), 0);
  return {
    total: Math.max(0, volumeM3 * (detail.unitCost - mixerPerUnit)),
    mixerRemoved: volumeM3 * mixerPerUnit,
  };
}

/** Quantidade de material com desperdício da composição (igual ao motor de custos). */
function explodeMaterialLines(detail: CostCompositionDetail, qty: number, zoneId: string) {
  return detail.materialLines.map((l) => {
    const wasteFactor = 1 + Number(l.wastePct ?? 0) / 100;
    const qtyPerUnit = Number(l.qtyPerUnit) * wasteFactor;
    const unitPrice = Number(l.unitCost) * Number(l.importFactor ?? 1);
    return {
      name: l.name,
      quantity: qty * qtyPerUnit,
      unit: l.unit ?? "",
      unitPrice,
      totalPrice: qty * qtyPerUnit * unitPrice,
      currency: detail.currency,
      priceSource: zoneId ? "Preço ajustado à zona seleccionada" : "Preço base do Catálogo",
    };
  });
}

function fmt(n: number) {
  return n.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Rácios de desperdício de corte (aço) e de arame de amarração por kg de aço aplicado — vêm da
// composição "Aço A400 aplicado" já existente no Catálogo (não são inventados aqui); só se usam
// estes valores por omissão se essa composição não for encontrada.
const DEFAULT_STEEL_CUT_WASTE_RATIO = 1.05;
const DEFAULT_TIE_WIRE_RATIO = 0.02;

// --- Fossa séptica / vala de infiltração ---
// Mesmas fórmulas usadas no Assistente de Medições (apps/api/src/services/quickEstimate.ts,
// computeSepticTankVolumeM3/computeInfiltrationAreaM2) — duplicadas aqui em vez de partilhadas
// porque aquele ficheiro é só de backend (tem outras dependências de servidor); os valores não
// dependem de nenhuma tabela além das constantes documentadas abaixo (método Morais 1962 /
// Bartolomeu 1996, os mesmos citados no Assistente).
type SoilType = "areia_grossa" | "areia_fina" | "argila_arenosa" | "argila_compacta";
const SOIL_TYPE_LABELS: Record<SoilType, string> = {
  areia_grossa: "Areia grossa / godo",
  areia_fina: "Areia fina",
  argila_arenosa: "Argila com elevado teor de areia",
  argila_compacta: "Argila compacta",
};
const INFILTRATION_AREA_PER_PERSON_M2: Record<SoilType, number | null> = {
  areia_grossa: 1.5,
  areia_fina: 2.5,
  argila_arenosa: 5,
  argila_compacta: null,
};
const SLUDGE_FRESH_CAPITATION_L = 0.45;
const SLUDGE_DIGESTED_CAPITATION_L = 0.11;
const DIGESTION_TIME_DAYS = 60;
const DESLUDGING_INTERVAL_DAYS = 365;
const MIN_TANK_VOLUME_L = 3000;

function computeSepticTankVolumeM3(numberOfPeople: number, dailyFlowLPerPerson: number) {
  const retentionDays = numberOfPeople <= 60 ? 3 : 2;
  const liquidVolume = dailyFlowLPerPerson * numberOfPeople * retentionDays;
  const digestedSludgeVolume = SLUDGE_DIGESTED_CAPITATION_L * numberOfPeople * (DESLUDGING_INTERVAL_DAYS - DIGESTION_TIME_DAYS);
  const digestingSludgeVolume = (SLUDGE_FRESH_CAPITATION_L * numberOfPeople * DIGESTION_TIME_DAYS) / 2;
  const totalVolumeL = Math.max(liquidVolume + digestedSludgeVolume + digestingSludgeVolume, MIN_TANK_VOLUME_L);
  return { volumeM3: totalVolumeL / 1000, compartments: numberOfPeople < 20 ? 2 : 3 };
}
function computeInfiltrationAreaM2(numberOfPeople: number, soilType: SoilType): number | null {
  const areaPerPerson = INFILTRATION_AREA_PER_PERSON_M2[soilType];
  return areaPerPerson === null ? null : numberOfPeople * areaPerPerson;
}

type Tab = "laje" | "betao" | "generico" | "fossa";
const TAB_LABELS: Record<Tab, string> = {
  laje: "Laje",
  betao: "Betão (volume simples)",
  generico: "Qualquer composição (área/volume/ml/un)",
  fossa: "Fossa Séptica",
};

export default function QuickCalcPage() {
  const [tab, setTab] = useState<Tab>("laje");
  const [concreteOptions, setConcreteOptions] = useState<CostComposition[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Título e referência do relatório — editáveis, para o utilizador poder identificar o PDF
  // (obra, cliente, responsável...) em vez de ficar preso a um texto fixo.
  const [lajeTitle, setLajeTitle] = useState("Cálculo Rápido — Laje");
  const [betaoTitle, setBetaoTitle] = useState("Cálculo Rápido — Betão (volume simples)");
  const [reference, setReference] = useState("");

  // --- Laje ---
  const [areaM2, setAreaM2] = useState("284");
  const [thicknessCm, setThicknessCm] = useState("7");
  const [lajeCompId, setLajeCompId] = useState("");
  const [lajeCompDetail, setLajeCompDetail] = useState<CostCompositionDetail | null>(null);
  const [longDiameterMm, setLongDiameterMm] = useState("8");
  const [longSpacingCm, setLongSpacingCm] = useState("15");
  const [transDiameterMm, setTransDiameterMm] = useState("6");
  const [transSpacingCm, setTransSpacingCm] = useState("15");
  const [layerMode, setLayerMode] = useState<LayerMode>("dual");
  const [lapPct, setLapPct] = useState(String(Math.round((DEFAULT_SLAB_LAP_FACTOR - 1) * 100)));
  const [barLengthM, setBarLengthM] = useState(String(DEFAULT_REBAR_LENGTH_M));
  const [lajeMixing, setLajeMixing] = useState<ConcreteMixing>("obra_betoneira");
  const [acoCompDetail, setAcoCompDetail] = useState<CostCompositionDetail | null>(null);

  // --- Betão (volume simples) ---
  const [volumeMode, setVolumeMode] = useState<"directo" | "dimensoes">("directo");
  const [volumeM3Input, setVolumeM3Input] = useState("1");
  const [dimLength, setDimLength] = useState("");
  const [dimWidth, setDimWidth] = useState("");
  const [dimHeight, setDimHeight] = useState("");
  const [betaoCompId, setBetaoCompId] = useState("");
  const [betaoCompDetail, setBetaoCompDetail] = useState<CostCompositionDetail | null>(null);
  const [betaoMixing, setBetaoMixing] = useState<ConcreteMixing>("obra_betoneira");
  const [includeSteelRatio, setIncludeSteelRatio] = useState(false);
  const [betaoLongDiameterMm, setBetaoLongDiameterMm] = useState("12");
  const [betaoTransDiameterMm, setBetaoTransDiameterMm] = useState("8");
  const [betaoLongSharePct, setBetaoLongSharePct] = useState("70");

  // --- Qualquer composição ---
  const [genericoTitle, setGenericoTitle] = useState("Cálculo Rápido");
  const [zones, setZones] = useState<PriceZone[]>([]);
  const [zoneId, setZoneId] = useState("");
  const [genericoCompositions, setGenericoCompositions] = useState<CostComposition[]>([]);
  const [genericoCompId, setGenericoCompId] = useState("");
  const [genericoCompDetail, setGenericoCompDetail] = useState<CostCompositionDetail | null>(null);
  const [genericoQty, setGenericoQty] = useState("1");

  // --- Fossa séptica ---
  const [fossaTitle, setFossaTitle] = useState("Cálculo Rápido — Fossa Séptica");
  const [numberOfPeople, setNumberOfPeople] = useState("6");
  const [dailyFlow, setDailyFlow] = useState("100");
  const [soilType, setSoilType] = useState<SoilType>("areia_grossa");

  useEffect(() => {
    catalogApi.listPriceZones().then(setZones).catch(() => {});
  }, []);

  useEffect(() => {
    catalogApi
      .listCompositions(zoneId || undefined)
      .then((list) => {
        setGenericoCompositions(list);
        if (!genericoCompId && list.length) setGenericoCompId(list[0].id);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneId]);

  useEffect(() => {
    if (!genericoCompId) return;
    catalogApi.getComposition(genericoCompId, zoneId || undefined).then(setGenericoCompDetail).catch(() => {});
  }, [genericoCompId, zoneId]);

  useEffect(() => {
    catalogApi
      .listCompositions(zoneId || undefined)
      .then((all) => {
        const concrete = all.filter((c) => normalize(c.name).startsWith("betao b"));
        setConcreteOptions(concrete);
        const b25 = concrete.find((c) => c.name.includes("B25"));
        const defaultId = b25?.id ?? concrete[0]?.id ?? "";
        setLajeCompId(defaultId);
        setBetaoCompId(defaultId);

        // "Aço A400 aplicado" já traz, como linhas de material, o rácio de desperdício de corte
        // (aço bruto por kg aplicado) e o rácio de arame de amarração — reaproveita-se em vez de
        // inventar valores novos aqui, para ficar sempre coerente com o resto do sistema.
        const acoComp = all.find((c) => normalize(c.name).includes("aco a400 aplicado"));
        if (acoComp) catalogApi.getComposition(acoComp.id, zoneId || undefined).then(setAcoCompDetail).catch(() => {});
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Erro ao carregar composições"));
  }, [zoneId]);

  const steelCutWasteRatio = useMemo(
    () => Number(acoCompDetail?.materialLines.find((l) => normalize(l.name) === "aco a400")?.qtyPerUnit ?? DEFAULT_STEEL_CUT_WASTE_RATIO),
    [acoCompDetail]
  );
  const tieWireRatio = useMemo(
    () => Number(acoCompDetail?.materialLines.find((l) => normalize(l.name).includes("arame"))?.qtyPerUnit ?? DEFAULT_TIE_WIRE_RATIO),
    [acoCompDetail]
  );

  useEffect(() => {
    if (!lajeCompId) return;
    catalogApi.getComposition(lajeCompId, zoneId || undefined).then(setLajeCompDetail).catch(() => {});
  }, [lajeCompId, zoneId]);

  useEffect(() => {
    if (!betaoCompId) return;
    catalogApi.getComposition(betaoCompId, zoneId || undefined).then(setBetaoCompDetail).catch(() => {});
  }, [betaoCompId, zoneId]);

  const lajeResult = useMemo(() => {
    const area = Number(areaM2);
    const thickness = Number(thicknessCm);
    const longDiameter = Number(longDiameterMm);
    const longSpacing = Number(longSpacingCm);
    const transDiameter = Number(transDiameterMm);
    const transSpacing = Number(transSpacingCm);
    const barLength = Number(barLengthM);
    const lapFactor = 1 + Math.max(0, Number(lapPct) || 0) / 100;
    if (!lajeCompDetail || !(area > 0) || !(thickness > 0)) return null;

    const volumeM3 = area * (thickness / 100);
    const materialLines = explodeMaterialLines(lajeCompDetail, volumeM3, zoneId);

    const directions = [
      { diameterMm: longDiameter, spacingCm: longSpacing, role: "longitudinal" },
      { diameterMm: transDiameter, spacingCm: transSpacing, role: "transversal" },
    ];
    const layers =
      layerMode === "dual"
        ? [
            { label: "inferior", directions },
            { label: "superior", directions },
          ]
        : [{ label: "única", directions }];

    const weightLines = computeSlabRebarWeightLines({ areaM2: area, layers, lapFactor });
    const steelMeshKg = weightLines.reduce((sum, line) => sum + line.weightKg / lapFactor, 0);
    const steelNetKg = weightLines.reduce((sum, line) => sum + line.weightKg, 0);
    const purchasePlan = buildRebarPurchasePlan(
      weightLines.map((line) => ({ diameterMm: line.diameterMm, weightKg: line.weightKg * steelCutWasteRatio })),
      barLength > 0 ? barLength : DEFAULT_REBAR_LENGTH_M,
    );
    const steelPurchaseKg = purchasePlan.reduce((sum, line) => sum + line.purchaseWeightKg, 0);
    const steelLengthM = purchasePlan.reduce((sum, line) => sum + line.requiredLengthM, 0);
    const barsNeeded = purchasePlan.reduce((sum, line) => sum + line.barsToBuy, 0);
    const tieWireKg = steelNetKg * tieWireRatio;
    const concrete = compositionCostWithoutMixer(lajeCompDetail, volumeM3, lajeMixing);

    return {
      volumeM3,
      materialLines,
      concreteTotal: concrete.total,
      mixerRemoved: concrete.mixerRemoved,
      mixing: lajeMixing,
      currency: lajeCompDetail.currency,
      steelMeshKg,
      steelNetKg,
      steelPurchaseKg,
      steelLengthM,
      barsNeeded,
      tieWireKg,
      barLength,
      lapFactor,
      layerMode,
      weightLines,
      purchasePlan,
    };
  }, [
    lajeCompDetail,
    areaM2,
    thicknessCm,
    longDiameterMm,
    longSpacingCm,
    transDiameterMm,
    transSpacingCm,
    layerMode,
    lapPct,
    barLengthM,
    steelCutWasteRatio,
    tieWireRatio,
    zoneId,
    lajeMixing,
  ]);

  const betaoVolumeM3 = useMemo(() => {
    if (volumeMode === "directo") return Number(volumeM3Input) || 0;
    return (Number(dimLength) || 0) * (Number(dimWidth) || 0) * (Number(dimHeight) || 0);
  }, [volumeMode, volumeM3Input, dimLength, dimWidth, dimHeight]);

  const betaoResult = useMemo(() => {
    if (!betaoCompDetail || !(betaoVolumeM3 > 0)) return null;
    const materialLines = explodeMaterialLines(betaoCompDetail, betaoVolumeM3, zoneId);

    let steelNetKg = 0;
    let steelPurchaseKg = 0;
    let tieWireKg = 0;
    let purchasePlan: ReturnType<typeof buildRebarPurchasePlan> = [];
    let weightLines: Array<{ diameterMm: number; weightKg: number; role: string }> = [];
    if (includeSteelRatio) {
      steelNetKg = betaoVolumeM3 * 0.95 * 80;
      const longShare = Math.min(100, Math.max(0, Number(betaoLongSharePct) || 70)) / 100;
      const longKg = steelNetKg * longShare;
      const transKg = steelNetKg * (1 - longShare);
      const longDiameter = Number(betaoLongDiameterMm);
      const transDiameter = Number(betaoTransDiameterMm);
      if (longDiameter > 0 && longKg > 0) weightLines.push({ diameterMm: longDiameter, weightKg: longKg, role: "longitudinal" });
      if (transDiameter > 0 && transKg > 0) weightLines.push({ diameterMm: transDiameter, weightKg: transKg, role: "transversal" });
      purchasePlan = buildRebarPurchasePlan(
        weightLines.map((line) => ({ diameterMm: line.diameterMm, weightKg: line.weightKg * steelCutWasteRatio })),
        Number(barLengthM) > 0 ? Number(barLengthM) : DEFAULT_REBAR_LENGTH_M,
      );
      steelPurchaseKg = purchasePlan.reduce((sum, line) => sum + line.purchaseWeightKg, 0);
      tieWireKg = steelNetKg * tieWireRatio;
    }

    const concrete = compositionCostWithoutMixer(betaoCompDetail, betaoVolumeM3, betaoMixing);
    return {
      materialLines,
      compositionTotal: concrete.total,
      mixerRemoved: concrete.mixerRemoved,
      mixing: betaoMixing,
      currency: betaoCompDetail.currency,
      steelNetKg,
      steelPurchaseKg,
      tieWireKg,
      weightLines,
      purchasePlan,
    };
  }, [
    betaoCompDetail,
    betaoVolumeM3,
    includeSteelRatio,
    steelCutWasteRatio,
    tieWireRatio,
    zoneId,
    betaoMixing,
    betaoLongDiameterMm,
    betaoTransDiameterMm,
    betaoLongSharePct,
    barLengthM,
  ]);

  const genericoCompositionsByCategory = useMemo(() => {
    const map = new Map<string, CostComposition[]>();
    for (const c of genericoCompositions) {
      if (!map.has(c.category)) map.set(c.category, []);
      map.get(c.category)!.push(c);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b, "pt"));
  }, [genericoCompositions]);

  const selectedGenericoComposition = useMemo(
    () => genericoCompositions.find((c) => c.id === genericoCompId) ?? null,
    [genericoCompositions, genericoCompId]
  );

  const genericoResult = useMemo(() => {
    const qty = Number(genericoQty);
    if (!genericoCompDetail || !selectedGenericoComposition || !(qty > 0)) return null;
    const materialLines = explodeMaterialLines(genericoCompDetail, qty, zoneId);
    const totalValue = qty * selectedGenericoComposition.unitCost;
    return { materialLines, totalValue, currency: selectedGenericoComposition.currency };
  }, [genericoCompDetail, selectedGenericoComposition, genericoQty]);

  const fossaResult = useMemo(() => {
    const people = Number(numberOfPeople);
    const flow = Number(dailyFlow);
    if (!(people > 0) || !(flow > 0)) return null;
    const tank = computeSepticTankVolumeM3(people, flow);
    const infiltrationAreaM2 = computeInfiltrationAreaM2(people, soilType);
    return { ...tank, infiltrationAreaM2 };
  }, [numberOfPeople, dailyFlow, soilType]);

  async function handleExportLaje() {
    if (!lajeResult || !lajeCompDetail) return;
    const result: QuickCalcResult = {
      title: lajeTitle.trim() || "Cálculo Rápido — Laje",
      reference: reference.trim() || undefined,
      inputsSummary: [
        `Área: ${fmt(Number(areaM2))} m²`,
        `Espessura: ${fmt(Number(thicknessCm))} cm`,
        `Classe do betão: ${lajeCompDetail.name}`,
        `Produção do betão: ${lajeResult.mixing === "obra_betoneira" ? "Betoneira de obra" : "Camião betoneira (betão pronto)"}`,
        `Camadas de armadura: ${lajeResult.layerMode === "dual" ? "inferior + superior" : "malha única"}`,
        `Armadura longitudinal: Ø${longDiameterMm} mm a cada ${longSpacingCm} cm`,
        `Armadura transversal: Ø${transDiameterMm} mm a cada ${transSpacingCm} cm`,
        `Emendas/sobreposições: ${fmt((lajeResult.lapFactor - 1) * 100)} %`,
        `Comprimento comercial da barra: ${fmt(lajeResult.barLength)} m`,
      ],
      lines: [
        { name: "Volume de betão", quantity: lajeResult.volumeM3, unit: "m³" },
        ...lajeResult.materialLines,
        {
          name: lajeResult.mixing === "obra_betoneira" ? "Composição de betão (obra / betoneira)" : "Composição de betão (camião betoneira — sem horas de betoneira de obra)",
          quantity: lajeResult.volumeM3,
          unit: "m³",
          unitPrice: lajeResult.volumeM3 > 0 ? lajeResult.concreteTotal / lajeResult.volumeM3 : 0,
          totalPrice: lajeResult.concreteTotal,
          currency: lajeResult.currency,
          priceSource: "Materiais + mão-de-obra + equipamento aplicável",
        },
        ...lajeResult.weightLines.map((line) => ({
          name: `Aço ${line.layer} ${line.role} Ø${line.diameterMm} mm (com emendas)`,
          quantity: line.weightKg,
          unit: "kg",
        })),
        { name: "Aço malha (sem emendas)", quantity: lajeResult.steelMeshKg, unit: "kg" },
        { name: "Aço líquido total (com emendas)", quantity: lajeResult.steelNetKg, unit: "kg" },
        ...lajeResult.purchasePlan.map((line) => ({
          name: `Aço a comprar Ø${line.diameterMm} mm (${line.barsToBuy} varões × ${fmt(line.commercialBarLengthM)} m)`,
          quantity: line.purchaseWeightKg,
          unit: "kg",
        })),
        { name: "Aço a comprar total", quantity: lajeResult.steelPurchaseKg, unit: "kg" },
        { name: "Arame de amarração", quantity: lajeResult.tieWireKg, unit: "kg" },
      ],
      notes: [
        "Volume de betão = área × espessura.",
        "Armadura: kg = área × (peso/metro ÷ espaçamento) × camadas × factor de emendas; depois × desperdício de corte do catálogo.",
        "Quantidades por diâmetro usam o plano de compra comercial (barras inteiras).",
        "Materiais da composição incluem desperdício (wastePct) definido no catálogo.",
        lajeResult.mixing === "caminho_betoneira"
          ? "Modo camião betoneira: horas de betoneira de obra foram retiradas do custo da composição."
          : "Modo betoneira de obra: custo inclui o equipamento da composição do catálogo.",
        "Não substitui um projecto de armadura detalhado.",
      ],
    };
    await exportResult(result);
  }

  async function handleExportBetao() {
    if (!betaoResult || !betaoCompDetail) return;
    const inputsSummary = [
      volumeMode === "directo"
        ? `Volume: ${fmt(betaoVolumeM3)} m³`
        : `Dimensões: ${fmt(Number(dimLength))} × ${fmt(Number(dimWidth))} × ${fmt(Number(dimHeight))} m = ${fmt(betaoVolumeM3)} m³`,
      `Classe do betão: ${betaoCompDetail.name}`,
      `Produção do betão: ${betaoResult.mixing === "obra_betoneira" ? "Betoneira de obra" : "Camião betoneira (betão pronto)"}`,
    ];
    if (includeSteelRatio) {
      inputsSummary.push(
        `Aço: 80 kg/m³ (95% do volume) — longitudinal Ø${betaoLongDiameterMm} mm (${betaoLongSharePct}%) · transversal Ø${betaoTransDiameterMm} mm`,
      );
    }
    const result: QuickCalcResult = {
      title: betaoTitle.trim() || "Cálculo Rápido — Betão (volume simples)",
      reference: reference.trim() || undefined,
      inputsSummary,
      lines: [
        { name: "Volume de betão", quantity: betaoVolumeM3, unit: "m³" },
        ...betaoResult.materialLines,
        {
          name: betaoResult.mixing === "obra_betoneira" ? "Composição de betão (obra / betoneira)" : "Composição de betão (camião betoneira — sem horas de betoneira de obra)",
          quantity: betaoVolumeM3,
          unit: "m³",
          unitPrice: betaoVolumeM3 > 0 ? betaoResult.compositionTotal / betaoVolumeM3 : 0,
          totalPrice: betaoResult.compositionTotal,
          currency: betaoResult.currency,
          priceSource: "Materiais + mão-de-obra + equipamento aplicável",
        },
        ...(includeSteelRatio
          ? [
              ...betaoResult.weightLines.map((line) => ({
                name: `Aço líquido ${line.role} Ø${line.diameterMm} mm`,
                quantity: line.weightKg,
                unit: "kg",
              })),
              { name: "Aço líquido total", quantity: betaoResult.steelNetKg, unit: "kg" },
              ...betaoResult.purchasePlan.map((line) => ({
                name: `Aço a comprar Ø${line.diameterMm} mm (${line.barsToBuy} varões)`,
                quantity: line.purchaseWeightKg,
                unit: "kg",
              })),
              { name: "Arame de amarração", quantity: betaoResult.tieWireKg, unit: "kg" },
            ]
          : []),
      ],
      notes: [
        "Quantidades de cimento/areia/brita/água = volume de betão × rácio da composição escolhida no Catálogo de Preços.",
        ...(includeSteelRatio
          ? [
              "Aço estimado por um rácio genérico (80 kg de aço por m³ de betão estrutural) — use um valor real do projecto de estruturas sempre que o tiver.",
              "Esta mistura de aço não corresponde a um único diâmetro (longitudinais + estribos), por isso não se converte em metros/nº de varões como na Laje.",
              "Aço a comprar e arame de amarração usam os mesmos rácios já definidos na composição \"Aço A400 aplicado\" do Catálogo de Preços.",
            ]
          : []),
      ],
    };
    await exportResult(result);
  }

  async function handleExportGenerico() {
    if (!genericoResult || !selectedGenericoComposition) return;
    const zoneName = zones.find((z) => z.id === zoneId)?.name;
    const result: QuickCalcResult = {
      title: genericoTitle.trim() || "Cálculo Rápido",
      reference: reference.trim() || undefined,
      inputsSummary: [
        `Composição: ${selectedGenericoComposition.name}`,
        `Quantidade: ${fmt(Number(genericoQty))} ${selectedGenericoComposition.outputUnit}`,
        ...(zoneName ? [`Zona de preço: ${zoneName}`] : []),
      ],
      lines: [
        ...genericoResult.materialLines,
        { name: "Composição completa", quantity: Number(genericoQty), unit: selectedGenericoComposition.outputUnit, unitPrice: selectedGenericoComposition.unitCost, totalPrice: genericoResult.totalValue, currency: genericoResult.currency, priceSource: "Materiais + mão-de-obra + equipamento" },
      ],
      notes: [
        "Quantidades de materiais = quantidade indicada × rácio da composição escolhida no Catálogo de Preços.",
        "Esta calculadora funciona para qualquer composição do Catálogo — alvenaria, reboco, betonilha, revestimentos, pinturas, cobertura, tubagens, aparelhos sanitários/eléctricos, etc.",
        zoneName ? `Valor total ajustado à zona de preço "${zoneName}" — as quantidades de material não variam por zona, só o custo.` : "Sem zona de preço seleccionada — valor ao preço base do Catálogo.",
      ],
    };
    await exportResult(result);
  }

  async function handleExportFossa() {
    if (!fossaResult) return;
    const result: QuickCalcResult = {
      title: fossaTitle.trim() || "Cálculo Rápido — Fossa Séptica",
      reference: reference.trim() || undefined,
      inputsSummary: [
        `Nº de pessoas servidas: ${numberOfPeople}`,
        `Capitação diária: ${fmt(Number(dailyFlow))} L/pessoa/dia`,
        `Tipo de solo (vala de infiltração): ${SOIL_TYPE_LABELS[soilType]}`,
      ],
      lines: [
        { name: "Volume útil da fossa séptica", quantity: fossaResult.volumeM3, unit: "m³" },
        { name: "Nº de câmaras/compartimentos recomendado", quantity: fossaResult.compartments, unit: "un" },
        ...(fossaResult.infiltrationAreaM2 !== null
          ? [{ name: "Área de infiltração necessária", quantity: fossaResult.infiltrationAreaM2, unit: "m²" }]
          : []),
      ],
      notes: [
        "Volume da fossa calculado pelo método Morais (1962): volume líquido (capitação × pessoas × dias de retenção) + volume de lamas digeridas + volume de lamas em digestão, com um mínimo prático de 3000 L.",
        "Dias de retenção: 3 dias até 60 pessoas, 2 dias acima disso (norma prática de dimensionamento).",
        fossaResult.infiltrationAreaM2 === null
          ? "Solo do tipo argila compacta não tem solução por infiltração simples — recomenda-se um sistema alternativo (ex: poço absorvente com camada drenante ou ligação a rede pública)."
          : "Área de infiltração por área/pessoa segundo o tipo de solo (tabela simplificada, capitação até 100 L/pessoa/dia).",
        "Este cálculo não substitui um projecto de saneamento aprovado — usar como estimativa de pré-dimensionamento.",
      ],
    };
    await exportResult(result);
  }

  async function exportResult(result: QuickCalcResult) {
    setExporting(true);
    setError(null);
    try {
      const blob = await quickCalcApi.exportPdf(result);
      downloadBlob(blob, `${result.title.replace(/[^\w\- ]/g, "")}.pdf`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao exportar PDF");
    } finally {
      setExporting(false);
    }
  }

  return (
    <Layout title="Cálculos Rápidos">
      <div className="space-y-5 max-w-3xl">
        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="workspace-tabs">
          {(["laje", "betao", "generico", "fossa"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`workspace-tab ${tab === t ? "workspace-tab-active" : ""}`}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>

        <details className="card card-pad group">
          <summary className="flex list-none items-center justify-between gap-3 text-sm font-semibold text-slate-900"><span>Dados do relatório e zona de preços</span><span className="text-brand-700 group-open:rotate-45">+</span></summary>
          <div className="mt-4 space-y-3 border-t border-slate-200 pt-4">
          <div>
            <label className="label">Título do relatório</label>
            <input
              type="text"
              value={tab === "laje" ? lajeTitle : tab === "betao" ? betaoTitle : tab === "generico" ? genericoTitle : fossaTitle}
              onChange={(e) => {
                const v = e.target.value;
                if (tab === "laje") setLajeTitle(v);
                else if (tab === "betao") setBetaoTitle(v);
                else if (tab === "generico") setGenericoTitle(v);
                else setFossaTitle(v);
              }}
              className="input"
            />
          </div>
          <div>
            <label className="label">Referência (opcional — obra, cliente, responsável...)</label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Ex: Obra Dr Castro — Eng. João Manuel"
              className="input"
            />
          </div>
          <div>
            <label className="label">Zona de preço usada nos cálculos</label>
            <select value={zoneId} onChange={(event) => setZoneId(event.target.value)} className="input">
              <option value="">Preço base do Catálogo</option>
              {zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
            </select>
            <p className="mt-1 text-xs text-slate-500">Aplica-se a Laje, Betão e Qualquer composição. Os totais são recalculados automaticamente.</p>
          </div>
          </div>
        </details>

        {tab === "laje" && (
          <section className="card card-pad space-y-4">
            <div className="flex items-center gap-2">
              <IconRuler className="w-4 h-4 text-brand-700" />
              <h2 className="section-title">Laje — área e espessura</h2>
            </div>
            <p className="text-xs leading-5 text-gray-500">Volume, materiais (com desperdício do catálogo) e armadura por diâmetro — camadas, emendas e compra em barras.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Área (m²)</label>
                <input type="number" step="0.01" min="0" value={areaM2} onChange={(e) => setAreaM2(e.target.value)} className="input" />
              </div>
              <div>
                <label className="label">Espessura (cm)</label>
                <input type="number" step="0.01" min="0" value={thicknessCm} onChange={(e) => setThicknessCm(e.target.value)} className="input" />
              </div>
              <div>
                <label className="label">Classe do betão</label>
                <select value={lajeCompId} onChange={(e) => setLajeCompId(e.target.value)} className="input">
                  {concreteOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Produção do betão</label>
                <select value={lajeMixing} onChange={(e) => setLajeMixing(e.target.value as ConcreteMixing)} className="input">
                  <option value="obra_betoneira">Betoneira de obra</option>
                  <option value="caminho_betoneira">Camião betoneira (betão pronto)</option>
                </select>
              </div>
              <div>
                <label className="label">Camadas de armadura</label>
                <select value={layerMode} onChange={(e) => setLayerMode(e.target.value as LayerMode)} className="input">
                  <option value="single">Malha única</option>
                  <option value="dual">Inferior + superior</option>
                </select>
              </div>
              <div>
                <label className="label">Emendas / sobreposições (%)</label>
                <input type="number" step="1" min="0" max="50" value={lapPct} onChange={(e) => setLapPct(e.target.value)} className="input" />
              </div>
              <div>
                <label className="label">Ø longitudinal (mm)</label>
                <input type="number" step="0.01" min="0" value={longDiameterMm} onChange={(e) => setLongDiameterMm(e.target.value)} className="input" />
              </div>
              <div>
                <label className="label">Espaçamento longitudinal (cm)</label>
                <input type="number" step="0.01" min="0" value={longSpacingCm} onChange={(e) => setLongSpacingCm(e.target.value)} className="input" />
              </div>
              <div>
                <label className="label">Ø transversal (mm)</label>
                <input type="number" step="0.01" min="0" value={transDiameterMm} onChange={(e) => setTransDiameterMm(e.target.value)} className="input" />
              </div>
              <div>
                <label className="label">Espaçamento transversal (cm)</label>
                <input type="number" step="0.01" min="0" value={transSpacingCm} onChange={(e) => setTransSpacingCm(e.target.value)} className="input" />
              </div>
              <div>
                <label className="label">Comprimento comercial da barra (m)</label>
                <input type="number" step="0.01" min="0" value={barLengthM} onChange={(e) => setBarLengthM(e.target.value)} className="input" />
              </div>
            </div>

            {lajeResult && (
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="w-full min-w-[620px] text-sm">
                  <thead>
                    <tr className="table-head-row">
                      <th className="text-left py-2 px-4 font-medium">Material</th>
                      <th className="text-right font-medium pr-4">Quantidade</th>
                      <th className="text-right font-medium pr-4">Preço unit.</th>
                      <th className="text-right font-medium pr-4">Custo</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="table-row">
                      <td className="py-2 px-4">Volume de betão</td>
                      <td className="text-right pr-4 tabular-nums font-medium">{fmt(lajeResult.volumeM3)} m³</td>
                      <td className="text-right pr-4 text-slate-400">—</td><td className="text-right pr-4 text-slate-400">—</td>
                    </tr>
                    {lajeResult.materialLines.map((l) => (
                      <tr key={l.name} className="table-row">
                        <td className="py-2 px-4">{l.name}</td>
                        <td className="text-right pr-4 tabular-nums">
                          {fmt(l.quantity)} {l.unit}
                        </td>
                        <td className="text-right pr-4 tabular-nums">{fmt(l.unitPrice)} {l.currency}</td>
                        <td className="text-right pr-4 tabular-nums font-medium">{fmt(l.totalPrice)} {l.currency}</td>
                      </tr>
                    ))}
                    <tr className="table-row">
                      <td className="py-2 px-4" colSpan={4}>
                        <span className={`badge ${lajeResult.mixing === "obra_betoneira" ? "badge-brand" : "badge-gray"}`}>
                          {lajeResult.mixing === "obra_betoneira" ? "Betoneira de obra" : "Camião betoneira"}
                        </span>
                      </td>
                    </tr>
                    {lajeResult.weightLines.map((line) => (
                      <tr key={`net-${line.layer}-${line.role}-${line.diameterMm}`} className="table-row">
                        <td className="py-2 px-4">Aço {line.layer} {line.role} Ø{line.diameterMm} mm</td>
                        <td className="text-right pr-4 tabular-nums">{fmt(line.weightKg)} kg</td>
                        <td className="text-right pr-4 text-slate-400">—</td><td className="text-right pr-4 text-slate-400">—</td>
                      </tr>
                    ))}
                    <tr className="table-row">
                      <td className="py-2 px-4">Aço malha (sem emendas)</td>
                      <td className="text-right pr-4 tabular-nums">{fmt(lajeResult.steelMeshKg)} kg</td>
                      <td className="text-right pr-4 text-slate-400">—</td><td className="text-right pr-4 text-slate-400">—</td>
                    </tr>
                    <tr className="table-row">
                      <td className="py-2 px-4 font-medium">Aço líquido total (com {fmt((lajeResult.lapFactor - 1) * 100)}% emendas)</td>
                      <td className="text-right pr-4 tabular-nums font-medium">{fmt(lajeResult.steelNetKg)} kg</td>
                      <td className="text-right pr-4 text-slate-400">—</td><td className="text-right pr-4 text-slate-400">—</td>
                    </tr>
                    {lajeResult.purchasePlan.map((line) => (
                      <tr key={`buy-${line.diameterMm}`} className="table-row bg-brand-50/60">
                        <td className="py-2 px-4 font-medium">Aço a comprar Ø{line.diameterMm} mm ({line.barsToBuy} varões × {fmt(line.commercialBarLengthM)} m)</td>
                        <td className="text-right pr-4 tabular-nums font-semibold">{fmt(line.purchaseWeightKg)} kg</td>
                        <td className="text-right pr-4 text-slate-400">—</td><td className="text-right pr-4 text-slate-400">—</td>
                      </tr>
                    ))}
                    <tr className="table-row">
                      <td className="py-2 px-4">Arame de amarração</td>
                      <td className="text-right pr-4 tabular-nums">{fmt(lajeResult.tieWireKg)} kg</td>
                      <td className="text-right pr-4 text-slate-400">—</td><td className="text-right pr-4 text-slate-400">—</td>
                    </tr>
                    <tr className="table-row bg-slate-900 text-white"><td className="py-2 px-4 font-semibold" colSpan={3}>Custo do betão ({lajeResult.mixing === "obra_betoneira" ? "com betoneira de obra" : "camião — sem betoneira de obra"})</td><td className="text-right pr-4 font-semibold">{fmt(lajeResult.concreteTotal)} {lajeResult.currency}</td></tr>
                  </tbody>
                </table>
              </div>
            )}

            <button onClick={handleExportLaje} disabled={!lajeResult || exporting} className="btn btn-primary">
              <IconDownload className="w-4 h-4" />
              {exporting ? "A gerar PDF..." : "Exportar PDF"}
            </button>
          </section>
        )}

        {tab === "betao" && (
          <section className="card card-pad space-y-4">
            <div className="flex items-center gap-2">
              <IconRuler className="w-4 h-4 text-brand-700" />
              <h2 className="section-title">Betão — volume simples</h2>
            </div>
            <p className="text-xs leading-5 text-gray-500">Materiais e custo para um volume ou dimensões conhecidas.</p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setVolumeMode("directo")}
                className={`btn btn-sm ${volumeMode === "directo" ? "btn-primary" : "btn-secondary"}`}
              >
                Indicar volume (m³)
              </button>
              <button
                onClick={() => setVolumeMode("dimensoes")}
                className={`btn btn-sm ${volumeMode === "dimensoes" ? "btn-primary" : "btn-secondary"}`}
              >
                Indicar dimensões (C×L×A)
              </button>
            </div>

            {volumeMode === "directo" ? (
              <div>
                <label className="label">Volume (m³)</label>
                <input type="number" step="0.01" min="0" value={volumeM3Input} onChange={(e) => setVolumeM3Input(e.target.value)} className="input max-w-xs" />
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3 max-w-md">
                <div>
                  <label className="label">Comprimento (m)</label>
                  <input type="number" step="0.01" min="0" value={dimLength} onChange={(e) => setDimLength(e.target.value)} className="input" />
                </div>
                <div>
                  <label className="label">Largura (m)</label>
                  <input type="number" step="0.01" min="0" value={dimWidth} onChange={(e) => setDimWidth(e.target.value)} className="input" />
                </div>
                <div>
                  <label className="label">Altura (m)</label>
                  <input type="number" step="0.01" min="0" value={dimHeight} onChange={(e) => setDimHeight(e.target.value)} className="input" />
                </div>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Classe do betão</label>
                <select value={betaoCompId} onChange={(e) => setBetaoCompId(e.target.value)} className="input">
                  {concreteOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Produção do betão</label>
                <select value={betaoMixing} onChange={(e) => setBetaoMixing(e.target.value as ConcreteMixing)} className="input">
                  <option value="obra_betoneira">Betoneira de obra</option>
                  <option value="caminho_betoneira">Camião betoneira (betão pronto)</option>
                </select>
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={includeSteelRatio}
                onChange={(e) => setIncludeSteelRatio(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-brand-700 focus:ring-brand-500"
              />
              Incluir estimativa de aço (80 kg/m³) com diâmetros longitudinal e transversal
            </label>
            {includeSteelRatio && (
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="label">Ø longitudinal (mm)</label>
                  <input type="number" step="0.01" min="0" value={betaoLongDiameterMm} onChange={(e) => setBetaoLongDiameterMm(e.target.value)} className="input" />
                </div>
                <div>
                  <label className="label">Ø transversal (mm)</label>
                  <input type="number" step="0.01" min="0" value={betaoTransDiameterMm} onChange={(e) => setBetaoTransDiameterMm(e.target.value)} className="input" />
                </div>
                <div>
                  <label className="label">% longitudinal</label>
                  <input type="number" step="1" min="0" max="100" value={betaoLongSharePct} onChange={(e) => setBetaoLongSharePct(e.target.value)} className="input" />
                </div>
              </div>
            )}

            {betaoResult && (
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="w-full min-w-[620px] text-sm">
                  <thead>
                    <tr className="table-head-row">
                      <th className="text-left py-2 px-4 font-medium">Material</th>
                      <th className="text-right font-medium pr-4">Quantidade</th>
                      <th className="text-right font-medium pr-4">Preço unit.</th>
                      <th className="text-right font-medium pr-4">Custo</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="table-row">
                      <td className="py-2 px-4">Volume de betão</td>
                      <td className="text-right pr-4 tabular-nums font-medium">{fmt(betaoVolumeM3)} m³</td>
                      <td className="text-right pr-4 text-slate-400">—</td><td className="text-right pr-4 text-slate-400">—</td>
                    </tr>
                    {betaoResult.materialLines.map((l) => (
                      <tr key={l.name} className="table-row">
                        <td className="py-2 px-4">{l.name}</td>
                        <td className="text-right pr-4 tabular-nums">
                          {fmt(l.quantity)} {l.unit}
                        </td>
                        <td className="text-right pr-4 tabular-nums">{fmt(l.unitPrice)} {l.currency}</td>
                        <td className="text-right pr-4 tabular-nums font-medium">{fmt(l.totalPrice)} {l.currency}</td>
                      </tr>
                    ))}
                    <tr className="table-row">
                      <td className="py-2 px-4" colSpan={4}>
                        <span className={`badge ${betaoResult.mixing === "obra_betoneira" ? "badge-brand" : "badge-gray"}`}>
                          {betaoResult.mixing === "obra_betoneira" ? "Betoneira de obra" : "Camião betoneira"}
                        </span>
                      </td>
                    </tr>
                    {includeSteelRatio && (
                      <>
                        {betaoResult.weightLines.map((line) => (
                          <tr key={`bnet-${line.role}-${line.diameterMm}`} className="table-row">
                            <td className="py-2 px-4">Aço líquido {line.role} Ø{line.diameterMm} mm</td>
                            <td className="text-right pr-4 tabular-nums">{fmt(line.weightKg)} kg</td>
                            <td className="text-right pr-4 text-slate-400">—</td><td className="text-right pr-4 text-slate-400">—</td>
                          </tr>
                        ))}
                        {betaoResult.purchasePlan.map((line) => (
                          <tr key={`bbuy-${line.diameterMm}`} className="table-row bg-brand-50/60">
                            <td className="py-2 px-4 font-medium">Aço a comprar Ø{line.diameterMm} mm ({line.barsToBuy} varões)</td>
                            <td className="text-right pr-4 tabular-nums font-semibold">{fmt(line.purchaseWeightKg)} kg</td>
                            <td className="text-right pr-4 text-slate-400">—</td><td className="text-right pr-4 text-slate-400">—</td>
                          </tr>
                        ))}
                        <tr className="table-row">
                          <td className="py-2 px-4">Arame de amarração</td>
                          <td className="text-right pr-4 tabular-nums">{fmt(betaoResult.tieWireKg)} kg</td>
                          <td className="text-right pr-4 text-slate-400">—</td><td className="text-right pr-4 text-slate-400">—</td>
                        </tr>
                      </>
                    )}
                    <tr className="table-row bg-slate-900 text-white"><td className="py-2 px-4 font-semibold" colSpan={3}>Custo do betão ({betaoResult.mixing === "obra_betoneira" ? "com betoneira de obra" : "camião — sem betoneira de obra"})</td><td className="text-right pr-4 font-semibold">{fmt(betaoResult.compositionTotal)} {betaoResult.currency}</td></tr>
                  </tbody>
                </table>
              </div>
            )}

            <button onClick={handleExportBetao} disabled={!betaoResult || exporting} className="btn btn-primary">
              <IconDownload className="w-4 h-4" />
              {exporting ? "A gerar PDF..." : "Exportar PDF"}
            </button>
          </section>
        )}

        {tab === "generico" && (
          <section className="card card-pad space-y-4">
            <div className="flex items-center gap-2">
              <IconRuler className="w-4 h-4 text-brand-700" />
              <h2 className="section-title">Qualquer composição do Catálogo</h2>
            </div>
            <p className="text-xs leading-5 text-gray-500">Calcule materiais e custo total a partir de qualquer composição do Catálogo.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Zona de preço (opcional)</label>
                <select value={zoneId} onChange={(e) => setZoneId(e.target.value)} className="input">
                  <option value="">Preço base do Catálogo</option>
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="label">Composição</label>
                <select value={genericoCompId} onChange={(e) => setGenericoCompId(e.target.value)} className="input">
                  {genericoCompositionsByCategory.map(([category, comps]) => (
                    <optgroup key={category} label={category}>
                      {comps.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.outputUnit})
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Quantidade {selectedGenericoComposition ? `(${selectedGenericoComposition.outputUnit})` : ""}</label>
                <input type="number" step="0.01" min="0" value={genericoQty} onChange={(e) => setGenericoQty(e.target.value)} className="input" />
              </div>
            </div>

            {genericoResult && (
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="w-full min-w-[620px] text-sm">
                  <thead>
                    <tr className="table-head-row">
                      <th className="text-left py-2 px-4 font-medium">Material</th>
                      <th className="text-right font-medium pr-4">Quantidade</th>
                      <th className="text-right font-medium pr-4">Preço unit.</th>
                      <th className="text-right font-medium pr-4">Custo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {genericoResult.materialLines.map((l) => (
                      <tr key={l.name} className="table-row">
                        <td className="py-2 px-4">{l.name}</td>
                        <td className="text-right pr-4 tabular-nums">
                          {fmt(l.quantity)} {l.unit}
                        </td>
                        <td className="text-right pr-4 tabular-nums">{fmt(l.unitPrice)} {l.currency}</td>
                        <td className="text-right pr-4 tabular-nums font-medium">{fmt(l.totalPrice)} {l.currency}</td>
                      </tr>
                    ))}
                    <tr className="table-row bg-brand-50/60">
                      <td className="py-2 px-4 font-medium" colSpan={3}>Valor total (mão-de-obra + materiais + máquinas)</td>
                      <td className="text-right pr-4 tabular-nums font-semibold">
                        {fmt(genericoResult.totalValue)} {genericoResult.currency}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            <button onClick={handleExportGenerico} disabled={!genericoResult || exporting} className="btn btn-primary">
              <IconDownload className="w-4 h-4" />
              {exporting ? "A gerar PDF..." : "Exportar PDF"}
            </button>
          </section>
        )}

        {tab === "fossa" && (
          <section className="card card-pad space-y-4">
            <div className="flex items-center gap-2">
              <IconRuler className="w-4 h-4 text-brand-700" />
              <h2 className="section-title">Fossa Séptica — pré-dimensionamento</h2>
            </div>
            <p className="text-xs leading-5 text-gray-500">Pré-dimensionamento pelo método Morais (1962). Requer validação do projectista.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Nº de pessoas servidas</label>
                <input type="number" step="1" min="1" value={numberOfPeople} onChange={(e) => setNumberOfPeople(e.target.value)} className="input" />
              </div>
              <div>
                <label className="label">Capitação diária (L/pessoa/dia)</label>
                <input type="number" step="0.01" min="0" value={dailyFlow} onChange={(e) => setDailyFlow(e.target.value)} className="input" />
              </div>
              <div className="sm:col-span-2">
                <label className="label">Tipo de solo (vala de infiltração)</label>
                <select value={soilType} onChange={(e) => setSoilType(e.target.value as SoilType)} className="input">
                  {(Object.keys(SOIL_TYPE_LABELS) as SoilType[]).map((s) => (
                    <option key={s} value={s}>
                      {SOIL_TYPE_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {fossaResult && (
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="w-full text-sm">
                  <tbody>
                    <tr className="table-row bg-brand-50/60">
                      <td className="py-2 px-4 font-medium">Volume útil da fossa séptica</td>
                      <td className="text-right pr-4 tabular-nums font-semibold">{fmt(fossaResult.volumeM3)} m³</td>
                    </tr>
                    <tr className="table-row">
                      <td className="py-2 px-4">Nº de câmaras/compartimentos recomendado</td>
                      <td className="text-right pr-4 tabular-nums">{fossaResult.compartments}</td>
                    </tr>
                    <tr className="table-row">
                      <td className="py-2 px-4">Área de infiltração necessária</td>
                      <td className="text-right pr-4 tabular-nums">
                        {fossaResult.infiltrationAreaM2 === null ? "Sem solução por infiltração simples (argila compacta)" : `${fmt(fossaResult.infiltrationAreaM2)} m²`}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            <button onClick={handleExportFossa} disabled={!fossaResult || exporting} className="btn btn-primary">
              <IconDownload className="w-4 h-4" />
              {exporting ? "A gerar PDF..." : "Exportar PDF"}
            </button>
          </section>
        )}
      </div>
    </Layout>
  );
}

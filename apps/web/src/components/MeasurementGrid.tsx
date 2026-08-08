import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  measurementLinesApi,
  type MeasurementFormulaType,
  type MeasurementLine,
  type MeasurementLineInput,
  type PlantMeasurementPreview,
} from "../api/measurementLines";

const FORMULAS: Array<{ value: MeasurementFormulaType; label: string }> = [
  { value: "direct", label: "Quantidade directa" },
  { value: "count", label: "Contagem" },
  { value: "length", label: "Comprimento" },
  { value: "area", label: "Área horizontal" },
  { value: "wall_area", label: "Área vertical" },
  { value: "perimeter", label: "Perímetro" },
  { value: "volume", label: "Volume" },
  { value: "section_length", label: "Secção × comprimento" },
  { value: "weight", label: "Peso por comprimento" },
  { value: "reinforcement", label: "Aço por diâmetro" },
  { value: "percentage", label: "Percentagem de base" },
];

function recommended(unit?: string | null): MeasurementFormulaType {
  if (unit === "m2") return "area";
  if (unit === "m3") return "volume";
  if (unit === "m" || unit === "ml") return "length";
  if (unit === "kg") return "weight";
  if (unit === "un") return "count";
  return "direct";
}

function label(type: MeasurementFormulaType) {
  return FORMULAS.find((row) => row.value === type)?.label ?? "Legado";
}
function n(value: string | null | undefined) { return value == null ? "—" : Number(value).toLocaleString("pt-MZ", { maximumFractionDigits: 6 }); }
function location(line: MeasurementLine) {
  return [line.block, line.floor, line.zone, line.room, line.axis, line.element].filter(Boolean).join(" / ") || "—";
}

export default function MeasurementGrid({
  lineItemId,
  itemCode,
  itemUnit,
  hasPlantRooms = false,
  onQuantityChange,
}: {
  lineItemId: string;
  itemCode?: string | null;
  itemUnit?: string | null;
  hasPlantRooms?: boolean;
  onQuantityChange: () => void;
}) {
  const [lines, setLines] = useState<MeasurementLine[]>([]);
  const [history, setHistory] = useState<MeasurementLine[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formulaType, setFormulaType] = useState<MeasurementFormulaType>(recommended(itemUnit));
  const [sign, setSign] = useState<1 | -1>(1);
  const [description, setDescription] = useState("");
  const [count, setCount] = useState("1");
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [directQuantity, setDirectQuantity] = useState("");
  const [coefficient, setCoefficient] = useState("1");
  const [unitWeight, setUnitWeight] = useState("");
  const [diameterMm, setDiameterMm] = useState("");
  const [baseQuantity, setBaseQuantity] = useState("");
  const [percentage, setPercentage] = useState("");
  const [block, setBlock] = useState("");
  const [floor, setFloor] = useState("");
  const [zone, setZone] = useState("");
  const [room, setRoom] = useState("");
  const [axis, setAxis] = useState("");
  const [element, setElement] = useState("");
  const [showLocation, setShowLocation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PlantMeasurementPreview | null>(null);
  const [selectedPreview, setSelectedPreview] = useState<number[]>([]);
  const [working, setWorking] = useState(false);

  async function reload() {
    const active = await measurementLinesApi.list(lineItemId);
    setLines(active);
    if (showHistory) setHistory(await measurementLinesApi.history(lineItemId));
  }
  useEffect(() => { void reload().catch((err) => setError(err.message)); }, [lineItemId]);
  useEffect(() => { setFormulaType(recommended(itemUnit)); }, [itemUnit, lineItemId]);

  const total = useMemo(() => lines.reduce((sum, line) => sum + line.partial, 0), [lines]);
  const additions = useMemo(() => lines.filter((line) => line.partial >= 0).reduce((sum, line) => sum + line.partial, 0), [lines]);
  const deductions = useMemo(() => Math.abs(lines.filter((line) => line.partial < 0).reduce((sum, line) => sum + line.partial, 0)), [lines]);

  function valueOrNull(value: string) { return value.trim() === "" ? null : Number(value); }
  function buildInput(): MeasurementLineInput {
    return {
      description: description.trim(), formulaType, sign,
      count: valueOrNull(count), length: valueOrNull(length), width: valueOrNull(width), height: valueOrNull(height),
      directQuantity: valueOrNull(directQuantity), coefficient: Number(coefficient || 1), unitWeight: valueOrNull(unitWeight), diameterMm: valueOrNull(diameterMm),
      baseQuantity: valueOrNull(baseQuantity), percentage: valueOrNull(percentage),
      block: block || null, floor: floor || null, zone: zone || null, room: room || null, axis: axis || null, element: element || null,
      source: "manual", sortOrder: lines.length,
    };
  }

  function resetForm() {
    setEditingId(null); setDescription(""); setCount("1"); setLength(""); setWidth(""); setHeight("");
    setDirectQuantity(""); setCoefficient("1"); setUnitWeight(""); setDiameterMm(""); setBaseQuantity(""); setPercentage(""); setSign(1);
  }

  function startEdit(line: MeasurementLine) {
    setEditingId(line.id); setFormulaType(line.formulaType); setSign(line.sign < 0 ? -1 : 1); setDescription(line.description ?? "");
    setCount(line.count ?? "1"); setLength(line.length ?? ""); setWidth(line.width ?? ""); setHeight(line.height ?? "");
    setDirectQuantity(line.directQuantity ?? ""); setCoefficient(line.coefficient ?? "1"); setUnitWeight(line.unitWeight ?? "");
    setDiameterMm(line.diameterMm ?? ""); setBaseQuantity(line.baseQuantity ?? ""); setPercentage(line.percentage ?? "");
    setBlock(line.block ?? ""); setFloor(line.floor ?? ""); setZone(line.zone ?? ""); setRoom(line.room ?? ""); setAxis(line.axis ?? ""); setElement(line.element ?? "");
    setShowLocation(Boolean(line.block || line.floor || line.zone || line.room || line.axis || line.element));
  }

  async function toggleHistory() {
    const next = !showHistory; setShowHistory(next);
    if (next) { try { setHistory(await measurementLinesApi.history(lineItemId)); } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível carregar o histórico"); } }
  }

  async function handleAdd(event: FormEvent) {
    event.preventDefault(); setError(null); setWorking(true);
    try {
      if (editingId) await measurementLinesApi.update(editingId, buildInput());
      else await measurementLinesApi.create(lineItemId, buildInput());
      resetForm();
      await reload(); onQuantityChange();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível adicionar a medição"); }
    finally { setWorking(false); }
  }

  async function remove(id: string) {
    setWorking(true); setError(null);
    try { await measurementLinesApi.remove(id); await reload(); onQuantityChange(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível remover a medição"); }
    finally { setWorking(false); }
  }

  async function openPlantPreview() {
    setWorking(true); setError(null);
    try {
      const result = await measurementLinesApi.previewFromPlant(lineItemId);
      setPreview(result); setSelectedPreview(result.lines.map((_, index) => index));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível gerar o preview da planta"); }
    finally { setWorking(false); }
  }

  async function applyPlant(strategy: "replace" | "merge") {
    if (!preview) return;
    setWorking(true); setError(null);
    try {
      await measurementLinesApi.applyFromPlant(lineItemId, { strategy, previewFingerprint: preview.fingerprint, acceptedIndexes: selectedPreview });
      setPreview(null); await reload(); onQuantityChange();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível aplicar o preview"); }
    finally { setWorking(false); }
  }

  const needsCount = !["direct", "percentage"].includes(formulaType);
  const needsLength = ["length", "area", "wall_area", "perimeter", "volume", "section_length", "weight", "reinforcement"].includes(formulaType);
  const needsWidth = ["area", "perimeter", "volume", "section_length"].includes(formulaType);
  const needsHeight = ["wall_area", "volume", "section_length"].includes(formulaType);

  return <div className="mt-2 space-y-3 rounded-xl border border-brand-100 bg-brand-50/40 p-3 text-xs sm:ml-14">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="font-semibold text-brand-950">Memória de cálculo 2.0</p><p className="text-[11px] text-slate-500">Fórmulas tipadas · deduções · localização · rastreabilidade</p><button type="button" className="mt-1 text-[11px] font-semibold text-brand-700 hover:text-brand-900" onClick={() => void toggleHistory()}>{showHistory ? "Ocultar histórico" : "Ver histórico de revisões"}</button></div>
      <div className="grid grid-cols-3 gap-2 text-right"><div><span className="text-slate-400">Adições</span><strong className="block text-emerald-700">{additions.toFixed(4)}</strong></div><div><span className="text-slate-400">Deduções</span><strong className="block text-rose-700">−{deductions.toFixed(4)}</strong></div><div><span className="text-slate-400">Líquido</span><strong className="block text-brand-900">{total.toFixed(4)}</strong></div></div>
    </div>
    {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700">{error}</div>}

    {lines.length > 0 && <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full min-w-[900px] text-xs"><thead><tr className="bg-slate-50 text-left text-slate-500"><th className="px-3 py-2">Tipo</th><th>Descrição / localização</th><th>N.º</th><th>C</th><th>L</th><th>H</th><th className="text-right">Parcial</th><th className="w-10"></th></tr></thead>
      <tbody>{lines.map((line) => <tr key={line.id} className="border-t border-slate-100">
        <td className="px-3 py-2"><span className={`rounded px-1.5 py-0.5 font-semibold ${line.sign < 0 ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-700"}`}>{line.sign < 0 ? "Dedução · " : ""}{label(line.formulaType)}</span></td>
        <td><strong className="text-slate-800">{line.description || "—"}</strong><p className="text-[10px] text-slate-400">{location(line)} · {line.source} · rev. {line.revisionNo}</p></td>
        <td>{n(line.count)}</td><td>{n(line.length)}</td><td>{n(line.width)}</td><td>{n(line.height)}</td>
        <td className={`text-right font-semibold tabular-nums ${line.partial < 0 ? "text-rose-700" : "text-slate-900"}`}>{line.partial.toFixed(6)}</td>
        <td><div className="flex gap-1"><button type="button" disabled={working} onClick={() => startEdit(line)} className="icon-btn" title="Editar criando nova revisão">✎</button><button type="button" disabled={working} onClick={() => void remove(line.id)} className="icon-btn-danger">×</button></div></td>
      </tr>)}</tbody></table>
    </div>}

    {showHistory && <div className="rounded-lg border border-slate-200 bg-white p-3"><div className="mb-2 flex items-center justify-between"><strong className="text-slate-800">Histórico de revisões</strong><span className="text-[10px] text-slate-400">append-only</span></div><div className="max-h-56 overflow-auto space-y-1">{history.map((row) => <div key={row.id} className={`grid grid-cols-[70px_1fr_100px] gap-2 rounded px-2 py-1.5 ${row.isActive ? "bg-emerald-50" : "bg-slate-50 text-slate-500"}`}><span>rev. {row.revisionNo}{row.isActive ? " · activa" : ""}</span><span className="truncate">{row.description || label(row.formulaType)} · {location(row)}</span><strong className="text-right tabular-nums">{row.partial.toFixed(6)}</strong></div>)}</div></div>}

    <form onSubmit={handleAdd} className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
      {editingId && <div className="flex items-center justify-between rounded-lg bg-amber-50 px-3 py-2 text-amber-800"><span><strong>A editar linha.</strong> Guardar cria uma nova revisão; a anterior permanece no histórico.</span><button type="button" className="btn btn-ghost btn-sm" onClick={resetForm}>Cancelar edição</button></div>}
      <div className="grid gap-2 md:grid-cols-[180px_110px_1fr]">
        <label><span className="label">Fórmula</span><select className="input input-sm w-full" value={formulaType} onChange={(e) => setFormulaType(e.target.value as MeasurementFormulaType)}>{FORMULAS.map((row) => <option key={row.value} value={row.value}>{row.label}</option>)}</select></label>
        <label><span className="label">Natureza</span><select className="input input-sm w-full" value={sign} onChange={(e) => setSign(Number(e.target.value) as 1 | -1)}><option value={1}>Adição (+)</option><option value={-1}>Dedução (−)</option></select></label>
        <label><span className="label">Descrição</span><input className="input input-sm w-full" placeholder="Ex.: Parede eixo A/1–A/5, Porta P01" value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      </div>
      <div className="flex flex-wrap gap-2 items-end">
        {needsCount && <label><span className="label">N.º</span><input className="input input-sm w-24" type="number" min="0.000001" step="0.000001" value={count} onChange={(e) => setCount(e.target.value)} /></label>}
        {needsLength && <label><span className="label">Comp. (m)</span><input className="input input-sm w-28" type="number" min="0" step="0.000001" value={length} onChange={(e) => setLength(e.target.value)} /></label>}
        {needsWidth && <label><span className="label">Larg. (m)</span><input className="input input-sm w-28" type="number" min="0" step="0.000001" value={width} onChange={(e) => setWidth(e.target.value)} /></label>}
        {needsHeight && <label><span className="label">Alt. (m)</span><input className="input input-sm w-28" type="number" min="0" step="0.000001" value={height} onChange={(e) => setHeight(e.target.value)} /></label>}
        {formulaType === "direct" && <label><span className="label">Quantidade</span><input className="input input-sm w-32" type="number" min="0" step="0.000001" value={directQuantity} onChange={(e) => setDirectQuantity(e.target.value)} /></label>}
        {formulaType === "weight" && <label><span className="label">kg/m</span><input className="input input-sm w-28" type="number" min="0" step="0.000001" value={unitWeight} onChange={(e) => setUnitWeight(e.target.value)} /></label>}
        {formulaType === "reinforcement" && <label><span className="label">Ø (mm)</span><input className="input input-sm w-28" type="number" min="0" step="0.1" value={diameterMm} onChange={(e) => setDiameterMm(e.target.value)} /></label>}
        {formulaType === "percentage" && <><label><span className="label">Base</span><input className="input input-sm w-28" type="number" min="0" step="0.000001" value={baseQuantity} onChange={(e) => setBaseQuantity(e.target.value)} /></label><label><span className="label">%</span><input className="input input-sm w-24" type="number" min="0" step="0.001" value={percentage} onChange={(e) => setPercentage(e.target.value)} /></label></>}
        <label><span className="label">Coef.</span><input className="input input-sm w-24" type="number" min="0" step="0.000001" value={coefficient} onChange={(e) => setCoefficient(e.target.value)} /></label>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowLocation((value) => !value)}>{showLocation ? "Ocultar localização" : "+ Localização"}</button>
        <button type="submit" disabled={working} className="btn btn-primary btn-sm">{editingId ? "Guardar nova revisão" : "Adicionar medição"}</button>
      </div>
      {showLocation && <div className="grid gap-2 border-t border-slate-100 pt-3 sm:grid-cols-2 lg:grid-cols-6">{[
        ["Bloco", block, setBlock], ["Piso", floor, setFloor], ["Zona", zone, setZone], ["Compartimento", room, setRoom], ["Eixo", axis, setAxis], ["Elemento", element, setElement],
      ].map(([caption, value, setter]) => <label key={String(caption)}><span className="label">{caption as string}</span><input className="input input-sm w-full" value={value as string} onChange={(e) => (setter as (v: string) => void)(e.target.value)} /></label>)}</div>}
    </form>

    {hasPlantRooms && itemCode && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><strong className="text-emerald-900">Medição a partir da planta</strong><p className="text-[11px] text-emerald-700">Nunca substitui a memória sem preview e confirmação.</p></div><button type="button" disabled={working} className="btn btn-secondary btn-sm" onClick={() => void openPlantPreview()}>Gerar preview</button></div>
      {preview && <div className="mt-3 space-y-2"><div className="max-h-64 overflow-auto rounded border border-emerald-200 bg-white">{preview.lines.map((line, index) => <label key={index} className="flex cursor-pointer items-start gap-2 border-b border-slate-100 px-3 py-2 last:border-0"><input type="checkbox" checked={selectedPreview.includes(index)} onChange={(e) => setSelectedPreview((current) => e.target.checked ? [...current, index] : current.filter((value) => value !== index))} /><span className="flex-1"><strong>{line.description || `Linha ${index + 1}`}</strong><span className="ml-2 text-slate-500">{line.expression} = {line.partial.toFixed(6)}</span></span></label>)}</div><div className="flex flex-wrap justify-end gap-2"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setPreview(null)}>Cancelar</button><button type="button" className="btn btn-secondary btn-sm" disabled={!selectedPreview.length || working} onClick={() => void applyPlant("merge")}>Adicionar às actuais</button><button type="button" className="btn btn-primary btn-sm" disabled={!selectedPreview.length || working} onClick={() => void applyPlant("replace")}>Substituir após confirmação</button></div></div>}
    </div>}
  </div>;
}

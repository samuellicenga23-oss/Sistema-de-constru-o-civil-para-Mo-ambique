import { useEffect, useMemo, useState } from "react";
import { catalogApi, type CostComposition } from "../api/catalog";
import {
  compositionTechnicalV2Api,
  type CompositionTechnicalV2Detail,
  type DerivedCostLineV2,
  type MeasurementFormulaType,
  type SubcompositionLineV2,
} from "../api/compositionTechnicalV2";

const FORMULAS: Array<[MeasurementFormulaType, string]> = [
  ["direct", "Quantidade directa"], ["count", "Contagem"], ["length", "Comprimento"],
  ["area", "Área horizontal"], ["wall_area", "Área vertical"], ["perimeter", "Perímetro"],
  ["volume", "Volume"], ["section_length", "Secção × comprimento"], ["weight", "Peso"],
  ["reinforcement", "Aço / varão"], ["percentage", "Percentagem"],
];
const BASIS: Array<[DerivedCostLineV2["basis"], string]> = [
  ["materials", "Materiais"], ["labour", "Mão-de-obra"], ["equipment", "Equipamento"],
  ["subcompositions", "Subcomposições"], ["direct", "Custo directo"],
];
function numberOrNull(value: string) { const n = Number(value); return value.trim() && Number.isFinite(n) && n > 0 ? n : null; }
function money(value: number) { return value.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export default function CompositionTechnicalV2Panel({
  compositionId,
  onChanged,
  onCompositionIdChange,
}: {
  compositionId: string;
  onChanged?: () => void;
  /** Quando o backend cria cópia pessoal, o id muda. */
  onCompositionIdChange?: (nextId: string) => void;
}) {
  const [detail, setDetail] = useState<CompositionTechnicalV2Detail | null>(null);
  const [options, setOptions] = useState<CostComposition[]>([]);
  const [crew, setCrew] = useState("");
  const [hours, setHours] = useState("8");
  const [output, setOutput] = useState("");
  const [source, setSource] = useState("");
  const [notes, setNotes] = useState("");
  const [formula, setFormula] = useState<MeasurementFormulaType | "">("");
  const [subs, setSubs] = useState<SubcompositionLineV2[]>([]);
  const [derived, setDerived] = useState<DerivedCostLineV2[]>([]);
  const [newSub, setNewSub] = useState("");
  const [newSubQty, setNewSubQty] = useState("1");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function reload() {
    const [d, all] = await Promise.all([compositionTechnicalV2Api.get(compositionId), catalogApi.listCompositions()]);
    setDetail(d);
    setOptions(all.filter((row) => row.id !== compositionId));
    setCrew(d.crewSize ? String(d.crewSize) : "");
    setHours(d.productiveHoursPerDay ? String(d.productiveHoursPerDay) : "8");
    setOutput(d.outputPerDay ? String(d.outputPerDay) : "");
    setSource(d.productivitySource ?? "");
    setNotes(d.productivityNotes ?? "");
    setFormula(d.defaultMeasurementFormula ?? "");
    setSubs(d.subcompositionLines ?? []);
    setDerived(d.derivedCostLines ?? []);
  }
  useEffect(() => { void reload().catch((cause) => setError(cause instanceof Error ? cause.message : "Erro ao carregar APU 2.0")); }, [compositionId]);

  const availableSubs = useMemo(() => options.filter((o) => !subs.some((s) => s.refId === o.id)), [options, subs]);
  function addSub() {
    const option = options.find((row) => row.id === newSub); const qty = Number(newSubQty);
    if (!option || !(qty > 0)) return;
    setSubs((current) => [...current, { refId: option.id, qtyPerUnit: qty, name: option.name, outputUnit: option.outputUnit }]);
    setNewSub(""); setNewSubQty("1");
  }
  function addDerived() { setDerived((current) => [...current, { name: "Pequenas ferramentas", basis: "labour", percentage: 3 }]); }

  async function save() {
    setSaving(true); setError(null); setMessage(null);
    try {
      const updated = await compositionTechnicalV2Api.update(compositionId, {
        crewSize: crew ? Math.max(1, Math.round(Number(crew))) : null,
        productiveHoursPerDay: numberOrNull(hours),
        outputPerDay: numberOrNull(output),
        productivitySource: source.trim() || null,
        productivityNotes: notes.trim() || null,
        defaultMeasurementFormula: formula || null,
        subcompositionLines: subs.map((row) => ({ refId: row.refId, qtyPerUnit: Number(row.qtyPerUnit), notes: row.notes ?? null })),
        derivedCostLines: derived.map((row) => ({ name: row.name.trim(), basis: row.basis, percentage: Number(row.percentage), notes: row.notes ?? null })),
      });
      if (updated.id && updated.id !== compositionId) {
        // A página pai navega e mostra o aviso de cópia pessoal.
        onCompositionIdChange?.(updated.id);
        onChanged?.();
        return;
      }
      setDetail(updated);
      setMessage("Composição actualizada. Parâmetros técnicos guardados e APU recalculada.");
      await reload(); onChanged?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível guardar APU 2.0"); }
    finally { setSaving(false); }
  }

  if (!detail) return <section className="card card-pad"><p className="text-sm text-slate-500">A carregar parâmetros técnicos…</p></section>;
  return <section className="card overflow-hidden">
    <div className="border-b border-slate-200 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="section-title">APU 2.0 · Produção e dependências</h2><p className="mt-1 text-xs text-slate-500">Produtividade explícita, subcomposições reutilizáveis e custos técnicos derivados. Margem, estaleiro e IVA continuam no orçamento.</p></div>
        <span className="badge badge-brand">{money(detail.unitCost)} MZN / unidade</span>
      </div>
    </div>
    <div className="space-y-5 p-5">
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div>}

      <div>
        <h3 className="text-sm font-semibold text-slate-900">Produtividade da equipa</h3>
        <div className="mt-2 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label><span className="label">Equipa (pessoas)</span><input className="input" type="number" min="1" step="1" value={crew} onChange={(e) => setCrew(e.target.value)} placeholder="ex: 4" /></label>
          <label><span className="label">Horas produtivas/dia</span><input className="input" type="number" min="0.1" max="24" step="0.1" value={hours} onChange={(e) => setHours(e.target.value)} /></label>
          <label><span className="label">Produção/dia</span><input className="input" type="number" min="0" step="0.01" value={output} onChange={(e) => setOutput(e.target.value)} placeholder={detail.derivedOutputPerDay ? `derivado: ${detail.derivedOutputPerDay.toFixed(2)}` : "opcional"} /></label>
          <label><span className="label">Fórmula de medição</span><select className="input" value={formula} onChange={(e) => setFormula(e.target.value as MeasurementFormulaType | "")}><option value="">Automática pela unidade</option>{FORMULAS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label><span className="label">Fonte produtividade</span><input className="input" value={source} onChange={(e) => setSource(e.target.value)} placeholder="obra, ficha técnica, histórico…" /></label>
        </div>
        <textarea className="input mt-3 min-h-20" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Condições da produtividade: composição da equipa, acessos, altura, método executivo, limitações…" />
        <p className="mt-2 text-xs text-slate-500">Base activa: <strong>{detail.productivityBasis ?? "horas de mão-de-obra / fallback"}</strong>{detail.derivedOutputPerDay ? ` · produção derivada ${detail.derivedOutputPerDay.toLocaleString("pt-MZ")} un/dia` : ""}.</p>
      </div>

      <div className="border-t border-slate-100 pt-5">
        <div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold text-slate-900">Subcomposições</h3><p className="text-xs text-slate-500">Reutilize APU técnicas sem repetir cimento, areia, mão-de-obra ou equipamento.</p></div><strong className="text-sm tabular-nums">{money(detail.subcompositionCost)} MZN</strong></div>
        <div className="mt-3 space-y-2">{subs.map((row, index) => <div key={`${row.refId}-${index}`} className="grid gap-2 rounded-lg border border-slate-200 p-3 md:grid-cols-[1fr_150px_40px] md:items-center"><div><strong className="text-sm">{row.name ?? options.find((o) => o.id === row.refId)?.name ?? row.refId}</strong><p className="text-xs text-slate-500">por unidade da composição principal</p></div><input className="input" type="number" min="0.000001" step="0.000001" value={String(row.qtyPerUnit)} onChange={(e) => setSubs((current) => current.map((x, i) => i === index ? { ...x, qtyPerUnit: e.target.value } : x))}/><button className="btn btn-ghost" type="button" onClick={() => setSubs((current) => current.filter((_, i) => i !== index))}>×</button></div>)}</div>
        {availableSubs.length > 0 && <div className="mt-3 grid gap-2 md:grid-cols-[1fr_150px_auto]"><select className="input" value={newSub} onChange={(e) => setNewSub(e.target.value)}><option value="">— adicionar subcomposição —</option>{availableSubs.map((row) => <option key={row.id} value={row.id}>{row.name} · {row.outputUnit}</option>)}</select><input className="input" type="number" min="0.000001" step="0.000001" value={newSubQty} onChange={(e) => setNewSubQty(e.target.value)}/><button className="btn btn-secondary" type="button" onClick={addSub}>Adicionar</button></div>}
      </div>

      <div className="border-t border-slate-100 pt-5">
        <div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold text-slate-900">Custos técnicos derivados</h3><p className="text-xs text-slate-500">Ex.: pequenas ferramentas = 3% da mão-de-obra. Não use aqui margem, indirectos gerais ou IVA.</p></div><strong className="text-sm tabular-nums">{money(detail.derivedCost)} MZN</strong></div>
        <div className="mt-3 space-y-2">{derived.map((row, index) => <div key={row.id ?? index} className="grid gap-2 rounded-lg border border-slate-200 p-3 md:grid-cols-[1fr_190px_120px_40px]"><input className="input" value={row.name} onChange={(e) => setDerived((current) => current.map((x, i) => i === index ? { ...x, name: e.target.value } : x))}/><select className="input" value={row.basis} onChange={(e) => setDerived((current) => current.map((x, i) => i === index ? { ...x, basis: e.target.value as DerivedCostLineV2["basis"] } : x))}>{BASIS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><div className="flex items-center gap-1"><input className="input" type="number" min="0" max="1000" step="0.01" value={String(row.percentage)} onChange={(e) => setDerived((current) => current.map((x, i) => i === index ? { ...x, percentage: e.target.value } : x))}/><span className="text-sm text-slate-500">%</span></div><button className="btn btn-ghost" type="button" onClick={() => setDerived((current) => current.filter((_, i) => i !== index))}>×</button></div>)}</div>
        <button className="btn btn-secondary btn-sm mt-3" type="button" onClick={addDerived}>+ Custo derivado</button>
      </div>

      <div className="border-t border-slate-100 pt-5">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6 text-xs"><div className="rounded-lg bg-slate-50 p-3"><span className="text-slate-500">Materiais</span><strong className="block mt-1">{money(detail.materialCost)}</strong></div><div className="rounded-lg bg-slate-50 p-3"><span className="text-slate-500">Mão-de-obra</span><strong className="block mt-1">{money(detail.labourCost)}</strong></div><div className="rounded-lg bg-slate-50 p-3"><span className="text-slate-500">Equipamento</span><strong className="block mt-1">{money(detail.equipmentCost)}</strong></div><div className="rounded-lg bg-slate-50 p-3"><span className="text-slate-500">Subcomposições</span><strong className="block mt-1">{money(detail.subcompositionCost)}</strong></div><div className="rounded-lg bg-slate-50 p-3"><span className="text-slate-500">Derivados</span><strong className="block mt-1">{money(detail.derivedCost)}</strong></div><div className="rounded-lg bg-slate-950 p-3 text-white"><span className="text-slate-300">Custo directo</span><strong className="block mt-1">{money(detail.directCost)}</strong></div></div>
        <div className="mt-4 flex justify-end"><button type="button" className="btn btn-primary" disabled={saving || derived.some((row) => !row.name.trim() || Number(row.percentage) < 0) || subs.some((row) => !(Number(row.qtyPerUnit) > 0))} onClick={() => void save()}>{saving ? "A guardar…" : "Guardar APU 2.0"}</button></div>
      </div>
    </div>
  </section>;
}

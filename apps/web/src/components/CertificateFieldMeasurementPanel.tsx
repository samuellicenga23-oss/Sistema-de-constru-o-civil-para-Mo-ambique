import { useEffect, useMemo, useState } from "react";
import { certificateFieldApi, type CertificateFieldInput, type CertificateFieldLine } from "../api/certificateFieldMeasurements";
import type { MeasurementFormulaType } from "../api/measurementLines";

const FORMULAS: Array<[MeasurementFormulaType, string]> = [
  ["direct", "Qtd. directa"], ["count", "Contagem"], ["length", "Comprimento"], ["area", "Área"], ["wall_area", "Área vertical"],
  ["perimeter", "Perímetro"], ["volume", "Volume"], ["section_length", "Secção × comp."], ["weight", "Peso"], ["reinforcement", "Aço"], ["percentage", "% de base"],
];
function recommended(unit: string | null): MeasurementFormulaType {
  return unit === "m2" ? "area" : unit === "m3" ? "volume" : unit === "m" || unit === "ml" ? "length" : unit === "kg" ? "weight" : unit === "un" ? "count" : "direct";
}
function value(v: string) { return v.trim() ? Number(v) : null; }
function loc(row: CertificateFieldLine) {
  return [row.block, row.floor, row.zone, row.room, row.axis, row.element].filter(Boolean).join(" / ") || "—";
}

export default function CertificateFieldMeasurementPanel({
  certificateLineId,
  unit,
  locked,
  overrunReason,
  onChanged,
  onFieldMemoryChange,
}: {
  certificateLineId: string;
  unit: string | null;
  locked: boolean;
  overrunReason?: string | null;
  onChanged: () => void;
  onFieldMemoryChange?: (hasActive: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<CertificateFieldLine[]>([]);
  const [history, setHistory] = useState(false);
  const [formula, setFormula] = useState<MeasurementFormulaType>(recommended(unit));
  const [sign, setSign] = useState<1 | -1>(1);
  const [description, setDescription] = useState("");
  const [count, setCount] = useState("1");
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [direct, setDirect] = useState("");
  const [unitWeight, setUnitWeight] = useState("");
  const [diameter, setDiameter] = useState("");
  const [base, setBase] = useState("");
  const [pct, setPct] = useState("");
  const [block, setBlock] = useState("");
  const [floor, setFloor] = useState("");
  const [zone, setZone] = useState("");
  const [room, setRoom] = useState("");
  const [axis, setAxis] = useState("");
  const [element, setElement] = useState("");
  const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload(showHistory = history) {
    const next = await certificateFieldApi.list(certificateLineId, showHistory);
    setRows(next);
    onFieldMemoryChange?.(next.some((row) => row.isActive));
  }

  useEffect(() => {
    if (open) void reload().catch((e) => setError(e instanceof Error ? e.message : "Erro ao carregar memória"));
  }, [open, certificateLineId]);

  const total = useMemo(() => rows.filter((r) => r.isActive).reduce((s, r) => s + r.partial, 0), [rows]);
  const activeCount = rows.filter((r) => r.isActive).length;

  async function toggleHistory() {
    const next = !history;
    setHistory(next);
    try { await reload(next); }
    catch (e) { setError(e instanceof Error ? e.message : "Erro ao carregar histórico"); }
  }

  async function add() {
    setBusy(true); setError(null);
    try {
      const data: CertificateFieldInput = {
        description: description.trim(), formulaType: formula, sign,
        count: value(count), length: value(length), width: value(width), height: value(height),
        directQuantity: value(direct), unitWeight: value(unitWeight), diameterMm: value(diameter),
        baseQuantity: value(base), percentage: value(pct),
        block: block || null, floor: floor || null, zone: zone || null, room: room || null, axis: axis || null, element: element || null,
        evidenceUrls: evidence.split("\n").map((x) => x.trim()).filter(Boolean),
        overrunReason: overrunReason || null,
        sortOrder: rows.filter((r) => r.isActive).length,
      };
      await certificateFieldApi.create(certificateLineId, data);
      setDescription(""); setCount("1"); setLength(""); setWidth(""); setHeight(""); setDirect("");
      setUnitWeight(""); setDiameter(""); setBase(""); setPct(""); setEvidence("");
      await reload(); onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao registar medição");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try { await certificateFieldApi.remove(id); await reload(); onChanged(); }
    catch (e) { setError(e instanceof Error ? e.message : "Erro ao remover"); }
    finally { setBusy(false); }
  }

  const needCount = !["direct", "percentage"].includes(formula);
  const needL = ["length", "area", "wall_area", "perimeter", "volume", "section_length", "weight", "reinforcement"].includes(formula);
  const needW = ["area", "perimeter", "volume", "section_length"].includes(formula);
  const needH = ["wall_area", "volume", "section_length"].includes(formula);

  return (
    <span className="mt-2 block">
      <button type="button" className="text-[11px] font-semibold text-brand-700 hover:text-brand-900" onClick={() => setOpen((v) => !v)}>
        {open ? "Fechar memória de campo" : `Memória de campo${activeCount ? ` · ${total.toFixed(4)}` : ""}`}
      </button>
      {activeCount > 0 && !open && (
        <span className="mt-1 block text-[10px] font-medium text-amber-800">
          Quantidade do período controlada pela folha de campo ({activeCount} linha{activeCount === 1 ? "" : "s"}).
        </span>
      )}
      {open && (
        <span className="mt-2 space-y-2 rounded-lg border border-brand-100 bg-brand-50/50 p-2">
          <span className="flex items-center justify-between">
            <strong className="text-[11px] text-brand-950">Folha de medição do período</strong>
            <button type="button" className="text-[10px] font-semibold text-slate-500" onClick={() => void toggleHistory()}>
              {history ? "Só activas" : "Histórico"}
            </button>
          </span>
          {error && <p className="rounded bg-red-50 px-2 py-1 text-[11px] text-red-700">{error}</p>}
          {rows.length > 0 && (
            <span className="max-h-48 overflow-auto rounded border border-slate-200 bg-white">
              {rows.map((r) => (
                <span key={r.id} className={`grid grid-cols-[55px_1fr_82px_24px] gap-2 border-b border-slate-100 px-2 py-1.5 text-[10px] ${r.isActive ? "" : "bg-slate-50 text-slate-400"}`}>
                  <span>rev.{r.revisionNo}{r.sign < 0 ? " · −" : ""}</span>
                  <span className="truncate"><strong>{r.description || r.formulaType}</strong> · {loc(r)}{r.evidenceUrls?.length ? ` · ${r.evidenceUrls.length} evid.` : ""}</span>
                  <strong className="text-right tabular-nums">{r.partial.toFixed(4)}</strong>
                  {!locked && r.isActive ? <button type="button" disabled={busy} onClick={() => void remove(r.id)} className="text-red-600">×</button> : <span />}
                </span>
              ))}
            </span>
          )}
          {!locked && (
            <span className="space-y-2 rounded border border-slate-200 bg-white p-2">
              <span className="grid gap-1 sm:grid-cols-[125px_80px_1fr]">
                <select className="input input-sm" value={formula} onChange={(e) => setFormula(e.target.value as MeasurementFormulaType)}>
                  {FORMULAS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <select className="input input-sm" value={sign} onChange={(e) => setSign(Number(e.target.value) as 1 | -1)}>
                  <option value={1}>+ Adição</option>
                  <option value={-1}>− Dedução</option>
                </select>
                <input className="input input-sm" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Local/trabalho medido" />
              </span>
              <span className="flex flex-wrap items-end gap-1">
                {needCount && <input className="input input-sm w-16" type="number" min="0.000001" step="0.000001" value={count} onChange={(e) => setCount(e.target.value)} placeholder="Nº" />}
                {needL && <input className="input input-sm w-20" type="number" min="0" step="0.000001" value={length} onChange={(e) => setLength(e.target.value)} placeholder="Comp." />}
                {needW && <input className="input input-sm w-20" type="number" min="0" step="0.000001" value={width} onChange={(e) => setWidth(e.target.value)} placeholder="Larg." />}
                {needH && <input className="input input-sm w-20" type="number" min="0" step="0.000001" value={height} onChange={(e) => setHeight(e.target.value)} placeholder="Alt." />}
                {formula === "direct" && <input className="input input-sm w-24" type="number" min="0" step="0.000001" value={direct} onChange={(e) => setDirect(e.target.value)} placeholder="Qtd." />}
                {formula === "weight" && <input className="input input-sm w-20" type="number" min="0" value={unitWeight} onChange={(e) => setUnitWeight(e.target.value)} placeholder="kg/m" />}
                {formula === "reinforcement" && <input className="input input-sm w-20" type="number" min="0" value={diameter} onChange={(e) => setDiameter(e.target.value)} placeholder="Ø mm" />}
                {formula === "percentage" && (
                  <>
                    <input className="input input-sm w-20" type="number" min="0" value={base} onChange={(e) => setBase(e.target.value)} placeholder="Base" />
                    <input className="input input-sm w-20" type="number" min="0" value={pct} onChange={(e) => setPct(e.target.value)} placeholder="%" />
                  </>
                )}
                <button type="button" disabled={busy} className="btn btn-primary btn-sm" onClick={() => void add()}>Registar</button>
              </span>
              <span className="grid gap-1 sm:grid-cols-3 lg:grid-cols-6">
                <input className="input input-sm" value={block} onChange={(e) => setBlock(e.target.value)} placeholder="Bloco" />
                <input className="input input-sm" value={floor} onChange={(e) => setFloor(e.target.value)} placeholder="Piso" />
                <input className="input input-sm" value={zone} onChange={(e) => setZone(e.target.value)} placeholder="Zona" />
                <input className="input input-sm" value={room} onChange={(e) => setRoom(e.target.value)} placeholder="Compartimento" />
                <input className="input input-sm" value={axis} onChange={(e) => setAxis(e.target.value)} placeholder="Eixo" />
                <input className="input input-sm" value={element} onChange={(e) => setElement(e.target.value)} placeholder="Elemento" />
              </span>
              <textarea className="input min-h-12 text-[10px]" value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="Referências/evidências — uma por linha (foto do Diário, documento, URL interna…)" />
            </span>
          )}
          <span className="flex justify-end text-[10px]">
            <span className="text-slate-500">Total líquido do período:</span>
            <strong className="ml-2 tabular-nums text-brand-900">{total.toFixed(4)} {unit ?? ""}</strong>
          </span>
        </span>
      )}
    </span>
  );
}

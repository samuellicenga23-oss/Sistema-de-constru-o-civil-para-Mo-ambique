import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { measurementApi, type MeasurementCertificateDetail, type MeasurementLine } from "../api/measurement";
import Layout from "../components/Layout";
import { useConfirmDialog } from "../hooks/useConfirmDialog";
import LabourByPhaseModal from "../components/LabourByPhaseModal";
import { IconBack, IconClipboard } from "../components/icons";

function number(value: number) { return value.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function money(value: number) { return value.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
const STATUS_LABEL = { rascunho: "Em preparação", submetido: "Em fiscalização", aprovado: "Aprovado" } as const;

export default function MeasurementCertificatePage() {
  const { confirm, dialog } = useConfirmDialog();
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<MeasurementCertificateDetail | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { periodQty: string; notes: string; overrunReason: string }>>({});
  const [savingLine, setSavingLine] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showLabour, setShowLabour] = useState(false);

  async function reload() {
    if (!id) return;
    const next = await measurementApi.detail(id);
    setData(next);
    setDrafts(Object.fromEntries(next.lines.map((line) => [line.id, { periodQty: String(line.periodQty || ""), notes: line.notes ?? "", overrunReason: line.overrunReason ?? "" }])));
  }
  useEffect(() => { reload().catch((cause) => setError(cause instanceof Error ? cause.message : "Erro ao carregar auto")); }, [id]);

  async function saveLine(line: MeasurementLine) {
    const draft = drafts[line.id];
    if (!draft) return;
    const periodQty = Number(draft.periodQty || 0);
    const willOverrun = line.budgetedQty !== null && line.previousQty + periodQty > line.budgetedQty + 0.0001;
    if (willOverrun && !draft.overrunReason.trim()) { setError(`O item ${line.code ?? ""} ultrapassa o contratado. Indique a justificação do trabalho adicional.`); return; }
    setSavingLine(line.id); setError(null);
    try { await measurementApi.updateLine(line.id, { periodQty, notes: draft.notes || null, overrunReason: draft.overrunReason || null }); await reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao guardar medição"); }
    finally { setSavingLine(null); }
  }

  async function changeStatus(status: "rascunho" | "submetido" | "aprovado") {
    if (!id) return;
    let decisionNote: string | undefined;
    if (status === "rascunho") { decisionNote = window.prompt("Motivo da devolução para correcção:")?.trim(); if (!decisionNote) return; }
    const confirmOpts =
      status === "aprovado"
        ? {
            title: "Aprovar auto?",
            message: "Aprovar este auto de medição?",
            confirmLabel: "Aprovar",
            details: ["Será criada uma factura em rascunho para emissão", "O progresso actualizará o cronograma"],
          }
        : status === "submetido"
          ? {
              title: "Submeter à fiscalização?",
              message: "Submeter este auto à fiscalização?",
              confirmLabel: "Submeter",
              details: ["As quantidades ficam bloqueadas até eventual devolução"],
            }
          : null;
    if (confirmOpts && !(await confirm(confirmOpts))) return;
    setBusy(true); setError(null);
    try { await measurementApi.updateStatus(id, status, decisionNote); await reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao alterar estado"); }
    finally { setBusy(false); }
  }

  async function saveAllDirty() {
    if (!data || data.certificate.status !== "rascunho") return;
    const toSave = data.lines.filter((line) => {
      const draft = drafts[line.id];
      if (!draft) return false;
      const qty = Number(draft.periodQty || 0);
      return qty !== line.periodQty || (draft.notes || "") !== (line.notes ?? "") || (draft.overrunReason || "") !== (line.overrunReason ?? "");
    });
    if (toSave.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      for (const line of toSave) {
        const draft = drafts[line.id]!;
        const periodQty = Number(draft.periodQty || 0);
        const willOverrun = line.budgetedQty !== null && line.previousQty + periodQty > line.budgetedQty + 0.0001;
        if (willOverrun && !draft.overrunReason.trim()) {
          setError(`O item ${line.code ?? ""} ultrapassa o contratado. Indique a justificação.`);
          return;
        }
        await measurementApi.updateLine(line.id, { periodQty, notes: draft.notes || null, overrunReason: draft.overrunReason || null });
      }
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Erro ao guardar medições");
    } finally {
      setBusy(false);
    }
  }

  const dirtyLineIds = useMemo(() => {
    if (!data || data.certificate.status !== "rascunho") return [] as string[];
    return data.lines.filter((line) => {
      const draft = drafts[line.id];
      if (!draft) return false;
      const qty = Number(draft.periodQty || 0);
      return qty !== line.periodQty || (draft.notes || "") !== (line.notes ?? "") || (draft.overrunReason || "") !== (line.overrunReason ?? "");
    }).map((l) => l.id);
  }, [data, drafts]);

  const grouped = useMemo(() => {
    const map = new Map<string, MeasurementLine[]>();
    for (const line of data?.lines ?? []) map.set(line.sectionName, [...(map.get(line.sectionName) ?? []), line]);
    return Array.from(map.entries());
  }, [data]);
  if (!data) return <div className="min-h-screen grid place-items-center text-slate-400">A carregar auto de medição...</div>;

  const { certificate, lines } = data;
  const locked = certificate.status !== "rascunho";
  const contractValue = lines.reduce((sum, line) => sum + (line.budgetedQty ?? 0) * line.unitPrice, 0);
  const periodValue = lines.reduce((sum, line) => sum + line.periodValue, 0);
  const cumulativeValue = lines.reduce((sum, line) => sum + line.cumulativeValue, 0);
  const siteCostsRate = data.financialParameters.siteCostsRate;
  const indirectCostsRate = data.financialParameters.indirectCostsRate;
  const contingenciesRate = data.financialParameters.contingenciasRate;
  const profitMarginRate = data.financialParameters.profitMarginRate;
  const ivaRate = data.financialParameters.ivaRate;
  const totalWithRates = (base: number) => {
    const withCharges = base + base * siteCostsRate + base * indirectCostsRate;
    const withMargin = withCharges + withCharges * profitMarginRate;
    const withContingencies = withMargin + withMargin * contingenciesRate;
    return withContingencies + withContingencies * ivaRate;
  };
  const periodSiteCosts = periodValue * siteCostsRate;
  const periodIndirectCosts = periodValue * indirectCostsRate;
  const periodProfitBase = periodValue + periodSiteCosts + periodIndirectCosts;
  const periodProfit = periodProfitBase * profitMarginRate;
  const periodSellingSubtotal = periodProfitBase + periodProfit;
  const periodContingencies = periodSellingSubtotal * contingenciesRate;
  const periodTaxable = periodSellingSubtotal + periodContingencies;
  const periodIva = periodTaxable * ivaRate;
  const periodTotal = periodTaxable + periodIva;
  const cumulativeTotal = totalWithRates(cumulativeValue);
  const contractTotal = totalWithRates(contractValue);
  const progress = contractValue > 0 ? cumulativeValue / contractValue * 100 : 0;
  const measuredItems = lines.filter((line) => line.periodQty > 0).length;
  const overruns = lines.filter((line) => line.hasOverrun).length;

  return (<><Layout title={`Auto de Medição n.º ${certificate.number}`} subtitle={`${certificate.periodStartDate ? `${certificate.periodStartDate} — ` : "Até "}${certificate.periodDate} · ${STATUS_LABEL[certificate.status]}`} actions={<><button type="button" onClick={() => setShowLabour(true)} className="btn btn-secondary btn-sm"><IconClipboard className="h-4 w-4" /> Mão de obra por fase</button>{!locked && dirtyLineIds.length > 0 && <button type="button" disabled={busy} onClick={saveAllDirty} className="btn btn-primary btn-sm">Guardar {dirtyLineIds.length} alteração(ões)</button>}<Link to={`/projectos/${certificate.projectId}`} className="btn btn-ghost btn-sm"><IconBack className="h-4 w-4" /> Projecto</Link></>}>
    <div className="mx-auto w-full max-w-[1500px] space-y-5">
      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <section className="card card-pad">
        <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-center"><div><div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500"><span className={`h-2.5 w-2.5 rounded-full ${certificate.status === "aprovado" ? "bg-emerald-500" : certificate.status === "submetido" ? "bg-blue-500" : "bg-amber-500"}`} />{STATUS_LABEL[certificate.status]}</div><h2 className="text-xl font-semibold text-slate-950">Medição do período, não o acumulado</h2><p className="mt-1 max-w-3xl text-sm text-slate-500">Introduza apenas o executado neste período. O SIGO soma o auto anterior, controla o saldo contratado e exige justificação quando existe trabalho adicional.</p></div><div className="flex items-center gap-1 text-xs font-semibold"><span className="rounded-full bg-emerald-100 px-3 py-1.5 text-emerald-800">1 Preparar</span><span className="h-px w-6 bg-slate-300" /><span className={`rounded-full px-3 py-1.5 ${certificate.status !== "rascunho" ? "bg-blue-100 text-blue-800" : "bg-slate-100 text-slate-500"}`}>2 Fiscalizar</span><span className="h-px w-6 bg-slate-300" /><span className={`rounded-full px-3 py-1.5 ${certificate.status === "aprovado" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"}`}>3 Aprovar</span></div></div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_330px]">
        <div className="space-y-4">{grouped.map(([sectionName, sectionLines]) => <section key={sectionName} className="card overflow-hidden"><div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-3"><div><h3 className="font-semibold text-slate-900">{sectionName}</h3><p className="text-xs text-slate-500">{sectionLines.filter((line) => Number(drafts[line.id]?.periodQty || 0) > 0).length} item(ns) medidos neste período</p></div><span className="text-sm font-semibold tabular-nums text-slate-900">{money(sectionLines.reduce((sum, line) => sum + line.periodValue, 0))}</span></div><div className="overflow-x-auto"><table className="min-w-[1050px] w-full text-sm"><thead><tr className="table-head-row"><th className="px-4 py-2 text-left font-medium">Item / descrição</th><th className="text-right font-medium">Contratado</th><th className="text-right font-medium">Anterior</th><th className="text-right font-medium">Este período</th><th className="text-right font-medium">Acumulado</th><th className="text-right font-medium">Saldo</th><th className="text-right font-medium">Execução</th><th className="px-4 text-right font-medium">Valor período</th></tr></thead><tbody>{sectionLines.map((line) => {
          const draft = drafts[line.id] ?? { periodQty: "", notes: "", overrunReason: "" };
          const currentPeriod = Number(draft.periodQty || 0);
          const projected = line.previousQty + currentPeriod;
          const willOverrun = line.budgetedQty !== null && projected > line.budgetedQty + 0.0001;
          return <tr key={line.id} className={`table-row align-top ${willOverrun ? "bg-red-50/60" : ""}`}><td className="max-w-[360px] px-4 py-3"><div className="flex gap-2"><span className="font-semibold text-blue-700">{line.code}</span><span><strong className="block text-slate-900">{line.description}</strong><small className="text-slate-500">{line.unit} · {money(line.unitPrice)} por {line.unit}</small>{!locked && currentPeriod > 0 && <input className="mt-2 block w-full rounded-md border border-slate-200 px-2 py-1 text-xs" placeholder="Nota/evidência da medição" value={draft.notes} onChange={(event) => setDrafts({ ...drafts, [line.id]: { ...draft, notes: event.target.value } })} />}{!locked && willOverrun && <input className="mt-2 block w-full rounded-md border border-red-300 bg-white px-2 py-1 text-xs text-red-800" placeholder="Justificação obrigatória do excedente" value={draft.overrunReason} onChange={(event) => setDrafts({ ...drafts, [line.id]: { ...draft, overrunReason: event.target.value } })} />}</span></div></td><td className="py-3 text-right tabular-nums">{line.budgetedQty === null ? "—" : number(line.budgetedQty)}</td><td className="py-3 text-right tabular-nums text-slate-500">{number(line.previousQty)}</td><td className="py-2 text-right">{locked ? <span className="font-semibold tabular-nums">{number(line.periodQty)}</span> : <div className="ml-auto flex w-32 items-center gap-1"><input className={`input h-9 text-right tabular-nums ${willOverrun ? "border-red-400" : ""}`} type="number" min="0" step="0.01" value={draft.periodQty} onChange={(event) => setDrafts({ ...drafts, [line.id]: { ...draft, periodQty: event.target.value } })} /><button title="Guardar linha" type="button" className="rounded-md bg-slate-900 px-2 py-2 text-xs font-semibold text-white" disabled={savingLine === line.id} onClick={() => saveLine(line)}>✓</button></div>}</td><td className="py-3 text-right tabular-nums font-medium">{number(locked ? line.cumulativeQty : projected)}</td><td className={`py-3 text-right tabular-nums ${willOverrun || (line.remainingQty ?? 0) < 0 ? "font-semibold text-red-700" : "text-slate-500"}`}>{line.budgetedQty === null ? "—" : number(line.budgetedQty - (locked ? line.cumulativeQty : projected))}</td><td className="py-3 text-right"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${willOverrun || line.hasOverrun ? "bg-red-100 text-red-700" : "bg-blue-50 text-blue-700"}`}>{line.budgetedQty ? `${Math.max(0, projected / line.budgetedQty * 100).toFixed(2)}%` : "—"}</span></td><td className="px-4 py-3 text-right tabular-nums font-semibold">{money((locked ? line.periodQty : currentPeriod) * line.unitPrice)}</td></tr>;
        })}</tbody></table></div></section>)}</div>

        <aside className="self-start space-y-4 xl:sticky xl:top-24"><section className="overflow-hidden rounded-2xl bg-slate-950 text-white shadow-lg"><div className="p-5"><p className="text-xs font-semibold uppercase tracking-wider text-orange-300">Resumo do auto</p><div className="mt-4"><span className="text-sm text-slate-300">Total deste período</span><strong className="mt-1 block text-2xl tabular-nums">{money(periodTotal)} {data.financialParameters.currency}</strong><span className="text-xs text-slate-400">inclui IVA {(ivaRate * 100).toFixed(2)}%</span></div><dl className="mt-5 space-y-3 border-t border-slate-700 pt-4 text-sm"><div className="flex justify-between"><dt className="text-slate-400">Trabalhos medidos</dt><dd className="font-semibold tabular-nums">{money(periodValue)}</dd></div>{contingenciesRate > 0 && <div className="flex justify-between"><dt className="text-slate-400">Contingências ({(contingenciesRate * 100).toFixed(2)}%)</dt><dd className="font-semibold tabular-nums">{money(periodContingencies)}</dd></div>}<div className="flex justify-between"><dt className="text-slate-400">IVA ({(ivaRate * 100).toFixed(2)}%)</dt><dd className="font-semibold tabular-nums">{money(periodIva)}</dd></div><div className="flex justify-between border-t border-slate-700 pt-3"><dt className="text-slate-300">Acumulado com IVA</dt><dd className="font-semibold tabular-nums">{money(cumulativeTotal)}</dd></div><div className="flex justify-between"><dt className="text-slate-400">Saldo contratual</dt><dd className="font-semibold tabular-nums">{money(contractTotal - cumulativeTotal)}</dd></div><div className="flex justify-between"><dt className="text-slate-400">Itens medidos</dt><dd>{measuredItems} / {lines.length}</dd></div><div className="flex justify-between"><dt className="text-slate-400">Excedentes</dt><dd className={overruns ? "font-semibold text-red-300" : "text-emerald-300"}>{overruns}</dd></div></dl><div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-700"><i className="block h-full rounded-full bg-orange-500" style={{ width: `${Math.min(100, progress)}%` }} /></div><div className="mt-1 flex justify-between text-xs text-slate-400"><span>Execução acumulada</span><span>{progress.toFixed(2)}%</span></div></div><div className="border-t border-slate-700 bg-slate-900 p-4">{certificate.status === "rascunho" && <button className="btn w-full bg-white text-slate-950 hover:bg-slate-100" disabled={busy} onClick={() => changeStatus("submetido")}>Submeter à fiscalização</button>}{certificate.status === "submetido" && <div className="grid grid-cols-2 gap-2"><button className="btn btn-secondary" disabled={busy} onClick={() => changeStatus("rascunho")}>Devolver</button><button className="btn bg-emerald-600 text-white hover:bg-emerald-500" disabled={busy} onClick={() => changeStatus("aprovado")}>Aprovar auto</button></div>}{certificate.status === "aprovado" && <div className="rounded-lg bg-emerald-900/50 px-3 py-2 text-center text-sm font-semibold text-emerald-200">Aprovado · receita e cronograma actualizados</div>}</div></section><section className="card card-pad"><h3 className="text-sm font-semibold text-slate-900">Controlo antes de submeter</h3><ul className="mt-3 space-y-2 text-xs text-slate-600"><li>✓ Quantidades referem-se apenas ao período</li><li>✓ Acumulado calculado pelo sistema</li><li>✓ IVA {(ivaRate * 100).toFixed(2)}% incluído no total financeiro</li><li className={overruns ? "font-semibold text-red-700" : ""}>{overruns ? `! ${overruns} excedente(s) com justificação obrigatória` : "✓ Nenhum excedente contratual"}</li><li>✓ Aprovação cria conta a receber</li><li>✓ Progresso aprovado alimenta o cronograma</li></ul></section></aside>
      </div>
      {showLabour && <LabourByPhaseModal certificateId={certificate.id} onClose={() => setShowLabour(false)} />}
    </div>
  </Layout>{dialog}</>);
}

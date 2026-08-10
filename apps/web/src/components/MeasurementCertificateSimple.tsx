import type { Dispatch, ReactNode, SetStateAction } from "react";
import { Link } from "react-router-dom";
import type { MeasurementCertificateDetail, MeasurementLine } from "../api/measurement";
import { measurementApi } from "../api/measurement";
import Layout from "./Layout";
import CertificateFieldMeasurementPanel from "./CertificateFieldMeasurementPanel";
import LabourByPhaseModal from "./LabourByPhaseModal";
import { IconBack, IconClipboard, IconDownload } from "./icons";

type Draft = { periodQty: string; notes: string; overrunReason: string };
type Status = "rascunho" | "submetido" | "aprovado";

type Props = {
  data: MeasurementCertificateDetail;
  drafts: Record<string, Draft>;
  setDrafts: Dispatch<SetStateAction<Record<string, Draft>>>;
  grouped: Array<[string, MeasurementLine[]]>;
  locked: boolean;
  busy: boolean;
  savingLine: string | null;
  dirtyCount: number;
  error: string | null;
  showLabour: boolean;
  setShowLabour: (show: boolean) => void;
  saveLine: (line: MeasurementLine) => Promise<void>;
  saveAllDirty: () => Promise<void>;
  changeStatus: (status: Status) => Promise<void>;
  reload: () => Promise<void>;
  periodValue: number;
  periodIva: number;
  periodTotal: number;
  cumulativeTotal: number;
  contractTotal: number;
  progress: number;
  measuredItems: number;
  overruns: number;
  ivaRate: number;
  dialog: ReactNode;
};

const STATUS_LABEL: Record<Status, string> = { rascunho: "Em preparação", submetido: "Em fiscalização", aprovado: "Aprovado" };
const number = (value: number) => value.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function MeasurementCertificateSimple(props: Props) {
  const { data, drafts, setDrafts, grouped, locked, busy, savingLine, dirtyCount, error, saveLine, saveAllDirty, changeStatus, reload } = props;
  const { certificate } = data;

  return <>
    <Layout
      title={`Medição n.º ${certificate.number}`}
      subtitle={`${certificate.periodStartDate ? `${certificate.periodStartDate} — ` : "Até "}${certificate.periodDate} · ${STATUS_LABEL[certificate.status]}`}
      actions={<div className="flex flex-wrap gap-2">
        <a href={measurementApi.fieldMeasurementsPdfUrl(certificate.id)} className="btn btn-secondary btn-sm"><IconDownload className="h-4 w-4" /> PDF</a>
        <button type="button" onClick={() => props.setShowLabour(true)} className="btn btn-secondary btn-sm"><IconClipboard className="h-4 w-4" /> Mão-de-obra</button>
        {!locked && dirtyCount > 0 && <button type="button" disabled={busy} onClick={saveAllDirty} className="btn btn-primary btn-sm">Guardar alterações</button>}
        <Link to={`/projectos/${certificate.projectId}`} className="btn btn-ghost btn-sm"><IconBack className="h-4 w-4" /> Obra</Link>
      </div>}
    >
      <div className="mx-auto w-full max-w-[1450px] space-y-4">
        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <section className="card flex flex-wrap items-center justify-between gap-4 p-4">
          <div>
            <strong className="text-sm text-slate-950">Registe apenas o trabalho executado neste período</strong>
            <p className="mt-1 text-xs text-slate-500">O acumulado, saldo e valor são calculados automaticamente.</p>
          </div>
          <div className="flex items-center gap-1 text-xs font-semibold">
            <span className={certificate.status === "rascunho" ? "badge badge-brand" : "badge badge-green"}>1 Medir</span>
            <span className={certificate.status === "submetido" ? "badge badge-brand" : "badge badge-gray"}>2 Fiscalizar</span>
            <span className={certificate.status === "aprovado" ? "badge badge-green" : "badge badge-gray"}>3 Aprovar</span>
          </div>
        </section>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-4">
            {grouped.map(([sectionName, sectionLines]) => (
              <section key={sectionName} className="card overflow-hidden">
                <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
                  <h2 className="text-sm font-semibold text-slate-950">{sectionName}</h2>
                  <span className="text-xs text-slate-500">{sectionLines.filter((line) => Number(drafts[line.id]?.periodQty || 0) > 0).length} medido(s)</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[820px] text-sm">
                    <thead><tr className="table-head-row">
                      <th className="px-4 py-2 text-left font-medium">Trabalho</th>
                      <th className="text-right font-medium">Contratado</th>
                      <th className="text-right font-medium">Anterior</th>
                      <th className="text-right font-medium">Agora</th>
                      <th className="text-right font-medium">Total</th>
                      <th className="px-4 text-right font-medium">Valor</th>
                    </tr></thead>
                    <tbody>{sectionLines.map((line) => {
                      const draft = drafts[line.id] ?? { periodQty: "", notes: "", overrunReason: "" };
                      const current = Number(draft.periodQty || 0);
                      const total = line.previousQty + current;
                      const overrun = line.budgetedQty !== null && total > line.budgetedQty + 0.0001;
                      return <tr key={line.id} className={`table-row align-top ${overrun ? "bg-red-50/60" : ""}`}>
                        <td className="max-w-[360px] px-4 py-3">
                          <div className="flex gap-2"><span className="font-semibold text-brand-700">{line.code}</span><div className="min-w-0 flex-1">
                            <strong className="block text-slate-900">{line.description}</strong>
                            <span className="text-xs text-slate-500">{line.unit} · {number(line.unitPrice)} por {line.unit}</span>
                            {!locked && <details className="mt-2 text-xs"><summary className="cursor-pointer font-semibold text-brand-700">Detalhar medição</summary><div className="mt-2 space-y-2">
                              <CertificateFieldMeasurementPanel certificateLineId={line.id} unit={line.unit} locked={locked} overrunReason={draft.overrunReason} onChanged={() => void reload()} />
                              <input className="input h-9 text-xs" placeholder="Nota ou evidência" value={draft.notes} onChange={(event) => setDrafts((currentDrafts) => ({ ...currentDrafts, [line.id]: { ...draft, notes: event.target.value } }))} />
                            </div></details>}
                            {!locked && overrun && <input className="input mt-2 h-9 border-red-300 text-xs" placeholder="Justifique a quantidade adicional" value={draft.overrunReason} onChange={(event) => setDrafts((currentDrafts) => ({ ...currentDrafts, [line.id]: { ...draft, overrunReason: event.target.value } }))} />}
                          </div></div>
                        </td>
                        <td className="py-3 text-right tabular-nums">{line.budgetedQty === null ? "—" : number(line.budgetedQty)}</td>
                        <td className="py-3 text-right tabular-nums text-slate-500">{number(line.previousQty)}</td>
                        <td className="py-2 text-right">{locked || line.hasFieldMemory ? <strong>{number(line.periodQty)}</strong> : <div className="ml-auto flex w-32 gap-1"><input className={`input h-9 text-right ${overrun ? "border-red-400" : ""}`} type="number" min="0" step="0.01" value={draft.periodQty} onChange={(event) => setDrafts((currentDrafts) => ({ ...currentDrafts, [line.id]: { ...draft, periodQty: event.target.value } }))} /><button type="button" title="Guardar" className="btn btn-primary h-9 px-2" disabled={savingLine === line.id} onClick={() => saveLine(line)}>✓</button></div>}</td>
                        <td className="py-3 text-right tabular-nums"><strong>{number(locked ? line.cumulativeQty : total)}</strong>{line.budgetedQty !== null && <span className={`block text-[10px] ${overrun ? "text-red-700" : "text-slate-400"}`}>saldo {number(line.budgetedQty - (locked ? line.cumulativeQty : total))}</span>}</td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums">{number((locked ? line.periodQty : current) * line.unitPrice)}</td>
                      </tr>;
                    })}</tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>

          <aside className="self-start xl:sticky xl:top-24">
            <section className="overflow-hidden rounded-2xl bg-slate-950 text-white shadow-lg">
              <div className="p-5">
                <span className="text-xs text-slate-400">Total deste período</span>
                <strong className="mt-1 block text-2xl tabular-nums">{number(props.periodTotal)} {data.financialParameters.currency}</strong>
                <dl className="mt-5 space-y-3 border-t border-slate-700 pt-4 text-sm">
                  <div className="flex justify-between"><dt className="text-slate-400">Trabalhos</dt><dd>{number(props.periodValue)}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-400">IVA ({(props.ivaRate * 100).toFixed(2)}%)</dt><dd>{number(props.periodIva)}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-400">Acumulado</dt><dd>{number(props.cumulativeTotal)}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-400">Saldo do contrato</dt><dd>{number(props.contractTotal - props.cumulativeTotal)}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-400">Itens medidos</dt><dd>{props.measuredItems}</dd></div>
                  {props.overruns > 0 && <div className="flex justify-between text-red-300"><dt>Quantidades adicionais</dt><dd>{props.overruns}</dd></div>}
                </dl>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-700"><div className="h-full bg-brand-500" style={{ width: `${Math.min(100, props.progress)}%` }} /></div>
                <p className="mt-1 text-right text-xs text-slate-400">{props.progress.toFixed(2)}% executado</p>
              </div>
              <div className="border-t border-slate-700 bg-slate-900 p-4">
                {certificate.status === "rascunho" && <button className="btn w-full bg-white text-slate-950" disabled={busy} onClick={() => changeStatus("submetido")}>Enviar para fiscalização</button>}
                {certificate.status === "submetido" && <div className="grid grid-cols-2 gap-2"><button className="btn btn-secondary" disabled={busy} onClick={() => changeStatus("rascunho")}>Devolver</button><button className="btn bg-emerald-600 text-white" disabled={busy} onClick={() => changeStatus("aprovado")}>Aprovar</button></div>}
                {certificate.status === "aprovado" && <div className="rounded-lg bg-emerald-900/50 px-3 py-2 text-center text-sm font-semibold text-emerald-200">Medição aprovada</div>}
              </div>
            </section>
          </aside>
        </div>
        {props.showLabour && <LabourByPhaseModal certificateId={certificate.id} onClose={() => props.setShowLabour(false)} />}
      </div>
    </Layout>
    {props.dialog}
  </>;
}

import { useEffect, useState } from "react";
import { measurementApi, type LabourByPhaseResponse } from "../api/measurement";
import Modal from "./Modal";

function quantity(value: number) {
  return value.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function money(value: number, currency: string) {
  return `${value.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

export default function LabourByPhaseModal({ certificateId, onClose }: { certificateId: string; onClose: () => void }) {
  const [data, setData] = useState<LabourByPhaseResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    measurementApi.labourByPhase(certificateId).then(setData).catch((cause) => setError(cause instanceof Error ? cause.message : "Erro ao calcular mão de obra"));
  }, [certificateId]);

  return <Modal title="Mão de obra por fase" onClose={onClose} maxWidth="max-w-5xl">
    {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    {!error && !data && <p className="py-8 text-center text-sm text-slate-400">A calcular equipas e horas necessárias...</p>}
    {data && <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl bg-slate-950 p-4 text-white"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Horas deste período</p><strong className="mt-1 block text-xl tabular-nums">{quantity(data.grandPeriodHours)} h</strong></div>
        <div className="rounded-xl border border-slate-200 p-4"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Custo deste período</p><strong className="mt-1 block text-lg tabular-nums text-slate-950">{money(data.grandPeriodCost, data.currency)}</strong></div>
        <div className="rounded-xl border border-slate-200 p-4"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Horas acumuladas</p><strong className="mt-1 block text-lg tabular-nums text-slate-950">{quantity(data.grandCumulativeHours)} h</strong></div>
        <div className="rounded-xl border border-slate-200 p-4"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Custo acumulado</p><strong className="mt-1 block text-lg tabular-nums text-slate-950">{money(data.grandCumulativeCost, data.currency)}</strong></div>
      </div>
      <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs leading-relaxed text-blue-800">As horas resultam de quantidade medida × rendimento de mão de obra da composição. A zona da obra ajusta o custo horário; itens sem composição são assinalados e não recebem horas inventadas.</p>
      {data.phases.map((phase) => <section key={phase.key} className="overflow-hidden rounded-xl border border-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3"><div><h3 className="text-sm font-bold text-slate-900">{phase.label}</h3><p className="text-xs text-slate-500">{quantity(phase.periodHours)} h neste período · {quantity(phase.cumulativeHours)} h acumuladas</p></div><strong className="text-sm tabular-nums text-slate-900">{money(phase.periodCost, data.currency)}</strong></div>
        <div className="divide-y divide-slate-100 md:hidden">{phase.labour.map((line) => <div key={line.name} className="p-4"><div className="flex items-start justify-between gap-3"><strong className="text-sm text-slate-900">{line.name}</strong><span className="text-sm font-bold tabular-nums">{quantity(line.periodHours)} h</span></div><div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-500"><span>Taxa: {money(line.hourlyRate, line.currency)}/h</span><span className="text-right">Período: {money(line.periodCost, line.currency)}</span><span>Planeado: {quantity(line.plannedHours)} h</span><span className="text-right">Acumulado: {quantity(line.cumulativeHours)} h</span></div></div>)}</div>
        <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[760px] text-sm"><thead><tr className="table-head-row"><th className="px-4 py-2 text-left font-medium">Categoria</th><th className="text-right font-medium">Planeado</th><th className="text-right font-medium">Período</th><th className="text-right font-medium">Acumulado</th><th className="text-right font-medium">Custo/h</th><th className="px-4 text-right font-medium">Custo período</th></tr></thead><tbody>{phase.labour.map((line) => <tr key={line.name} className="table-row"><td className="px-4 py-2 font-medium text-slate-900">{line.name}</td><td className="text-right tabular-nums">{quantity(line.plannedHours)} h</td><td className="text-right font-semibold tabular-nums">{quantity(line.periodHours)} h</td><td className="text-right tabular-nums">{quantity(line.cumulativeHours)} h</td><td className="text-right tabular-nums">{money(line.hourlyRate, line.currency)}</td><td className="px-4 text-right font-semibold tabular-nums">{money(line.periodCost, line.currency)}</td></tr>)}</tbody></table></div>
        {phase.itemsWithoutComposition.length > 0 && <div className="border-t border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900"><strong>{phase.itemsWithoutComposition.length} trabalho(s) sem composição.</strong> Associe uma composição para calcular categoria, horas e custo da equipa.</div>}
      </section>)}
      {!data.phases.length && <p className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">Ainda não existem trabalhos medidos com composição de mão de obra.</p>}
    </div>}
  </Modal>;
}

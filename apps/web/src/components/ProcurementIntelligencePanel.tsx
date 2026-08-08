import { useEffect, useMemo, useState } from "react";
import { procurementIntelligenceApi, type ProcurementIntelligenceDashboard, type SupplierStatement } from "../api/procurementIntelligence";

type InternalView = "tesouraria" | "fornecedores" | "sourcing" | "boq";

function money(value: number, currency: string) {
  return new Intl.NumberFormat("pt-MZ", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}
function pct(value: number | null) { return value == null ? "—" : `${value.toLocaleString("pt-MZ", { maximumFractionDigits: 1 })}%`; }
function dateLabel(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-PT", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}
function riskBadge(level: "baixo" | "medio" | "alto") {
  return level === "alto" ? "badge badge-red" : level === "medio" ? "badge bg-amber-100 text-amber-800" : "badge badge-green";
}
function confidenceLabel(value: "alta" | "media" | "baixa") { return value === "alta" ? "Alta" : value === "media" ? "Média" : "Baixa"; }
function sourceLabel(value: string) {
  const labels: Record<string, string> = { pedido_pagamento: "Pedido de pagamento", factura: "Factura AP", factura_em_revisao: "Factura em revisão", ordem_compra: "OC não facturada", necessidade_cronograma: "Necessidade do cronograma" };
  return labels[value] ?? value;
}

function Metric({ label, value, note, danger }: { label: string; value: string; note?: string; danger?: boolean }) {
  return <div className="card card-pad"><p className="text-xs text-slate-500">{label}</p><strong className={`mt-1 block text-xl ${danger ? "text-red-700" : "text-slate-950"}`}>{value}</strong>{note && <p className="mt-1 text-xs text-slate-500">{note}</p>}</div>;
}

export default function ProcurementIntelligencePanel({ projectId }: { projectId: string }) {
  const [data, setData] = useState<ProcurementIntelligenceDashboard | null>(null);
  const [view, setView] = useState<InternalView>("tesouraria");
  const [weeks, setWeeks] = useState(12);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statement, setStatement] = useState<SupplierStatement | null>(null);
  const [statementLoading, setStatementLoading] = useState(false);

  async function reload(nextWeeks = weeks) {
    setLoading(true); setError(null);
    try { setData(await procurementIntelligenceApi.dashboard(projectId, nextWeeks)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível calcular a inteligência de procurement"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void reload(); }, [projectId]);

  async function openStatement(supplierId: string) {
    setStatementLoading(true); setError(null);
    try { setStatement(await procurementIntelligenceApi.supplierStatement(projectId, supplierId)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível gerar o extracto do fornecedor"); }
    finally { setStatementLoading(false); }
  }

  const maxWeek = useMemo(() => Math.max(1, ...(data?.cashForecast.weeks.map((row) => row.amount) ?? [1])), [data]);
  if (loading && !data) return <div className="card card-pad"><p className="text-sm text-slate-500">A calcular procurement intelligence…</p></div>;
  if (!data) return <div className="card card-pad text-sm text-red-700">{error ?? "Dados indisponíveis"}</div>;
  const currency = data.project.currency;

  return <div className="space-y-4">
    {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
    <div className="card card-pad">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-lg font-semibold">Inteligência & Tesouraria</h2><p className="mt-1 text-sm text-slate-500">Previsões não alteram o Financeiro. Caixa realizado continua a vir apenas de pagamentos executados.</p></div>
        <div className="flex items-center gap-2"><label className="text-xs text-slate-500">Horizonte<select className="input ml-2 py-1" value={weeks} onChange={(e) => { const value = Number(e.target.value); setWeeks(value); void reload(value); }}><option value={8}>8 semanas</option><option value={12}>12 semanas</option><option value={26}>26 semanas</option><option value={52}>52 semanas</option></select></label><a className="btn btn-secondary btn-sm" href={procurementIntelligenceApi.cashForecastCsvUrl(projectId, weeks)}>Exportar forecast CSV</a></div>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-4">{([['tesouraria','Tesouraria'],['fornecedores','Fornecedores'],['sourcing','Sourcing'],['boq','BOQ × Compra']] as Array<[InternalView,string]>).map(([id,label]) => <button key={id} className={`rounded-lg px-3 py-2 text-sm font-semibold ${view === id ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600"}`} onClick={() => setView(id)}>{label}</button>)}</div>
    </div>

    {view === "tesouraria" && <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Contas a pagar" value={money(data.executive.openAp, currency)} note={`Vencido: ${money(data.executive.overdue, currency)}`} danger={data.executive.overdue > 0} />
        <Metric label="Pagamentos aprovados" value={money(data.executive.approvedPaymentRequests, currency)} note="Reservados, ainda não executados" />
        <Metric label="OC ainda não facturada" value={money(data.executive.unInvoicedCommitments, currency)} note="Compromisso futuro" />
        <Metric label={`Necessidade ${weeks} semanas`} value={money(data.cashForecast.totalInHorizon, currency)} note={`Shortage do cronograma: ${money(data.executive.scheduledShortage, currency)}`} />
      </div>
      <section className="card overflow-hidden"><div className="card-pad border-b border-slate-100"><h3 className="font-semibold">Aging de fornecedores</h3><p className="text-xs text-slate-500">Saldos de facturas aprovadas, líquidos de créditos e pagamentos.</p></div><div className="grid gap-px bg-slate-200 sm:grid-cols-2 lg:grid-cols-6">{data.aging.map((bucket) => <div key={bucket.key} className="bg-white p-4"><span className="text-xs text-slate-500">{bucket.label}</span><strong className={`mt-1 block text-sm ${bucket.key !== 'nao_vencido' && bucket.key !== 'sem_vencimento' && bucket.amount > 0 ? 'text-red-700' : ''}`}>{money(bucket.amount, currency)}</strong><span className="text-xs text-slate-400">{bucket.count} factura(s)</span></div>)}</div></section>
      <section className="card overflow-hidden"><div className="card-pad border-b border-slate-100"><h3 className="font-semibold">Cash requirements por semana</h3><p className="text-xs text-slate-500">Alta = AP/pagamento aprovado; média = documento em processo/OC; baixa = necessidade ainda sem OC.</p></div><div className="divide-y divide-slate-100">{data.cashForecast.weeks.map((week) => <div key={week.weekIndex} className="p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><strong className="text-sm">{dateLabel(week.startDate)} – {dateLabel(week.endDate)}</strong><p className="text-xs text-slate-500">Alta {money(week.highConfidence,currency)} · Média {money(week.mediumConfidence,currency)} · Baixa {money(week.lowConfidence,currency)}</p></div><strong>{money(week.amount,currency)}</strong></div><div className="mt-2 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-slate-800" style={{ width: `${Math.max(0, Math.min(100, (week.amount / maxWeek) * 100))}%` }} /></div>{week.items.length > 0 && <div className="mt-2 grid gap-1 md:grid-cols-2">{week.items.slice(0,6).map((item) => <div key={`${item.source}:${item.id}`} className="rounded-lg bg-slate-50 px-3 py-2 text-xs"><div className="flex justify-between gap-2"><span><strong>{item.reference}</strong> · {item.supplierName ?? "A definir"}</span><strong>{money(item.amount,item.currency)}</strong></div><span className="text-slate-500">{sourceLabel(item.source)} · confiança {confidenceLabel(item.confidence)} · {item.dateBasis}</span></div>)}</div>}</div>)}</div>{data.cashForecast.undated.length > 0 && <div className="card-pad border-t border-amber-200 bg-amber-50 text-sm text-amber-900"><strong>{data.cashForecast.undated.length} necessidade(s) sem data</strong> — devem ser ligadas ao cronograma ou receber data de pagamento.</div>}</section>
    </>}

    {view === "fornecedores" && <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Fornecedores activos" value={String(data.executive.supplierCount)} /><Metric label="Risco alto" value={String(data.executive.highRiskSuppliers)} danger={data.executive.highRiskSuppliers > 0} /><Metric label="Total comprometido" value={money(data.suppliers.reduce((s,r)=>s+r.committed,0),currency)} /><Metric label="Vencido" value={money(data.executive.overdue,currency)} danger={data.executive.overdue > 0} /></div>
      <section className="card overflow-x-auto"><table className="w-full min-w-[1050px] text-sm"><thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="p-3">Fornecedor</th><th className="p-3 text-right">Comprometido</th><th className="p-3 text-right">AP aberto</th><th className="p-3 text-right">Vencido</th><th className="p-3 text-right">Concentração</th><th className="p-3 text-right">Resposta RFQ</th><th className="p-3 text-right">No prazo</th><th className="p-3">Risco</th><th className="p-3"></th></tr></thead><tbody>{data.suppliers.map((row) => <tr key={row.supplierId} className="border-t"><td className="p-3"><strong>{row.supplierName}</strong><p className="text-xs text-slate-500">{row.orderCount} OC · {row.wins} adjudicação(ões) · {row.openNcrCount} NCR aberta(s)</p></td><td className="p-3 text-right">{money(row.committed,currency)}</td><td className="p-3 text-right">{money(row.openAP,currency)}</td><td className={`p-3 text-right ${row.overdue > 0 ? 'font-semibold text-red-700' : ''}`}>{money(row.overdue,currency)}</td><td className="p-3 text-right">{pct(row.concentrationPct)}</td><td className="p-3 text-right">{pct(row.responseRatePct)}</td><td className="p-3 text-right">{pct(row.onTimeRatePct)}</td><td className="p-3"><span className={riskBadge(row.risk.level)}>{row.risk.level} · {row.risk.score}</span>{row.risk.flags.length > 0 && <p className="mt-1 max-w-56 text-xs text-slate-500">{row.risk.flags.join(" · ")}</p>}</td><td className="p-3"><button className="btn btn-secondary btn-sm" disabled={statementLoading} onClick={() => void openStatement(row.supplierId)}>Statement</button></td></tr>)}</tbody></table></section>
      {statement && <section className="card overflow-hidden"><div className="card-pad border-b border-slate-100 flex justify-between gap-3"><div><h3 className="font-semibold">Statement — {statement.supplier.name}</h3><p className="text-xs text-slate-500">OC aparece como compromisso informativo; só factura, crédito e pagamento alteram saldo AP.</p></div><button className="btn btn-ghost btn-sm" onClick={() => setStatement(null)}>Fechar</button></div><div className="overflow-x-auto"><table className="w-full min-w-[750px] text-sm"><thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="p-3">Data</th><th className="p-3">Documento</th><th className="p-3">Descrição</th><th className="p-3 text-right">Débito</th><th className="p-3 text-right">Crédito</th><th className="p-3 text-right">Saldo</th></tr></thead><tbody>{statement.rows.map((row) => <tr key={row.id} className="border-t"><td className="p-3">{dateLabel(row.date)}</td><td className="p-3"><strong>{row.reference}</strong><p className="text-xs text-slate-400">{row.kind.replaceAll('_',' ')}</p></td><td className="p-3">{row.description}</td><td className="p-3 text-right">{row.debit ? money(row.debit,statement.currency) : '—'}</td><td className="p-3 text-right">{row.credit ? money(row.credit,statement.currency) : '—'}</td><td className="p-3 text-right font-semibold">{row.affectsBalance ? money(row.balance,statement.currency) : 'informativo'}</td></tr>)}</tbody></table></div><div className="card-pad border-t text-right"><span className="text-xs text-slate-500">Saldo actual</span><strong className="ml-3">{money(statement.balance, statement.currency)}</strong></div></section>}
    </>}

    {view === "sourcing" && <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="RFQs" value={String(data.sourcing.summary.rfqCount)} note={`${data.sourcing.summary.awardedRfqCount} adjudicadas`} /><Metric label="Taxa de resposta" value={pct(data.sourcing.summary.responseRatePct)} note={`${data.sourcing.summary.responseCount}/${data.sourcing.summary.invitationCount} convites`} /><Metric label="Lead time sourcing" value={data.sourcing.summary.averageSourcingDays == null ? '—' : `${data.sourcing.summary.averageSourcingDays} dias`} /><Metric label="Efeito vs mediana" value={money(data.sourcing.summary.competitiveSavingsVsMedian,currency)} note={`${data.sourcing.summary.comparableRfqCount} RFQ(s) comparáveis`} /></div>
      <section className="card overflow-x-auto"><table className="w-full min-w-[950px] text-sm"><thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="p-3">RFQ</th><th className="p-3 text-right">Adjudicado</th><th className="p-3 text-right">Mediana</th><th className="p-3 text-right">Efeito vs mediana</th><th className="p-3 text-right">Menor proposta</th><th className="p-3 text-right">Premium vs menor</th><th className="p-3 text-right">Respostas</th><th className="p-3 text-right">Dias</th></tr></thead><tbody>{data.sourcing.rfqs.map((row) => <tr key={row.rfqId} className="border-t"><td className="p-3"><strong>{row.reference}</strong><p className="text-xs text-slate-500">{row.title}</p></td><td className="p-3 text-right">{money(row.awardedCost,currency)}</td><td className="p-3 text-right">{row.medianComparable == null ? '—' : money(row.medianComparable,currency)}</td><td className={`p-3 text-right font-semibold ${(row.savingsVsMedian ?? 0) < 0 ? 'text-red-700' : 'text-green-700'}`}>{row.savingsVsMedian == null ? 'sem baseline' : `${money(row.savingsVsMedian,currency)} · ${pct(row.savingsVsMedianPct)}`}</td><td className="p-3 text-right">{row.lowestComparable == null ? '—' : money(row.lowestComparable,currency)}</td><td className={`p-3 text-right ${(row.premiumVsLowest ?? 0) > 0 ? 'text-amber-700' : ''}`}>{row.premiumVsLowest == null ? '—' : money(row.premiumVsLowest,currency)}</td><td className="p-3 text-right">{row.responseCount}/{row.supplierCount}</td><td className="p-3 text-right">{row.sourcingDays ?? '—'}</td></tr>)}</tbody></table></section>
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600"><strong>Definição:</strong> “efeito vs mediana” compara a adjudicação ao custo mediano das propostas completas, válidas e na mesma moeda. “Premium vs menor” mostra quanto foi pago acima da proposta comparável mais barata. Nenhuma das duas métricas altera o Financeiro.</div>
    </>}

    {view === "boq" && <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Baseline BOQ equivalente" value={money(data.boqVariance.baselineForOrderedQty,currency)} note="Só para a quantidade já encomendada" /><Metric label="Valor real encomendado" value={money(data.boqVariance.orderedValue,currency)} /><Metric label="Desvio procurement" value={money(data.boqVariance.variance,currency)} note={pct(data.boqVariance.variancePct)} danger={data.boqVariance.variance > 0} /><Metric label="Linhas analisadas" value={String(data.boqVariance.materials.length)} /></div>
      <section className="card overflow-x-auto"><table className="w-full min-w-[1000px] text-sm"><thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="p-3">Material</th><th className="p-3 text-right">Necessário BOQ</th><th className="p-3 text-right">Encomendado</th><th className="p-3 text-right">Cobertura</th><th className="p-3 text-right">Custo unit. BOQ</th><th className="p-3 text-right">Baseline equivalente</th><th className="p-3 text-right">Compra real</th><th className="p-3 text-right">Desvio</th></tr></thead><tbody>{data.boqVariance.materials.map((row) => <tr key={row.materialId} className="border-t"><td className="p-3"><strong>{row.materialName}</strong><p className="text-xs text-slate-500">{row.unit}</p></td><td className="p-3 text-right">{row.requiredQty.toLocaleString('pt-MZ')}</td><td className="p-3 text-right">{row.orderedQty.toLocaleString('pt-MZ')}</td><td className="p-3 text-right">{pct(row.procurementCoveragePct)}</td><td className="p-3 text-right">{money(row.baselineUnitCost,currency)}</td><td className="p-3 text-right">{money(row.baselineForOrderedQty,currency)}</td><td className="p-3 text-right">{money(row.orderedValue,currency)}</td><td className={`p-3 text-right font-semibold ${row.variance > 0 ? 'text-red-700' : row.variance < 0 ? 'text-green-700' : ''}`}>{money(row.variance,currency)} · {pct(row.variancePct)}</td></tr>)}</tbody></table></section>
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600"><strong>Leitura correcta:</strong> o baseline é normalizado pela quantidade já comprada. Assim comprar apenas 25% do cimento não aparece falsamente como “75% abaixo do orçamento”. Transporte e IVA ficam fora desta comparação material-a-material e permanecem na tesouraria/OC.</div>
    </>}
  </div>;
}

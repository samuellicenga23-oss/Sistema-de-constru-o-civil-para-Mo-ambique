import { useEffect, useMemo, useState } from "react";
import { accountsPayableApi, type ProcurementNcr, type SupplierInvoiceDetail, type SupplierInvoiceSummary } from "../api/procurementAccountsPayable";
import ProcurementFiscalControlPanel from "./ProcurementFiscalControlPanel";

function money(value: number, currency = "MZN") {
  return new Intl.NumberFormat("pt-MZ", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}
function today() { return new Date().toISOString().slice(0, 10); }

export default function ProcurementAccountsPayablePanel({ projectId, canApprove, onChanged }: { projectId: string; canApprove: boolean; onChanged?: () => void }) {
  const [invoices, setInvoices] = useState<SupplierInvoiceSummary[]>([]);
  const [ncrs, setNcrs] = useState<ProcurementNcr[]>([]);
  const [selected, setSelected] = useState<SupplierInvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [varianceReason, setVarianceReason] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [returnQty, setReturnQty] = useState<Record<string, string>>({});
  const [resolutionNotes, setResolutionNotes] = useState<Record<string, string>>({});

  async function reload() {
    setLoading(true); setError(null);
    try {
      const [invoiceRows, ncrRows] = await Promise.all([accountsPayableApi.invoices(projectId), accountsPayableApi.nonconformities(projectId)]);
      setInvoices(invoiceRows); setNcrs(ncrRows);
      if (selected) setSelected(await accountsPayableApi.invoice(selected.id));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível carregar facturas e AP"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void reload(); }, [projectId]);

  const metrics = useMemo(() => ({
    pendingReview: invoices.filter((invoice) => ["submetida", "em_revisao", "divergente"].includes(invoice.status)).length,
    payable: invoices.reduce((sum, invoice) => sum + invoice.balance.outstanding, 0),
    blocked: invoices.filter((invoice) => invoice.matchStatus === "bloqueada").length,
    openNcr: ncrs.filter((row) => !["resolvida", "cancelada"].includes(row.ncr.status)).length,
  }), [invoices, ncrs]);

  async function openInvoice(id: string) {
    setError(null);
    try { const detail = await accountsPayableApi.invoice(id); setSelected(detail); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível abrir a factura"); }
  }
  async function act(action: "review" | "approve" | "reject") {
    if (!selected) return;
    setSaving(true); setError(null);
    try {
      if (action === "review") await accountsPayableApi.review(selected.id);
      if (action === "approve") await accountsPayableApi.approve(selected.id, { varianceReason: selected.currentMatch.softVariances.length ? varianceReason : undefined });
      if (action === "reject") await accountsPayableApi.reject(selected.id, rejectReason);
      await reload(); onChanged?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Operação não concluída"); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="card card-pad"><p className="text-sm text-gray-500">A carregar facturas e contas a pagar…</p></div>;
  return <div className="space-y-4">
    {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <div className="card card-pad"><p className="text-xs text-gray-500">Para rever</p><strong className="text-xl">{metrics.pendingReview}</strong></div>
      <div className="card card-pad"><p className="text-xs text-gray-500">Contas a pagar</p><strong className="text-xl">{money(metrics.payable, invoices[0]?.currency ?? "MZN")}</strong></div>
      <div className="card card-pad"><p className="text-xs text-gray-500">Facturas bloqueadas</p><strong className="text-xl">{metrics.blocked}</strong></div>
      <div className="card card-pad"><p className="text-xs text-gray-500">Não-conformidades abertas</p><strong className="text-xl">{metrics.openNcr}</strong></div>
    </div>

    <div className="card overflow-hidden">
      <div className="card-pad border-b border-gray-100"><h3 className="font-semibold">Facturas de fornecedores</h3><p className="text-xs text-gray-500">OC × quantidade aceite × factura.</p></div>
      {invoices.length === 0 ? <div className="card-pad text-sm text-gray-500">Ainda não há facturas submetidas.</div> : invoices.map((invoice) => <button key={invoice.id} type="button" onClick={() => void openInvoice(invoice.id)} className="w-full text-left px-4 py-3 border-t border-gray-100 hover:bg-gray-50 flex items-center justify-between gap-4">
        <div><strong className="text-sm">{invoice.invoiceNumber} · {invoice.supplierName}</strong><p className="text-xs text-gray-500">{invoice.status.replaceAll("_", " ")} · match {invoice.matchStatus}</p></div>
        <div className="text-right"><strong className="text-sm">{money(Number(invoice.totalAmount), invoice.currency)}</strong><p className="text-xs text-gray-500">saldo {money(invoice.balance.outstanding, invoice.currency)}</p></div>
      </button>)}
    </div>

    {selected && <div className="card card-pad space-y-4">
      <div className="flex items-start justify-between gap-4"><div><p className="text-xs text-gray-500">Factura seleccionada</p><h3 className="font-semibold">{selected.invoiceNumber} · {selected.supplierName}</h3></div><button className="btn" onClick={() => setSelected(null)}>Fechar</button></div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm"><div><span className="text-gray-500">Total</span><br/><strong>{money(Number(selected.totalAmount), selected.currency)}</strong></div><div><span className="text-gray-500">Créditos</span><br/><strong>{money(selected.balance.credited, selected.currency)}</strong></div><div><span className="text-gray-500">Pago</span><br/><strong>{money(selected.balance.paid, selected.currency)}</strong></div><div><span className="text-gray-500">Em aberto</span><br/><strong>{money(selected.balance.outstanding, selected.currency)}</strong></div></div>
      <div className={`rounded-xl border px-4 py-3 text-sm ${selected.currentMatch.hardBlocks.length ? "border-red-200 bg-red-50" : selected.currentMatch.softVariances.length ? "border-amber-200 bg-amber-50" : "border-green-200 bg-green-50"}`}>
        <strong>{selected.currentMatch.exactMatch ? "Three-way match exacto" : selected.currentMatch.hardBlocks.length ? "Factura bloqueada" : "Factura com divergências autorizáveis"}</strong>
        {[...selected.currentMatch.hardBlocks, ...selected.currentMatch.softVariances].map((message, i) => <p key={i} className="mt-1">• {message}</p>)}
      </div>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-gray-500"><th className="py-2">Material</th><th>Facturado</th><th>Aceite disp.</th><th>Preço OC</th><th>Preço factura</th></tr></thead><tbody>{selected.lines.map((line) => { const match = selected.currentMatch.lineMatches.find((entry) => entry.purchaseOrderLineId === line.purchaseOrderLineId); return <tr key={line.id} className="border-t"><td className="py-2">{line.materialName}</td><td>{Number(line.quantity).toLocaleString("pt-MZ")}</td><td>{match?.availableToInvoiceQty.toLocaleString("pt-MZ") ?? "—"}</td><td>{match ? money(match.poUnitCost, selected.currency) : "—"}</td><td>{money(Number(line.unitCost), selected.currency)}</td></tr>; })}</tbody></table></div>
      {canApprove && ["submetida", "em_revisao", "divergente"].includes(selected.status) && <div className="space-y-2">
        {selected.currentMatch.softVariances.length > 0 && <textarea className="input" rows={2} placeholder="Justificação obrigatória para divergências" value={varianceReason} onChange={(e) => setVarianceReason(e.target.value)} />}
        <textarea className="input" rows={2} placeholder="Motivo de rejeição, se aplicável" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
        <div className="flex flex-wrap gap-2"><button className="btn" disabled={saving} onClick={() => void act("review")}>Recalcular match</button><button className="btn btn-primary" disabled={saving || selected.currentMatch.hardBlocks.length > 0 || (selected.currentMatch.softVariances.length > 0 && varianceReason.trim().length < 8)} onClick={() => void act("approve")}>Aprovar factura</button><button className="btn" disabled={saving || rejectReason.trim().length < 5} onClick={() => void act("reject")}>Rejeitar</button></div>
      </div>}
      <ProcurementFiscalControlPanel projectId={projectId} invoiceId={selected.id} invoiceStatus={selected.status} outstanding={selected.balance.outstanding} currency={selected.currency} canApprove={canApprove} onChanged={() => void reload()} />
      {selected.creditNotes.length > 0 && <div><h4 className="font-medium text-sm mb-2">Notas de crédito</h4>{selected.creditNotes.map((credit) => <div key={credit.id} className="border rounded-xl p-3 mb-2 flex justify-between gap-3"><div><strong className="text-sm">{credit.creditNumber}</strong><p className="text-xs text-gray-500">{credit.reason} · {credit.status}</p></div>{canApprove && credit.status === "submetida" && <div className="flex gap-2"><button className="btn" onClick={async () => { await accountsPayableApi.reviewCredit(credit.id, "rejeitada"); await reload(); }}>Rejeitar</button><button className="btn btn-primary" onClick={async () => { await accountsPayableApi.reviewCredit(credit.id, "aceite"); await reload(); }}>Aceitar {money(Number(credit.amount), selected.currency)}</button></div>}</div>)}</div>}
    </div>}

    <div className="card overflow-hidden">
      <div className="card-pad border-b border-gray-100"><h3 className="font-semibold">Não-conformidades</h3><p className="text-xs text-gray-500">Material rejeitado, solução do fornecedor e devolução.</p></div>
      {ncrs.length === 0 ? <div className="card-pad text-sm text-gray-500">Nenhuma não-conformidade registada.</div> : ncrs.map(({ ncr, supplierName, materialName, returns }) => <div key={ncr.id} className="px-4 py-3 border-t border-gray-100">
        <div className="flex justify-between gap-4"><div><strong className="text-sm">{ncr.reference} · {materialName}</strong><p className="text-xs text-gray-500">{supplierName} · rejeitado {Number(ncr.rejectedQty).toLocaleString("pt-MZ")} · {ncr.status.replaceAll("_", " ")}</p></div><span className="text-xs font-medium">{ncr.resolutionType?.replaceAll("_", " ") ?? "aguarda solução"}</span></div>
        <p className="text-sm mt-2">{ncr.description}</p>{ncr.supplierResponse && <p className="text-sm mt-1"><strong>Fornecedor:</strong> {ncr.supplierResponse}</p>}
        {returns.length > 0 && <div className="mt-2 space-y-1">{returns.map((ret) => <div key={ret.id} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-600"><strong className="text-gray-800">{ret.reference}</strong> · {Number(ret.quantity).toLocaleString("pt-MZ")} · {ret.status.replaceAll("_", " ")}{ret.returnDate ? ` · ${ret.returnDate}` : ""}{ret.trackingReference ? ` · ref. ${ret.trackingReference}` : ""}</div>)}</div>}
        {canApprove && ncr.status === "solucao_proposta" && <button className="btn btn-primary mt-2" onClick={async () => { await accountsPayableApi.acceptSolution(ncr.id); await reload(); }}>Aceitar solução proposta</button>}
        {canApprove && !["resolvida", "cancelada"].includes(ncr.status) && <div className="mt-2 grid md:grid-cols-[1fr_auto] gap-2"><input className="input" placeholder="Nota para encerrar após substituição/regularização" value={resolutionNotes[ncr.id] ?? ""} onChange={(e) => setResolutionNotes((current) => ({ ...current, [ncr.id]: e.target.value }))} /><button className="btn" disabled={(resolutionNotes[ncr.id]?.trim().length ?? 0) < 5} onClick={async () => { await accountsPayableApi.resolveNcr(ncr.id, resolutionNotes[ncr.id]); await reload(); }}>Marcar resolvida</button></div>}
        {canApprove && ncr.status === "devolucao_pendente" && <div className="mt-2 grid md:grid-cols-[160px_1fr_auto] gap-2"><input type="number" className="input" placeholder="Qtd." value={returnQty[ncr.id] ?? ncr.rejectedQty} onChange={(e) => setReturnQty((current) => ({ ...current, [ncr.id]: e.target.value }))}/><input className="input" placeholder="Motivo / referência de devolução" value={resolutionNotes[ncr.id] ?? "Material rejeitado em recepção"} onChange={(e) => setResolutionNotes((current) => ({ ...current, [ncr.id]: e.target.value }))}/><button className="btn" onClick={async () => { await accountsPayableApi.createReturn(ncr.id, { quantity: Number(returnQty[ncr.id] ?? ncr.rejectedQty), returnDate: today(), reason: resolutionNotes[ncr.id] ?? "Material rejeitado em recepção" }); await reload(); }}>Registar devolução</button></div>}
      </div>)}
    </div>
  </div>;
}

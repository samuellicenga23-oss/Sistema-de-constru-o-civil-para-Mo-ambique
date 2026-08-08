import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { supplierPortalAuthApi, type SupplierAccount } from "../api/supplierPortal";
import { fulfillmentApi, type SupplierOrder } from "../api/fulfillment";
import { supplierAccountsPayableApi, type InvoicingContext, type SupplierInvoice } from "../api/accountsPayable";

function money(value: number, currency: string) { return new Intl.NumberFormat("pt-MZ", { style: "currency", currency, maximumFractionDigits: 2 }).format(value); }
function today() { return new Date().toISOString().slice(0, 10); }

export default function SupplierInvoicesPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [account, setAccount] = useState<SupplierAccount | null>(null);
  const [invoices, setInvoices] = useState<SupplierInvoice[]>([]);
  const [orders, setOrders] = useState<SupplierOrder[]>([]);
  const [context, setContext] = useState<InvoicingContext | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState(searchParams.get("orderId") ?? "");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [issueDate, setIssueDate] = useState(today());
  const [dueDate, setDueDate] = useState("");
  const [ivaRate, setIvaRate] = useState("0.16");
  const [transportCost, setTransportCost] = useState("0");
  const [lineQty, setLineQty] = useState<Record<string, string>>({});
  const [lineCost, setLineCost] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const [invoiceRows, orderRows] = await Promise.all([supplierAccountsPayableApi.invoices(), fulfillmentApi.orders()]);
    setInvoices(invoiceRows);
    setOrders(orderRows.filter((order) => ["aprovado", "recebido"].includes(order.status)));
  }

  useEffect(() => {
    supplierPortalAuthApi.me().then(async (me) => { setAccount(me); await reload(); }).catch(() => navigate("/login", { replace: true })).finally(() => setLoading(false));
  }, [navigate]);

  useEffect(() => {
    if (!selectedOrderId) { setContext(null); return; }
    setError(null);
    supplierAccountsPayableApi.invoicingContext(selectedOrderId).then((ctx) => {
      setContext(ctx);
      setIvaRate(String(Number(ctx.order.ivaRate)));
      setTransportCost(String(ctx.transportInvoiceable));
      const qty: Record<string, string> = {}; const costs: Record<string, string> = {};
      for (const line of ctx.lines) { if (line.invoiceableQty > 0) qty[line.id] = String(line.invoiceableQty); costs[line.id] = String(line.unitCost); }
      setLineQty(qty); setLineCost(costs);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "Não foi possível carregar a OC"));
  }, [selectedOrderId]);

  const draftTotal = useMemo(() => {
    if (!context) return 0;
    const subtotal = context.lines.reduce((sum, line) => sum + Number(lineQty[line.id] ?? 0) * Number(lineCost[line.id] ?? line.unitCost), 0);
    const taxable = subtotal + Number(transportCost || 0);
    return taxable * (1 + Number(ivaRate || 0));
  }, [context, lineQty, lineCost, transportCost, ivaRate]);

  async function submit() {
    if (!context || !selectedOrderId) return;
    const lines = context.lines.map((line) => ({ purchaseOrderLineId: line.id, quantity: Number(lineQty[line.id] ?? 0), unitCost: Number(lineCost[line.id] ?? line.unitCost) })).filter((line) => line.quantity > 0);
    if (!invoiceNumber.trim() || !lines.length) { setError("Indique o número da factura e pelo menos uma quantidade."); return; }
    setSaving(true); setError(null);
    try {
      await supplierAccountsPayableApi.createInvoice(selectedOrderId, { invoiceNumber: invoiceNumber.trim(), issueDate, dueDate: dueDate || null, ivaRate: Number(ivaRate), transportCost: Number(transportCost || 0), notes: notes || undefined, lines });
      setInvoiceNumber(""); setNotes(""); setSelectedOrderId(""); setContext(null); setSearchParams({}); await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível submeter a factura"); }
    finally { setSaving(false); }
  }

  if (loading || !account) return <AppShell accountName={account?.name ?? "…"}><main className="portal-main"><div className="skeleton" style={{ height: "16rem" }} /></main></AppShell>;
  return <AppShell accountName={account.name}>
    <main className="portal-main">
      <section className="hero-panel fade-up"><div className="hero-panel-content"><p className="hero-eyebrow">Contas a receber</p><h1 className="hero-title">Facturas</h1><p className="hero-subtitle">Facture apenas quantidades aceites pela obra. O SIGO confere automaticamente OC × recepção × factura.</p></div></section>
      {error && <div className="card card-pad" style={{ color: "#b42318" }}>{error}</div>}
      <div className="card card-pad">
        <h2 style={{ marginTop: 0 }}>Emitir factura</h2>
        <label className="label">Ordem de compra</label>
        <select className="input" value={selectedOrderId} onChange={(e) => { setSelectedOrderId(e.target.value); if (e.target.value) setSearchParams({ orderId: e.target.value }); else setSearchParams({}); }}>
          <option value="">Seleccionar OC</option>{orders.map((order) => <option key={order.id} value={order.id}>{order.companyName} · {order.projectName} · {order.id.slice(0, 8)}</option>)}
        </select>
        {context && <div style={{ marginTop: "1rem", display: "grid", gap: "0.75rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: "0.75rem" }}><label><span className="label">N.º factura</span><input className="input" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} /></label><label><span className="label">Data emissão</span><input type="date" className="input" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} /></label><label><span className="label">Vencimento</span><input type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label><label><span className="label">IVA</span><input type="number" step="0.01" className="input" value={ivaRate} onChange={(e) => setIvaRate(e.target.value)} /></label></div>
          {context.lines.map((line) => <div key={line.id} style={{ border: "1px solid var(--border)", borderRadius: "0.9rem", padding: "0.8rem", display: "grid", gridTemplateColumns: "1fr 130px 150px", gap: "0.7rem", alignItems: "end" }}><div><strong>{line.description}</strong><p className="text-muted-sm">Aceite {line.acceptedQty.toLocaleString("pt-MZ")} · já facturado {line.alreadyInvoicedQty.toLocaleString("pt-MZ")} · disponível {line.invoiceableQty.toLocaleString("pt-MZ")}</p></div><label><span className="label">Qtd.</span><input type="number" min="0" max={line.invoiceableQty} step="any" className="input" value={lineQty[line.id] ?? ""} onChange={(e) => setLineQty((current) => ({ ...current, [line.id]: e.target.value }))}/></label><label><span className="label">Preço unitário</span><input type="number" min="0" step="any" className="input" value={lineCost[line.id] ?? ""} onChange={(e) => setLineCost((current) => ({ ...current, [line.id]: e.target.value }))}/></label></div>)}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 180px", gap: "0.75rem" }}><label><span className="label">Observações</span><textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></label><label><span className="label">Transporte</span><input type="number" min="0" className="input" value={transportCost} onChange={(e) => setTransportCost(e.target.value)} /><span className="text-muted-sm">Disponível OC: {money(context.transportInvoiceable, context.lines[0]?.currency ?? "MZN")}</span></label></div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}><strong>Total estimado: {money(draftTotal, context.lines[0]?.currency ?? "MZN")}</strong><button className="btn btn-primary" disabled={saving} onClick={submit}>{saving ? "A enviar…" : "Submeter factura"}</button></div>
        </div>}
      </div>

      <div className="card"><div className="card-header"><h2>Histórico</h2><p>Estado de revisão e pagamento.</p></div>{invoices.length === 0 ? <div className="card-pad text-muted-sm">Ainda não existem facturas.</div> : invoices.map((invoice) => <Link key={invoice.id} to={`/facturas/${invoice.id}`} style={{ textDecoration: "none", color: "inherit", display: "flex", justifyContent: "space-between", gap: "1rem", padding: "0.9rem 1.25rem", borderTop: "1px solid var(--border)" }}><div><strong>{invoice.invoiceNumber}</strong><p className="text-muted-sm">{invoice.companyName} · {invoice.projectName} · {invoice.status.replaceAll("_", " ")}</p></div><div style={{ textAlign: "right" }}><strong>{money(Number(invoice.totalAmount), invoice.currency)}</strong><p className="text-muted-sm">Em aberto {money(invoice.balance.outstanding, invoice.currency)}</p></div></Link>)}</div>
    </main>
  </AppShell>;
}

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { supplierPortalAuthApi, type SupplierAccount } from "../api/supplierPortal";
import { fulfillmentApi, type SupplierOrder } from "../api/fulfillment";

function todayPlus(days: number) {
  const value = new Date();
  value.setDate(value.getDate() + days);
  return value.toISOString().slice(0, 10);
}

function money(value: number, currency: string) {
  return new Intl.NumberFormat("pt-MZ", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}

export default function SupplierOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [account, setAccount] = useState<SupplierAccount | null>(null);
  const [order, setOrder] = useState<SupplierOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promisedDate, setPromisedDate] = useState(todayPlus(2));
  const [message, setMessage] = useState("");
  const [shipmentOpen, setShipmentOpen] = useState(false);
  const [expectedDate, setExpectedDate] = useState(todayPlus(1));
  const [tracking, setTracking] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [shipmentQty, setShipmentQty] = useState<Record<string, string>>({});

  async function reload() {
    if (!id) return;
    const detail = await fulfillmentApi.order(id);
    setOrder(detail);
    setPromisedDate(detail.promisedDeliveryDate ?? detail.requiredByDate ?? todayPlus(2));
  }

  useEffect(() => {
    if (!id) return;
    supplierPortalAuthApi.me().then(async (me) => { setAccount(me); await reload(); }).catch(() => navigate("/login", { replace: true })).finally(() => setLoading(false));
  }, [id, navigate]);

  const summaryByLine = useMemo(() => new Map(order?.summary.lines.map((line) => [line.purchaseOrderLineId, line]) ?? []), [order]);
  const total = useMemo(() => (order?.lines ?? []).reduce((sum, line) => sum + Number(line.quantity) * Number(line.unitCost), Number(order?.transportCost ?? 0)), [order]);

  async function act(action: "confirm" | "change" | "decline" | "preparing") {
    if (!order) return;
    setSaving(true); setError(null);
    try {
      if (action === "confirm") await fulfillmentApi.confirm(order.id, { promisedDeliveryDate: promisedDate, notes: message || undefined });
      else if (action === "change") await fulfillmentApi.requestChange(order.id, message);
      else if (action === "decline") await fulfillmentApi.decline(order.id, message);
      else await fulfillmentApi.preparing(order.id);
      setMessage(""); await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível actualizar a ordem"); }
    finally { setSaving(false); }
  }

  function openShipment() {
    const initial: Record<string, string> = {};
    for (const line of order?.lines ?? []) {
      const remaining = summaryByLine.get(line.id)?.remainingToDispatchQty ?? Number(line.quantity);
      if (remaining > 0) initial[line.id] = String(remaining);
    }
    setShipmentQty(initial); setShipmentOpen(true);
  }

  async function createShipment() {
    if (!order) return;
    const lines = (order.lines ?? []).map((line) => ({ purchaseOrderLineId: line.id, quantity: Number(shipmentQty[line.id] ?? 0) })).filter((line) => line.quantity > 0);
    if (!lines.length) return setError("Indique pelo menos uma quantidade a expedir.");
    setSaving(true); setError(null);
    try {
      await fulfillmentApi.createShipment(order.id, { expectedDeliveryDate: expectedDate || null, trackingReference: tracking || undefined, vehiclePlate: vehicle || undefined, lines });
      setShipmentOpen(false); setTracking(""); setVehicle(""); await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível criar a expedição"); }
    finally { setSaving(false); }
  }

  if (loading || !account) return <AppShell accountName={account?.name ?? "…"}><main className="portal-main"><div className="skeleton" style={{ height: "18rem" }} /></main></AppShell>;
  if (!order) return <AppShell accountName={account.name}><main className="portal-main"><div className="card card-pad">OC não encontrada.</div></main></AppShell>;

  return (
    <AppShell accountName={account.name}>
      <main className="portal-main">
        <div><Link to="/ordens" className="text-muted-sm">← Ordens de Compra</Link></div>
        <section className="hero-panel fade-up">
          <div className="hero-panel-content">
            <p className="hero-eyebrow">{order.companyName} · {order.projectName}</p>
            <h1 className="hero-title">Ordem de Compra</h1>
            <p className="hero-subtitle">Necessário: {order.requiredByDate ?? "sem data"} · Estado: {order.fulfillmentStatus.replaceAll("_", " ")}</p>
          </div>
        </section>

        {error && <div className="card card-pad" style={{ color: "#b42318" }}>{error}</div>}

        <div className="card">
          <div className="card-header"><h2>Itens adjudicados</h2><p>Total sem IVA: {money(total, order.lines?.[0]?.currency ?? "MZN")}</p></div>
          {(order.lines ?? []).map((line) => {
            const summary = summaryByLine.get(line.id);
            return <div key={line.id} style={{ padding: "0.9rem 1.25rem", borderTop: "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem" }}><strong>{line.materialName}</strong><strong>{money(Number(line.unitCost), line.currency)}/{line.unit}</strong></div>
              <p className="text-muted-sm">OC {Number(line.quantity).toLocaleString("pt-MZ")} {line.unit} · expedido {summary?.dispatchedQty.toLocaleString("pt-MZ") ?? 0} · aceite {summary?.acceptedQty.toLocaleString("pt-MZ") ?? 0} · pendente {summary?.remainingToReceiveQty.toLocaleString("pt-MZ") ?? line.quantity}</p>
            </div>;
          })}
        </div>

        {order.status === "aprovado" && (order.supplierConfirmationStatus === "pendente" || order.supplierConfirmationStatus === "alteracao_solicitada") && (
          <div className="card card-pad">
            <h2 style={{ marginTop: 0 }}>{order.supplierConfirmationStatus === "alteracao_solicitada" ? "Reconfirmar após alinhamento" : "Responder à ordem"}</h2>
            {order.supplierConfirmationStatus === "alteracao_solicitada" && order.supplierResponseNotes && <p className="text-muted-sm" style={{ marginTop: 0 }}>Pedido anterior: {order.supplierResponseNotes}. Depois de alinhar com a empresa, confirme a nova data/condição aqui.</p>}
            <label className="label">Data que consegue cumprir</label>
            <input type="date" className="input" value={promisedDate} onChange={(e) => setPromisedDate(e.target.value)} />
            <label className="label" style={{ marginTop: "0.75rem" }}>Mensagem / condição</label>
            <textarea className="input" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "1rem" }}>
              <button className="btn btn-primary" disabled={saving || !promisedDate} onClick={() => act("confirm")}>Confirmar OC</button>
              {order.supplierConfirmationStatus === "pendente" && <button className="btn" disabled={saving || message.trim().length < 5} onClick={() => act("change")}>Pedir alteração</button>}
              {order.supplierConfirmationStatus === "pendente" && <button className="btn" disabled={saving || message.trim().length < 5} onClick={() => act("decline")}>Recusar</button>}
            </div>
          </div>
        )}

        {order.status === "aprovado" && order.supplierConfirmationStatus === "confirmado" && order.fulfillmentStatus !== "recebido" && (
          <div className="card card-pad">
            <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "center" }}>
              <div><h2 style={{ margin: 0 }}>Preparação e expedição</h2><p className="text-muted-sm">Promessa: {order.promisedDeliveryDate ?? "—"}</p></div>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                {order.fulfillmentStatus === "confirmado" && <button className="btn" disabled={saving} onClick={() => act("preparing")}>Iniciar preparação</button>}
                <button className="btn btn-primary" onClick={openShipment}>Nova expedição</button>
              </div>
            </div>
          </div>
        )}

        {(order.shipments ?? []).length > 0 && <div className="card">
          <div className="card-header"><h2>Expedições</h2><p>Cargas declaradas ao SIGO.</p></div>
          {(order.shipments ?? []).map((shipment) => <div key={shipment.id} style={{ padding: "0.9rem 1.25rem", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
            <div><strong>{shipment.reference}</strong><p className="text-muted-sm">{shipment.status} · previsão {shipment.expectedDeliveryDate ?? "—"}{shipment.trackingReference ? ` · ${shipment.trackingReference}` : ""}</p></div>
            <div style={{ display: "flex", gap: "0.4rem" }}>
              {shipment.status === "rascunho" && <button className="btn" onClick={async () => { await fulfillmentApi.ready(shipment.id); await reload(); }}>Pronta</button>}
              {shipment.status === "pronto" && <button className="btn btn-primary" onClick={async () => { await fulfillmentApi.dispatch(shipment.id); await reload(); }}>Expedir</button>}
              {(shipment.status === "rascunho" || shipment.status === "pronto") && <button className="btn" onClick={async () => { await fulfillmentApi.cancelShipment(shipment.id); await reload(); }}>Anular</button>}
            </div>
          </div>)}
        </div>}

        {shipmentOpen && <div className="card card-pad">
          <h2>Nova expedição</h2>
          <div style={{ display: "grid", gap: "0.75rem" }}>
            {(order.lines ?? []).map((line) => <label key={line.id}><span className="label">{line.materialName} · máximo {summaryByLine.get(line.id)?.remainingToDispatchQty.toLocaleString("pt-MZ") ?? line.quantity} {line.unit}</span><input type="number" min="0" step="any" className="input" value={shipmentQty[line.id] ?? ""} onChange={(e) => setShipmentQty((current) => ({ ...current, [line.id]: e.target.value }))} /></label>)}
            <label><span className="label">Previsão de chegada</span><input type="date" className="input" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} /></label>
            <label><span className="label">Referência de transporte</span><input className="input" value={tracking} onChange={(e) => setTracking(e.target.value)} /></label>
            <label><span className="label">Matrícula</span><input className="input" value={vehicle} onChange={(e) => setVehicle(e.target.value)} /></label>
          </div>
          <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}><button className="btn" onClick={() => setShipmentOpen(false)}>Cancelar</button><button className="btn btn-primary" disabled={saving} onClick={createShipment}>Guardar expedição</button></div>
        </div>}
      </main>
    </AppShell>
  );
}

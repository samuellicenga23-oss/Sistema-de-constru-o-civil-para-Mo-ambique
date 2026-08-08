import { useEffect, useMemo, useState } from "react";
import Modal from "./Modal";
import { MetricCard, SectionHeader } from "./WorkspaceUI";
import {
  procurementFulfillmentApi,
  type FulfillmentOrder,
  type FulfillmentOrderDetail,
  type GoodsReceipt,
  type SupplierPerformance,
} from "../api/procurementFulfillment";

const CONFIRM_LABEL: Record<FulfillmentOrder["supplierConfirmationStatus"], string> = {
  pendente: "Aguarda fornecedor",
  confirmado: "Confirmada",
  alteracao_solicitada: "Alteração solicitada",
  recusado: "Recusada",
};

const FLOW_LABEL: Record<FulfillmentOrder["fulfillmentStatus"], string> = {
  aguarda_confirmacao: "A confirmar",
  confirmado: "Confirmada",
  em_preparacao: "Em preparação",
  pronto_expedir: "Pronta a expedir",
  em_transito: "Em trânsito",
  parcialmente_recebido: "Recepção parcial",
  recebido: "Recebida",
  fechado: "Fechada",
};

function today() { return new Date().toISOString().slice(0, 10); }
function fmt(value: number | null, suffix = "%") { return value == null ? "—" : `${value.toFixed(1)}${suffix}`; }

type ReceiptDraftLine = {
  purchaseOrderLineId: string;
  materialName: string;
  unit: string;
  remaining: number;
  deliveredQty: string;
  acceptedQty: string;
  rejectedQty: string;
  rejectionReason: string;
};

export default function ProcurementFulfillmentPanel({ projectId, canReceive, onChanged }: { projectId: string; canReceive: boolean; onChanged?: () => Promise<void> | void }) {
  const [orders, setOrders] = useState<FulfillmentOrder[]>([]);
  const [receipts, setReceipts] = useState<GoodsReceipt[]>([]);
  const [performance, setPerformance] = useState<Record<string, SupplierPerformance>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<FulfillmentOrderDetail | null>(null);
  const [receiptShipmentId, setReceiptShipmentId] = useState("");
  const [receiptDate, setReceiptDate] = useState(today());
  const [deliveryNote, setDeliveryNote] = useState("");
  const [inspectionNotes, setInspectionNotes] = useState("");
  const [draftLines, setDraftLines] = useState<ReceiptDraftLine[]>([]);

  async function reload() {
    setLoading(true);
    try {
      const [orderRows, receiptRows] = await Promise.all([
        procurementFulfillmentApi.projectOrders(projectId),
        procurementFulfillmentApi.receipts(projectId),
      ]);
      setOrders(orderRows);
      setReceipts(receiptRows);
      const supplierIds = [...new Set(orderRows.map((order) => order.supplierId))];
      const pairs = await Promise.all(supplierIds.map(async (supplierId) => [supplierId, await procurementFulfillmentApi.supplierPerformance(supplierId, projectId).catch(() => null)] as const));
      setPerformance(Object.fromEntries(pairs.filter((pair): pair is readonly [string, SupplierPerformance] => pair[1] != null)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Erro ao carregar execução das compras");
    } finally { setLoading(false); }
  }

  useEffect(() => { void reload(); }, [projectId]);

  const active = useMemo(() => orders.filter((order) => order.status === "aprovado"), [orders]);
  const atRisk = useMemo(() => active.filter((order) => order.requiredByDate && order.promisedDeliveryDate && order.promisedDeliveryDate > order.requiredByDate), [active]);
  const partial = useMemo(() => active.filter((order) => order.fulfillmentStatus === "parcialmente_recebido"), [active]);

  function buildReceiptLines(detail: FulfillmentOrderDetail, shipmentId: string) {
    const summary = new Map(detail.summary.lines.map((line) => [line.purchaseOrderLineId, line]));
    const shipment = shipmentId ? detail.shipments.find((row) => row.id === shipmentId) : null;
    const shipmentQty = new Map((shipment?.lines ?? []).map((line) => [line.purchaseOrderLineId, Number(line.quantity)]));
    return detail.lines.map((line) => {
      const remaining = summary.get(line.id)?.remainingToReceiveQty ?? Number(line.quantity);
      const declared = shipment ? (shipmentQty.get(line.id) ?? 0) : remaining;
      const delivered = Math.min(remaining, declared);
      return {
        purchaseOrderLineId: line.id,
        materialName: line.materialName,
        unit: line.unit,
        remaining,
        deliveredQty: delivered > 0 ? String(delivered) : "0",
        acceptedQty: delivered > 0 ? String(delivered) : "0",
        rejectedQty: "0",
        rejectionReason: "",
      };
    }).filter((line) => Number(line.deliveredQty) > 0);
  }

  async function openReceipt(order: FulfillmentOrder) {
    setError(null);
    try {
      const detail = await procurementFulfillmentApi.order(order.id);
      const dispatched = detail.shipments.filter((shipment) => shipment.status === "expedido");
      const activePrepared = detail.shipments.filter((shipment) => shipment.status === "rascunho" || shipment.status === "pronto");
      const shipmentId = dispatched.length === 1 ? dispatched[0].id : "";
      setReceiptShipmentId(shipmentId);
      setDraftLines(buildReceiptLines(detail, shipmentId));
      setSelectedOrder(detail);
      if (!dispatched.length && activePrepared.length) {
        setError("O fornecedor tem uma carga preparada que ainda não foi expedida. A recepção deve aguardar a expedição ou a carga deve ser anulada.");
      }
      setReceiptDate(today());
      setDeliveryNote("");
      setInspectionNotes("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível abrir a recepção"); }
  }

  function updateLine(index: number, patch: Partial<ReceiptDraftLine>) {
    setDraftLines((current) => current.map((line, i) => i === index ? { ...line, ...patch } : line));
  }

  async function saveAndConfirm() {
    if (!selectedOrder) return;
    const lines = draftLines.map((line) => ({
      purchaseOrderLineId: line.purchaseOrderLineId,
      deliveredQty: Number(line.deliveredQty),
      acceptedQty: Number(line.acceptedQty),
      rejectedQty: Number(line.rejectedQty),
      rejectionReason: line.rejectionReason || undefined,
    })).filter((line) => line.deliveredQty > 0);
    if (!lines.length) return setError("Indique pelo menos uma quantidade entregue.");
    setSaving(true); setError(null);
    try {
      const dispatched = selectedOrder.shipments.filter((shipment) => shipment.status === "expedido");
      if (dispatched.length && !receiptShipmentId) throw new Error("Seleccione a expedição que chegou à obra");
      const receipt = await procurementFulfillmentApi.createReceipt(selectedOrder.id, {
        shipmentId: receiptShipmentId || null,
        receiptDate,
        deliveryNoteNumber: deliveryNote || undefined,
        inspectionNotes: inspectionNotes || undefined,
        lines,
      });
      await procurementFulfillmentApi.confirmReceipt(receipt.id);
      setSelectedOrder(null);
      await reload();
      await onChanged?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível confirmar a recepção"); }
    finally { setSaving(false); }
  }

  async function confirmDraft(receipt: GoodsReceipt) {
    setSaving(true); setError(null);
    try { await procurementFulfillmentApi.confirmReceipt(receipt.id); await reload(); await onChanged?.(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível confirmar a recepção"); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="card p-6 text-sm text-slate-500">A carregar execução das compras…</div>;

  return <div className="space-y-5">
    {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <MetricCard label="OCs em execução" value={active.length} note={`${active.filter((order) => order.supplierConfirmationStatus === "pendente").length} por confirmar`} />
      <MetricCard label="Em risco de prazo" value={atRisk.length} tone={atRisk.length ? "warning" : "positive"} note="Promessa posterior à necessidade" />
      <MetricCard label="Recepções parciais" value={partial.length} note="Com saldo ainda por entregar" />
      <MetricCard label="Recepções confirmadas" value={receipts.filter((receipt) => receipt.status === "confirmado").length} tone="positive" />
    </div>

    <section className="card overflow-hidden">
      <SectionHeader title="Ordens em execução" description="Confirmação do fornecedor, expedição, recepção e saldo por entregar" />
      <div className="divide-y divide-slate-100">
        {orders.map((order) => {
          const perf = performance[order.supplierId];
          const lateRisk = order.status === "aprovado" && order.requiredByDate && order.promisedDeliveryDate && order.promisedDeliveryDate > order.requiredByDate;
          return <article key={order.id} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <strong className="text-sm text-slate-950">{order.supplierName}</strong>
                <p className="mt-1 text-xs text-slate-500">Confirmação: {CONFIRM_LABEL[order.supplierConfirmationStatus]} · Logística: {FLOW_LABEL[order.fulfillmentStatus]}</p>
                <p className="mt-1 text-xs text-slate-500">Necessário {order.requiredByDate ?? "—"} · Prometido {order.promisedDeliveryDate ?? "—"}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {lateRisk && <span className="badge badge-red">Risco de atraso</span>}
                <span className="badge badge-gray">Aceite {order.summary.fillRatePct.toFixed(1)}%</span>
                {order.summary.rejectionRatePct > 0 && <span className="badge badge-orange">Rejeição {order.summary.rejectionRatePct.toFixed(1)}%</span>}
              </div>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-slate-900" style={{ width: `${Math.min(100, order.summary.fillRatePct)}%` }} /></div>
            <div className="mt-3 grid gap-2 text-xs sm:grid-cols-5">
              <div><span className="text-slate-500">Score fornecedor</span><strong className="block">{perf?.score == null ? "—" : `${perf.score.toFixed(0)}/100`}</strong></div>
              <div><span className="text-slate-500">OTIF / aceitação</span><strong className="block">{fmt(perf?.otifPct ?? null)} · {fmt(perf?.acceptanceRatePct ?? null)}</strong></div>
              <div><span className="text-slate-500">Chegou até necessidade</span><strong className="block">{fmt(perf?.needByHitRatePct ?? null)}</strong></div>
              <div><span className="text-slate-500">Atraso vs promessa</span><strong className="block">{fmt(perf?.averageDelayDays ?? null, " d")}</strong></div>
              <div className="flex items-end justify-end">{canReceive && order.status === "aprovado" && order.summary.fillRatePct < 100 && <button className="btn btn-primary btn-sm" onClick={() => openReceipt(order)}>Registar recepção</button>}</div>
            </div>
            {order.supplierConfirmationStatus === "alteracao_solicitada" && order.supplierResponseNotes && <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"><strong>Alteração solicitada:</strong> {order.supplierResponseNotes}</div>}
            {order.supplierConfirmationStatus === "recusado" && order.supplierResponseNotes && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"><strong>OC recusada:</strong> {order.supplierResponseNotes}</div>}
          </article>;
        })}
        {!orders.length && <div className="p-6 text-sm text-slate-500">Ainda não existem ordens de compra para acompanhar.</div>}
      </div>
    </section>

    <section className="card overflow-hidden">
      <SectionHeader title="Recepções" description="Só quantidades aceites entram automaticamente no stock" />
      <div className="divide-y divide-slate-100">
        {receipts.map((receipt) => <article key={receipt.id} className="p-5">
          <div className="flex items-start justify-between gap-3"><div><strong>{receipt.reference}</strong><p className="text-xs text-slate-500">{receipt.supplierName} · {receipt.receiptDate}{receipt.deliveryNoteNumber ? ` · guia ${receipt.deliveryNoteNumber}` : ""}</p></div><span className={`badge ${receipt.status === "confirmado" ? "badge-green" : "badge-gray"}`}>{receipt.status}</span></div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">{receipt.lines.map((line) => <div key={line.id} className="rounded-lg bg-slate-50 p-3 text-xs"><strong>{line.materialName}</strong><p className="mt-1 text-slate-600">Entregue {Number(line.deliveredQty).toLocaleString("pt-MZ")} {line.unit} · aceite {Number(line.acceptedQty).toLocaleString("pt-MZ")} · rejeitado {Number(line.rejectedQty).toLocaleString("pt-MZ")}</p>{line.rejectionReason && <p className="mt-1 text-red-700">{line.rejectionReason}</p>}</div>)}</div>
          {receipt.status === "rascunho" && canReceive && <div className="mt-3 flex justify-end gap-2"><button className="btn btn-sm" disabled={saving} onClick={async () => { setSaving(true); try { await procurementFulfillmentApi.cancelReceipt(receipt.id); await reload(); } finally { setSaving(false); } }}>Anular rascunho</button><button className="btn btn-primary btn-sm" disabled={saving} onClick={() => confirmDraft(receipt)}>Confirmar recepção</button></div>}
        </article>)}
        {!receipts.length && <div className="p-6 text-sm text-slate-500">Nenhuma recepção registada.</div>}
      </div>
    </section>

    {selectedOrder && <Modal title={`Recepção — ${selectedOrder.supplierName}`} subtitle="Entregue = aceite + rejeitado. Só o aceite entra no stock." onClose={() => setSelectedOrder(null)} maxWidth="max-w-3xl">
      <div className="space-y-4">
        {selectedOrder.shipments.some((shipment) => shipment.status === "expedido") && <label><span className="label">Expedição recebida</span><select className="input" value={receiptShipmentId} onChange={(e) => { const value = e.target.value; setReceiptShipmentId(value); setDraftLines(buildReceiptLines(selectedOrder, value)); }}><option value="">Seleccione a carga</option>{selectedOrder.shipments.filter((shipment) => shipment.status === "expedido").map((shipment) => <option key={shipment.id} value={shipment.id}>{shipment.reference} · previsão {shipment.expectedDeliveryDate ?? "—"}</option>)}</select></label>}
        {!selectedOrder.shipments.some((shipment) => ["rascunho", "pronto", "expedido"].includes(shipment.status)) && <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">Recepção directa/legada — não existe expedição activa no Portal do Fornecedor.</div>}
        <div className="grid gap-3 sm:grid-cols-2"><label><span className="label">Data da recepção</span><input type="date" className="input" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} /></label><label><span className="label">Guia / nota de entrega</span><input className="input" value={deliveryNote} onChange={(e) => setDeliveryNote(e.target.value)} /></label></div>
        <div className="space-y-3">{draftLines.map((line, index) => <div key={line.purchaseOrderLineId} className="rounded-xl border border-slate-200 p-4"><div className="flex justify-between gap-3"><strong>{line.materialName}</strong><span className="text-xs text-slate-500">Pendente {line.remaining.toLocaleString("pt-MZ")} {line.unit}</span></div><div className="mt-3 grid gap-2 sm:grid-cols-3"><label><span className="label">Entregue</span><input type="number" min="0" step="any" className="input" value={line.deliveredQty} onChange={(e) => updateLine(index, { deliveredQty: e.target.value })} /></label><label><span className="label">Aceite</span><input type="number" min="0" step="any" className="input" value={line.acceptedQty} onChange={(e) => updateLine(index, { acceptedQty: e.target.value })} /></label><label><span className="label">Rejeitado</span><input type="number" min="0" step="any" className="input" value={line.rejectedQty} onChange={(e) => updateLine(index, { rejectedQty: e.target.value })} /></label></div>{Number(line.rejectedQty) > 0 && <label className="mt-2 block"><span className="label">Motivo da rejeição</span><input className="input" value={line.rejectionReason} onChange={(e) => updateLine(index, { rejectionReason: e.target.value })} placeholder="Ex.: sacos molhados, especificação incorrecta…" /></label>}</div>)}</div>
        <label><span className="label">Observações da inspecção</span><textarea className="input" rows={3} value={inspectionNotes} onChange={(e) => setInspectionNotes(e.target.value)} /></label>
        <div className="flex justify-end gap-2"><button className="btn" onClick={() => setSelectedOrder(null)}>Cancelar</button><button className="btn btn-primary" disabled={saving} onClick={saveAndConfirm}>{saving ? "A confirmar…" : "Registar e confirmar"}</button></div>
      </div>
    </Modal>}
  </div>;
}

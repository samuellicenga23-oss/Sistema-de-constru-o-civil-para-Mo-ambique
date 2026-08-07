import { useState, type FormEvent } from "react";
import { calculateVatTotals } from "@sigo/shared";
import { companiesApi } from "../api/companies";
import { formatMzn } from "../commercialPlans";
import Modal from "./Modal";
import AlertBanner from "./AlertBanner";
import PaymentDetailsCard from "./PaymentDetailsCard";

const METHODS = [
  { value: "transferencia", label: "Transferência bancária" },
  { value: "mpesa", label: "M-Pesa" },
  { value: "emola", label: "e-Mola" },
] as const;

export default function SubmitPaymentProofModal({
  planKey,
  planLabel,
  monthlyPriceMzn,
  annualPriceMzn,
  onClose,
  onSubmitted,
}: {
  planKey: string;
  planLabel: string;
  monthlyPriceMzn: number;
  annualPriceMzn: number;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [billingCycle, setBillingCycle] = useState<"monthly" | "annual">("monthly");
  const [method, setMethod] = useState<(typeof METHODS)[number]["value"]>("transferencia");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const netAmount = billingCycle === "annual" ? annualPriceMzn : monthlyPriceMzn;
  const totals = calculateVatTotals(netAmount);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Anexe o comprovativo de pagamento (imagem ou PDF).");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await companiesApi.submitPaymentProof({
        plan: planKey,
        billingCycle,
        amount: totals.total,
        currency: "MZN",
        method,
        reference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
        file,
      });
      setDone(true);
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao enviar o comprovativo");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <Modal title="Pedido enviado" onClose={onClose}>
        <AlertBanner tone="success">
          Recebemos o comprovativo para o plano <strong>{planLabel}</strong>. A equipa SIGO confirma o pagamento e activa
          a subscrição — normalmente em poucas horas. Pode acompanhar o estado em «Créditos e planos».
        </AlertBanner>
        <button className="btn btn-primary mt-4 w-full" onClick={onClose}>Fechar</button>
      </Modal>
    );
  }

  return (
    <Modal title={`Activar plano ${planLabel}`} subtitle="Pague pelos dados abaixo e anexe o comprovativo" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <AlertBanner tone="error">{error}</AlertBanner>}

        <div className="grid grid-cols-2 rounded-xl bg-slate-100 p-1" role="group" aria-label="Periodicidade">
          <button type="button" onClick={() => setBillingCycle("monthly")} className={`rounded-lg px-3 py-2 text-xs font-bold ${billingCycle === "monthly" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>
            Mensal
          </button>
          <button type="button" onClick={() => setBillingCycle("annual")} className={`rounded-lg px-3 py-2 text-xs font-bold ${billingCycle === "annual" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>
            Anual · −15%
          </button>
        </div>
        <div className="rounded-lg bg-slate-50 p-3 text-sm">
          <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span className="tabular-nums">{formatMzn(totals.subtotal)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">IVA 16%</span><span className="tabular-nums">{formatMzn(totals.iva)}</span></div>
          <div className="mt-1 flex justify-between border-t border-slate-200 pt-1 font-bold"><span>Total a pagar</span><span className="tabular-nums">{formatMzn(totals.total)}</span></div>
        </div>

        <PaymentDetailsCard />

        <div>
          <label className="label">Método usado</label>
          <select className="input" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
            {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Referência / ID da transacção (opcional)</label>
          <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Ex: código da transferência" />
        </div>
        <div>
          <label className="label">Comprovativo *</label>
          <input
            required
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
            className="input"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <p className="mt-1 text-xs text-slate-500">Imagem ou PDF do comprovativo de transferência / M-Pesa / e-Mola.</p>
        </div>
        <div>
          <label className="label">Observações (opcional)</label>
          <textarea className="input min-h-16 resize-y py-2" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div className="flex gap-2">
          <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>Cancelar</button>
          <button type="submit" disabled={submitting} className="btn btn-primary flex-1">
            {submitting ? "A enviar..." : "Enviar comprovativo"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

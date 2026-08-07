import { useState } from "react";
import { PAYMENT_DETAILS } from "../commercialPlans";

export function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <div className="flex items-center justify-between gap-2 border-t border-slate-100 py-1.5 first:border-t-0">
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
        <p className="truncate font-mono text-[13px] text-slate-800">{value}</p>
      </div>
      <button
        type="button"
        onClick={handleCopy}
        className="shrink-0 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
      >
        {copied ? "Copiado" : "Copiar"}
      </button>
    </div>
  );
}

/** Dados bancários / carteira móvel — mostrado tanto no checkout público como no pedido de activação já autenticado. */
export default function PaymentDetailsCard() {
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3.5">
      <div>
        <p className="text-sm font-bold text-slate-900">Dados para pagamento</p>
        <p className="text-xs text-slate-500">Titular: {PAYMENT_DETAILS.holder}</p>
      </div>

      <div>
        <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">Transferência bancária</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {PAYMENT_DETAILS.banks.map((b) => (
            <div key={b.name} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <p className="text-[13px] font-bold text-slate-900">{b.name}</p>
              <CopyRow label="Conta" value={b.account} />
              {"nib" in b && b.nib && <CopyRow label="NIB" value={b.nib} />}
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">Carteira móvel</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {PAYMENT_DETAILS.mobileMoney.map((m) => (
            <div key={m.name} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <p className="text-[13px] font-bold text-slate-900">{m.name}</p>
              <CopyRow label="Número" value={m.number} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  clientPaymentsApi,
  type ClientInstallment,
  type ClientPaymentPlan,
} from "../api/clientPayments";
import Modal from "./Modal";
import MoneyInput from "./MoneyInput";
import { IconPlus, IconTrash } from "./icons";
import { useConfirmDialog } from "../hooks/useConfirmDialog";
import { formatMoneyAmount } from "../lib/moneyFormat";

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmt(value: number, currency: string) {
  return `${formatMoneyAmount(value)} ${currency}`;
}

function statusLabel(row: ClientInstallment, currency: string) {
  if (row.status === "paga") return { text: "Paga", cls: "badge-green" };
  if (row.status === "parcial") {
    return {
      text: `${row.overdue ? "Atrasada · " : ""}Parcial · pago ${fmt(row.paidAmount, currency)}`,
      cls: row.overdue ? "badge-red" : "badge-yellow",
    };
  }
  if (row.status === "atrasada" || row.overdue) return { text: "Atrasada", cls: "badge-red" };
  return { text: "Prevista", cls: "badge-gray" };
}

type Props = {
  projectId: string;
  currency: "MZN" | "USD";
  plan: ClientPaymentPlan | null;
  suggestion: { amount: number; currency: string } | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
};

export default function ClientPaymentPlanModal({
  projectId,
  currency,
  plan,
  suggestion,
  onClose,
  onChanged,
}: Props) {
  const { confirm, dialog } = useConfirmDialog();
  const [mode, setMode] = useState<"total" | "parcelado">(plan?.mode ?? "parcelado");
  const [totalAmount, setTotalAmount] = useState(String(plan?.totalAmount ?? suggestion?.amount ?? ""));
  const [dueDate, setDueDate] = useState(plan?.mode === "total" && plan.installments[0] ? plan.installments[0].dueDate : todayStr());
  const [newTitle, setNewTitle] = useState("");
  const [newDue, setNewDue] = useState(todayStr());
  const [newAmount, setNewAmount] = useState("");
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payFull, setPayFull] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    setMode(plan?.mode ?? "parcelado");
    setTotalAmount(String(plan?.totalAmount ?? suggestion?.amount ?? ""));
    if (plan?.mode === "total" && plan.installments[0]) setDueDate(plan.installments[0].dueDate);
  }, [plan, suggestion]);

  const totals = useMemo(() => {
    const installments = plan?.installments ?? [];
    const planTotal = plan?.totalAmount ?? installments.reduce((sum, row) => sum + row.amount, 0);
    const paid = installments.reduce((sum, row) => sum + row.paidAmount, 0);
    const outstanding = Math.max(0, planTotal - paid);
    const overdueCount = installments.filter((row) => row.status !== "paga" && (row.overdue || row.status === "atrasada")).length;
    const pendingCount = installments.filter((row) => row.status !== "paga").length;
    return { planTotal, paid, outstanding, overdueCount, pendingCount };
  }, [plan]);

  async function run(action: () => Promise<void>, okMessage: string) {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await action();
      await onChanged();
      setSuccess(okMessage);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível concluir a operação");
    } finally {
      setBusy(false);
    }
  }

  async function handleSavePlan(event: FormEvent) {
    event.preventDefault();
    const total = Number(totalAmount);
    if (!(total >= 0)) {
      setError("Indique um valor total válido.");
      return;
    }
    await run(async () => {
      await clientPaymentsApi.savePlan(projectId, {
        mode,
        currency,
        totalAmount: total,
        singleDueDate: mode === "total" ? dueDate : undefined,
        singleTitle: mode === "total" ? "Pagamento total" : undefined,
      });
    }, "Plano de pagamentos actualizado.");
  }

  async function handleAddInstallment(event: FormEvent) {
    event.preventDefault();
    const amount = Number(newAmount);
    if (!newTitle.trim() || !(amount > 0)) {
      setError("Preencha o título e um valor positivo para a parcela.");
      return;
    }
    await run(async () => {
      await clientPaymentsApi.addInstallment(projectId, {
        title: newTitle.trim(),
        dueDate: newDue,
        amount,
      });
      setNewTitle("");
      setNewAmount("");
      setNewDue(todayStr());
    }, "Parcela adicionada.");
  }

  function openPay(row: ClientInstallment, full: boolean) {
    const outstanding = Math.max(0, round2(row.amount - row.paidAmount));
    setPayingId(row.id);
    setPayFull(full);
    setPayAmount(outstanding.toFixed(2));
    setError(null);
    setSuccess(null);
  }

  async function handleConfirmPay(event: FormEvent) {
    event.preventDefault();
    if (!payingId) return;
    const row = plan?.installments.find((item) => item.id === payingId);
    if (!row) return;
    const outstanding = Math.max(0, round2(row.amount - row.paidAmount));
    const value = payFull ? outstanding : Number(payAmount);
    if (!(value > 0) || value > outstanding + 0.001) {
      setError("O pagamento deve ser positivo e não pode exceder o saldo da parcela.");
      return;
    }
    await run(async () => {
      await clientPaymentsApi.markPaid(projectId, payingId, { paidAmount: value });
      setPayingId(null);
      setPayAmount("");
    }, payFull ? "Parcela marcada como paga." : "Pagamento parcial registado.");
  }

  async function handleDelete(row: ClientInstallment) {
    const ok = await confirm({
      title: "Eliminar parcela?",
      message: `«${row.title}» será removida do plano do cliente.`,
      confirmLabel: "Eliminar",
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      await clientPaymentsApi.deleteInstallment(projectId, row.id);
      if (payingId === row.id) setPayingId(null);
    }, "Parcela eliminada.");
  }

  return (
    <>
      <Modal
        title="Gestão de pagamentos do cliente"
        subtitle="Plano e parcelas visíveis no link público"
        onClose={() => !busy && onClose()}
        maxWidth="max-w-3xl"
      >
        <div className="space-y-5">
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {success && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{success}</p>}

          <div className="grid gap-2 sm:grid-cols-4">
            <SummaryChip label="Total do plano" value={fmt(totals.planTotal, currency)} />
            <SummaryChip label="Já pago" value={fmt(totals.paid, currency)} tone="positive" />
            <SummaryChip label="Em aberto" value={fmt(totals.outstanding, currency)} tone="warn" />
            <SummaryChip
              label="Parcelas"
              value={`${totals.pendingCount} em aberto${totals.overdueCount ? ` · ${totals.overdueCount} atrasada(s)` : ""}`}
            />
          </div>

          <form onSubmit={handleSavePlan} className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900">Configurar plano</h3>
              <div className="flex gap-2">
                <button type="button" className={`btn btn-sm ${mode === "total" ? "btn-primary" : "btn-secondary"}`} onClick={() => setMode("total")}>
                  Total
                </button>
                <button type="button" className={`btn btn-sm ${mode === "parcelado" ? "btn-primary" : "btn-secondary"}`} onClick={() => setMode("parcelado")}>
                  Parcelado
                </button>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="label">Valor total ({currency})</label>
                <MoneyInput required className="input" value={totalAmount} onValueChange={setTotalAmount} />
              </div>
              {mode === "total" && (
                <div>
                  <label className="label">Data de vencimento</label>
                  <input required type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </div>
              )}
              <div className="flex items-end gap-2">
                {suggestion && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setTotalAmount(String(suggestion.amount))}
                  >
                    Usar contrato
                  </button>
                )}
                <button disabled={busy} className="btn btn-primary">{busy ? "A guardar…" : plan ? "Actualizar plano" : "Criar plano"}</button>
              </div>
            </div>
          </form>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900">Parcelas</h3>
              {!plan && <p className="text-xs text-slate-500">Crie o plano para começar a registar pagamentos.</p>}
            </div>

            {!plan?.installments.length ? (
              <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
                Ainda não há parcelas. Em modo parcelado, adicione a 1.ª prestação abaixo.
              </div>
            ) : (
              <ul className="space-y-2">
                {plan.installments.map((row) => {
                  const status = statusLabel(row, currency);
                  const outstanding = Math.max(0, round2(row.amount - row.paidAmount));
                  const isPaying = payingId === row.id;
                  return (
                    <li key={row.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-semibold text-slate-400">#{row.sequence}</span>
                            <strong className="text-sm text-slate-900">{row.title}</strong>
                            <span className={`badge ${status.cls}`}>{status.text}</span>
                          </div>
                          <p className="mt-1 text-xs text-slate-500">
                            Vence {row.dueDate} · {fmt(row.amount, currency)}
                            {outstanding > 0 && outstanding < row.amount ? ` · saldo ${fmt(outstanding, currency)}` : ""}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {row.status !== "paga" && (
                            <>
                              <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => openPay(row, true)}>
                                Pagar total
                              </button>
                              <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => openPay(row, false)}>
                                Pagamento parcial
                              </button>
                            </>
                          )}
                          {mode === "parcelado" && (
                            <button type="button" className="btn btn-ghost btn-sm text-red-700" disabled={busy} onClick={() => void handleDelete(row)} aria-label="Eliminar parcela">
                              <IconTrash className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      {isPaying && (
                        <form onSubmit={handleConfirmPay} className="border-t border-slate-100 bg-blue-50/60 px-4 py-3">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                            <div className="flex-1">
                              <label className="label">
                                {payFull ? `Confirmar pagamento total (${fmt(outstanding, currency)})` : `Valor a receber (saldo ${fmt(outstanding, currency)})`}
                              </label>
                              <MoneyInput
                                autoFocus
                                required
                                className="input"
                                value={payAmount}
                                onValueChange={(value) => {
                                  setPayFull(false);
                                  setPayAmount(value);
                                }}
                                disabled={payFull}
                              />
                            </div>
                            <div className="flex gap-2">
                              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setPayingId(null)}>
                                Cancelar
                              </button>
                              <button disabled={busy} className="btn btn-primary">
                                {busy ? "A registar…" : "Confirmar pagamento"}
                              </button>
                            </div>
                          </div>
                        </form>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {mode === "parcelado" && plan && (
            <form onSubmit={handleAddInstallment} className="rounded-xl border border-slate-200 p-4 space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">Nova parcela</h3>
              <div className="grid gap-3 sm:grid-cols-4">
                <div className="sm:col-span-2">
                  <label className="label">Título</label>
                  <input className="input" placeholder="Ex.: 1.ª prestação / Adiantamento" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} required />
                </div>
                <div>
                  <label className="label">Vencimento</label>
                  <input type="date" className="input" value={newDue} onChange={(e) => setNewDue(e.target.value)} required />
                </div>
                <div>
                  <label className="label">Valor</label>
                  <div className="flex gap-2">
                    <MoneyInput className="input" value={newAmount} onValueChange={setNewAmount} required />
                    <button disabled={busy} className="btn btn-secondary shrink-0" type="submit" aria-label="Adicionar parcela">
                      <IconPlus className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            </form>
          )}

          <div className="flex justify-end border-t border-slate-200 pt-4">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
              Fechar
            </button>
          </div>
        </div>
      </Modal>
      {dialog}
    </>
  );
}

function SummaryChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "positive" | "warn";
}) {
  const toneCls = tone === "positive" ? "text-green-700" : tone === "warn" ? "text-amber-800" : "text-slate-950";
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <span className="text-[11px] uppercase tracking-wide text-slate-500">{label}</span>
      <strong className={`mt-1 block text-sm tabular-nums ${toneCls}`}>{value}</strong>
    </div>
  );
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

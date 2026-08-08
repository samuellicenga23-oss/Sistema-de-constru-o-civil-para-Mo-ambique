import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { boqApi, type Project } from "../api/boq";
import { financialApi, type ClientStatement, type FinancialEntry, type FinancialSummary, type ProjectControl, type ProjectContract, type ProjectInvoice } from "../api/financial";
import { clientPaymentsApi, type ClientPaymentPlan } from "../api/clientPayments";
import Layout from "../components/Layout";
import { useConfirmDialog } from "../hooks/useConfirmDialog";
import { MetricCard, SectionHeader } from "../components/WorkspaceUI";
import ProjectWorkspaceNav from "../components/ProjectWorkspaceNav";
import Modal from "../components/Modal";
import PageSearch from "../components/PageSearch";
import { IconBack, IconPlus, IconTrash } from "../components/icons";

const CATEGORY_SUGGESTIONS_DESPESA = ["Mão-de-obra", "Materiais", "Equipamento", "Subcontratação", "Transporte", "Outros"];
const CATEGORY_SUGGESTIONS_RECEITA = ["Adiantamento do cliente", "Pagamento do cliente", "Retenção libertada", "Outros"];

function fmt(value: number, currency: string) {
  return `${value.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function ProjectFinancialPage() {
  const { confirm, dialog } = useConfirmDialog();
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();
  const [project, setProject] = useState<Project | null>(null);
  const [entries, setEntries] = useState<FinancialEntry[]>([]);
  const [summary, setSummary] = useState<FinancialSummary | null>(null);
  const [control, setControl] = useState<ProjectControl | null>(null);
  const [invoices, setInvoices] = useState<ProjectInvoice[]>([]);
  const [contract, setContract] = useState<ProjectContract | null>(null);
  const [statement, setStatement] = useState<ClientStatement | null>(null);
  const [clientPlan, setClientPlan] = useState<ClientPaymentPlan | null>(null);
  const [planSuggestion, setPlanSuggestion] = useState<{ amount: number; currency: string } | null>(null);
  const [planMode, setPlanMode] = useState<"total" | "parcelado">("parcelado");
  const [planTotal, setPlanTotal] = useState("");
  const [planDueDate, setPlanDueDate] = useState(todayStr());
  const [newInstTitle, setNewInstTitle] = useState("");
  const [newInstDue, setNewInstDue] = useState(todayStr());
  const [newInstAmount, setNewInstAmount] = useState("");
  const [showContractForm, setShowContractForm] = useState(false);
  const [contractNumber, setContractNumber] = useState("");
  const [contractClient, setContractClient] = useState("");
  const [contractAmount, setContractAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [query, setQuery] = useState("");

  const [type, setType] = useState<"receita" | "despesa">("despesa");
  const [category, setCategory] = useState("Materiais");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState(todayStr());
  const [markPaidNow, setMarkPaidNow] = useState(false);

  async function reload() {
    if (!projectId) return;
    const [proj, list, sum, controlData, invoiceData, paymentData] = await Promise.all([
      boqApi.getProject(projectId),
      financialApi.list(projectId),
      financialApi.summary(projectId),
      financialApi.control(projectId),
      financialApi.listInvoices(projectId),
      clientPaymentsApi.get(projectId).catch(() => ({ plan: null, suggestion: null })),
    ]);
    setProject(proj);
    setEntries(list);
    setSummary(sum);
    setControl(controlData);
    setInvoices(invoiceData);
    setClientPlan(paymentData.plan);
    setPlanSuggestion(paymentData.suggestion);
    setPlanMode(paymentData.plan?.mode ?? "parcelado");
    setPlanTotal(String(paymentData.plan?.totalAmount ?? paymentData.suggestion?.amount ?? ""));
    if (paymentData.plan?.mode === "total" && paymentData.plan.installments[0]) {
      setPlanDueDate(paymentData.plan.installments[0].dueDate);
    }
    const contractData = await financialApi.getContract(projectId).catch(() => null);
    setContract(contractData);
    setStatement(contractData ? await financialApi.clientStatement(projectId).catch(() => null) : null);
  }

  useEffect(() => {
    reload().catch((err) => setError(err.message));
  }, [projectId]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!projectId) return;
    const amountNum = Number(amount);
    if (!(amountNum > 0)) return;
    setError(null);
    setSaving(true);
    try {
      await financialApi.create(projectId, {
        type,
        category,
        description: description.trim() || undefined,
        amount: amountNum,
        currency: project?.currency ?? "MZN",
        dueDate,
        status: markPaidNow ? "pago" : "pendente",
        paidDate: markPaidNow ? todayStr() : undefined,
      });
      setDescription("");
      setAmount("");
      setMarkPaidNow(false);
      setShowForm(false);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao registar lançamento");
    } finally {
      setSaving(false);
    }
  }

  async function handleMarkPaid(entry: FinancialEntry) {
    setError(null);
    try {
      await financialApi.update(entry.id, { status: "pago", paidDate: todayStr() });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao actualizar lançamento");
    }
  }

  async function handleIssueInvoice(invoice: ProjectInvoice) {
    const invoiceNumber = window.prompt("Número da factura", invoice.invoiceNumber ?? "");
    if (!invoiceNumber?.trim()) return;
    const retention = window.prompt("Retenção (%)", (Number(invoice.retentionRate) * 100).toString());
    if (retention === null) return;
    const retentionRate = Number(retention) / 100;
    if (Number.isNaN(retentionRate) || retentionRate < 0 || retentionRate > 1) { setError("Indique uma retenção entre 0% e 100%."); return; }
    setError(null);
    try {
      await financialApi.issueInvoice(invoice.id, { invoiceNumber: invoiceNumber.trim(), issueDate: todayStr(), dueDate: todayStr(), retentionRate });
      await reload();
    } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível emitir a factura"); }
  }

  async function handleInvoiceReceipt(invoice: ProjectInvoice) {
    const value = window.prompt(`Recebimento (saldo ${fmt(invoice.outstandingAmount, invoice.currency)})`, invoice.outstandingAmount.toFixed(2));
    if (value === null) return;
    const amount = Number(value);
    if (!(amount > 0)) { setError("Indique um valor de recebimento válido."); return; }
    const reference = window.prompt("Referência do pagamento (opcional)") ?? undefined;
    setError(null);
    try {
      await financialApi.addReceipt(invoice.id, { amount, receivedDate: todayStr(), reference });
      await reload();
    } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível registar o recebimento"); }
  }

  async function handleCreditNote(invoice: ProjectInvoice) {
    const creditNumber = window.prompt("Número da nota de crédito");
    if (!creditNumber?.trim()) return;
    const value = window.prompt(`Valor da nota (máximo ${fmt(invoice.outstandingAmount, invoice.currency)})`);
    if (value === null) return;
    const creditAmount = Number(value);
    if (!(creditAmount > 0)) { setError("Indique um valor de crédito válido."); return; }
    const reason = window.prompt("Motivo da nota de crédito");
    if (!reason?.trim() || reason.trim().length < 5) { setError("Indique o motivo da nota de crédito."); return; }
    setError(null);
    try {
      await financialApi.createCreditNote(invoice.id, { creditNumber: creditNumber.trim(), issueDate: todayStr(), amount: creditAmount, reason: reason.trim() });
      await reload();
    } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível preparar a nota de crédito"); }
  }

  async function handleIssueCreditNote(noteId: string) {
    setError(null);
    try {
      await financialApi.issueCreditNote(noteId);
      await reload();
    } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível emitir a nota de crédito"); }
  }

  async function handleReceiptProof(receiptId: string, file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      await financialApi.uploadReceiptProof(receiptId, file);
      await reload();
    } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível anexar o comprovativo"); }
  }

  async function handleSaveClientPlan(e: FormEvent) {
    e.preventDefault();
    if (!projectId) return;
    const total = Number(planTotal);
    if (!(total >= 0)) return;
    setSaving(true);
    setError(null);
    try {
      const plan = await clientPaymentsApi.savePlan(projectId, {
        mode: planMode,
        currency: (project?.currency as "MZN" | "USD") ?? "MZN",
        totalAmount: total,
        singleDueDate: planMode === "total" ? planDueDate : undefined,
        singleTitle: planMode === "total" ? "Pagamento total" : undefined,
      });
      setClientPlan(plan);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível guardar o plano de pagamentos");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddInstallment(e: FormEvent) {
    e.preventDefault();
    if (!projectId) return;
    const amountNum = Number(newInstAmount);
    if (!newInstTitle.trim() || !(amountNum > 0)) return;
    setSaving(true);
    setError(null);
    try {
      await clientPaymentsApi.addInstallment(projectId, {
        title: newInstTitle.trim(),
        dueDate: newInstDue,
        amount: amountNum,
      });
      setNewInstTitle("");
      setNewInstAmount("");
      setNewInstDue(todayStr());
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível adicionar a parcela");
    } finally {
      setSaving(false);
    }
  }

  async function handleMarkInstallmentPaid(id: string, partial?: boolean) {
    if (!projectId) return;
    setError(null);
    try {
      if (partial) {
        const raw = window.prompt("Valor pago parcialmente:");
        if (raw == null) return;
        const paidAmount = Number(raw);
        if (!(paidAmount >= 0)) return;
        await clientPaymentsApi.markPaid(projectId, id, { paidAmount });
      } else {
        await clientPaymentsApi.markPaid(projectId, id);
      }
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível actualizar a parcela");
    }
  }

  async function handleDeleteInstallment(id: string) {
    if (!projectId) return;
    const ok = await confirm({
      title: "Eliminar parcela?",
      message: "A parcela será removida do plano de pagamentos do cliente.",
      confirmLabel: "Eliminar",
      danger: true,
    });
    if (!ok) return;
    setError(null);
    try {
      await clientPaymentsApi.deleteInstallment(projectId, id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível eliminar a parcela");
    }
  }

  async function handleSaveContract(e: FormEvent) {
    e.preventDefault();
    if (!projectId || !contractNumber.trim() || !contractClient.trim() || !(Number(contractAmount) > 0)) return;
    setSaving(true); setError(null);
    try {
      await financialApi.saveContract(projectId, { contractNumber: contractNumber.trim(), clientName: contractClient.trim(), originalAmount: Number(contractAmount) });
      setShowContractForm(false);
      await reload();
    } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível guardar o contrato"); }
    finally { setSaving(false); }
  }

  async function handleDelete(entry: FinancialEntry) {
    const ok = await confirm({
      title: "Eliminar lançamento?",
      message: `Eliminar ${entry.category} (${entry.amount} ${entry.currency})?`,
      confirmLabel: "Eliminar",
      danger: true,
    });
    if (!ok) return;
    setError(null);
    try {
      await financialApi.delete(entry.id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao eliminar lançamento");
    }
  }

  const filteredEntries = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("pt");
    if (!needle) return entries;
    return entries.filter((entry) => [
      entry.type,
      entry.category,
      entry.description,
      entry.status,
      entry.dueDate,
      entry.paidDate,
      entry.sourceType,
    ].filter(Boolean).join(" ").toLocaleLowerCase("pt").includes(needle));
  }, [entries, query]);

  if (!project || !summary) {
    return <div className="min-h-screen flex items-center justify-center text-gray-400">A carregar...</div>;
  }

  const currency = summary.currency;
  const suggestions = type === "despesa" ? CATEGORY_SUGGESTIONS_DESPESA : CATEGORY_SUGGESTIONS_RECEITA;

  return (
    <>
    <Layout
      title={`Financeiro — ${project.name}`}
      subtitle="Caixa da obra: compras, autos e pagamentos"
      actions={
        <Link to={`/projectos/${projectId}${searchParams.get("fase") === "gestao" ? "?fase=gestao" : ""}`} className="btn btn-ghost btn-sm">
          <IconBack className="w-3.5 h-3.5" />
          Projecto
        </Link>
      }
    >
      <div className="mx-auto w-full max-w-7xl space-y-5">
        <ProjectWorkspaceNav projectId={projectId!} />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-blue-100 bg-blue-50/70 px-4 py-2.5 text-xs text-blue-900"><strong>Compras e autos sincronizados.</strong><span>Registe aqui apenas movimentos fora desses fluxos.</span></div>

        {/* Indicadores */}
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <MetricCard label="Valor contratado" value={fmt(summary.valorContratado, currency)} />
          <MetricCard label="Valor recebido" value={fmt(summary.valorRecebido, currency)} tone="positive" />
          <MetricCard label="Custo realizado" value={fmt(summary.custoRealizado, currency)} tone="negative" />
          <MetricCard label="Margem realizada" value={fmt(summary.saldo, currency)} tone={summary.saldo >= 0 ? "positive" : "negative"} />
          <MetricCard label="Contas a receber" value={fmt(summary.contasAReceber, currency)} tone="info" />
          <MetricCard label="Contas a pagar" value={fmt(summary.contasAPagar, currency)} tone="warning" />
        </div>
        <details className="-mt-3 px-1 text-xs text-slate-500"><summary className="cursor-pointer font-semibold text-slate-600">Critério da margem</summary><p className="pt-1 leading-5">Valor recebido menos custo pago; pendências só entram após liquidação.</p></details>

        <section className="card overflow-hidden">
          <SectionHeader
            title="Pagamentos do cliente"
            description="Plano que o dono da obra vê no link público — separado do caixa interno."
          />
          <form onSubmit={handleSaveClientPlan} className="space-y-4 border-b border-slate-100 px-5 py-4">
            <div className="flex flex-wrap gap-2">
              <button type="button" className={`btn btn-sm ${planMode === "total" ? "btn-primary" : "btn-secondary"}`} onClick={() => setPlanMode("total")}>
                Total
              </button>
              <button type="button" className={`btn btn-sm ${planMode === "parcelado" ? "btn-primary" : "btn-secondary"}`} onClick={() => setPlanMode("parcelado")}>
                Parcelado
              </button>
              {planSuggestion && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setPlanTotal(String(planSuggestion.amount))}
                >
                  Usar valor do contrato ({fmt(planSuggestion.amount, planSuggestion.currency)})
                </button>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="label">Valor total ({currency})</label>
                <input required min="0" step="0.01" type="number" className="input" value={planTotal} onChange={(e) => setPlanTotal(e.target.value)} />
              </div>
              {planMode === "total" && (
                <div>
                  <label className="label">Data de vencimento</label>
                  <input required type="date" className="input" value={planDueDate} onChange={(e) => setPlanDueDate(e.target.value)} />
                </div>
              )}
              <div className="flex items-end">
                <button disabled={saving} className="btn btn-primary">{clientPlan ? "Actualizar plano" : "Criar plano"}</button>
              </div>
            </div>
          </form>

          {clientPlan && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="table-head-row">
                    <th className="px-5 py-2 text-left font-medium">#</th>
                    <th className="py-2 text-left font-medium">Parcela</th>
                    <th className="py-2 text-left font-medium">Vencimento</th>
                    <th className="py-2 text-right font-medium">Valor</th>
                    <th className="py-2 text-left font-medium">Estado</th>
                    <th className="py-2 pr-5 text-right font-medium">Acções</th>
                  </tr>
                </thead>
                <tbody>
                  {clientPlan.installments.map((row) => (
                    <tr key={row.id} className="table-row">
                      <td className="px-5 py-2 text-slate-400">{row.sequence}</td>
                      <td className="py-2">{row.title}</td>
                      <td className="py-2">{row.dueDate}</td>
                      <td className="py-2 text-right tabular-nums">{fmt(row.amount, clientPlan.currency)}</td>
                      <td className="py-2">
                        <span className={row.overdue || row.status === "atrasada" ? "font-semibold text-red-700" : row.status === "paga" ? "text-green-700" : "text-slate-600"}>
                          {row.status === "paga"
                            ? "Paga"
                            : row.status === "parcial"
                              ? `${row.overdue ? "Atrasada · " : ""}Parcial (${fmt(row.paidAmount, clientPlan.currency)})`
                              : row.status === "atrasada" || row.overdue
                                ? "Atrasada"
                                : "Prevista"}
                        </span>
                      </td>
                      <td className="py-2 pr-5 text-right">
                        <div className="flex flex-wrap justify-end gap-1">
                          {row.status !== "paga" && (
                            <>
                              <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleMarkInstallmentPaid(row.id)}>Marcar paga</button>
                              <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleMarkInstallmentPaid(row.id, true)}>Parcial</button>
                            </>
                          )}
                          {planMode === "parcelado" && (
                            <button type="button" className="btn btn-ghost btn-sm text-red-700" onClick={() => handleDeleteInstallment(row.id)} aria-label="Eliminar">
                              <IconTrash className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {planMode === "parcelado" && (
            <form onSubmit={handleAddInstallment} className="grid gap-3 border-t border-slate-100 px-5 py-4 sm:grid-cols-4">
              <div className="sm:col-span-2">
                <label className="label">Nova parcela</label>
                <input className="input" placeholder="Ex.: 1.ª prestação / Adiantamento" value={newInstTitle} onChange={(e) => setNewInstTitle(e.target.value)} required />
              </div>
              <div>
                <label className="label">Vencimento</label>
                <input type="date" className="input" value={newInstDue} onChange={(e) => setNewInstDue(e.target.value)} required />
              </div>
              <div>
                <label className="label">Valor</label>
                <div className="flex gap-2">
                  <input type="number" min="0.01" step="0.01" className="input" value={newInstAmount} onChange={(e) => setNewInstAmount(e.target.value)} required />
                  <button disabled={saving} className="btn btn-secondary shrink-0" type="submit">
                    <IconPlus className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </form>
          )}
        </section>

        {control && <section className="card overflow-hidden">
          <SectionHeader title="Controlo da obra" description={`Previsto vs. realizado · referência em ${control.basis.referenceDate}`} />
          <div className="grid gap-px bg-slate-100 sm:grid-cols-3">
            <div className="bg-white px-5 py-4"><span className="text-xs text-slate-500">Execução física</span><strong className="mt-1 block text-xl tabular-nums text-slate-950">{control.schedule.actualProgress.toFixed(2)}%</strong><p className={`mt-1 text-xs ${control.schedule.progressGap < -10 ? "text-amber-700" : "text-slate-500"}`}>Previsto {control.schedule.expectedProgress.toFixed(2)}% · {control.schedule.progressGap >= 0 ? "+" : ""}{control.schedule.progressGap.toFixed(2)} p.p.</p></div>
            <div className="bg-white px-5 py-4"><span className="text-xs text-slate-500">Autos certificados</span><strong className="mt-1 block text-xl tabular-nums text-slate-950">{fmt(control.commercial.certifiedValue, currency)}</strong><p className="mt-1 text-xs text-slate-500">Recebido {fmt(control.commercial.receivedValue, currency)}</p></div>
            <div className="bg-white px-5 py-4"><span className="text-xs text-slate-500">Consumo de stock</span><strong className="mt-1 block text-xl tabular-nums text-slate-950">{fmt(control.cost.consumedStockValue, currency)}</strong><p className="mt-1 text-xs text-slate-500">{control.basis.stockConsumptionEstimated ? "Inclui custo médio de entrada" : "Valorizado por custo de movimento"}</p></div>
          </div>
          {control.alerts.length > 0 && <div className="divide-y divide-slate-100 border-t border-slate-100">{control.alerts.map((alert) => <Link key={alert.code} to={alert.href} className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-slate-50"><div><strong className={`text-sm ${alert.level === "critical" ? "text-red-700" : alert.level === "warning" ? "text-amber-800" : "text-blue-700"}`}>{alert.title}</strong><p className="mt-0.5 text-xs text-slate-500">{alert.detail}</p></div><span className="text-xs font-semibold text-blue-700">Ver →</span></Link>)}</div>}
        </section>}

        <section className="card overflow-hidden">
          <SectionHeader title="Contrato e conta-corrente" description={contract ? `${contract.contractNumber} · ${contract.clientName}` : "Defina a referência comercial antes de emitir facturas."} actions={<button type="button" className="btn btn-secondary btn-sm" onClick={() => { setContractNumber(contract?.contractNumber ?? ""); setContractClient(contract?.clientName ?? project.client ?? ""); setContractAmount(contract?.originalAmount ?? ""); setShowContractForm(true); }}>{contract ? "Ver contrato" : "Criar contrato"}</button>} />
          {statement ? <div className="grid gap-px bg-slate-100 sm:grid-cols-2 lg:grid-cols-5"><div className="bg-white px-5 py-3 text-sm"><span className="text-xs text-slate-500">Valor revisto</span><strong className="mt-1 block">{fmt(statement.contract.revisedAmount, statement.currency)}</strong></div><div className="bg-white px-5 py-3 text-sm"><span className="text-xs text-slate-500">Facturado</span><strong className="mt-1 block">{fmt(statement.totals.invoiced, statement.currency)}</strong></div><div className="bg-white px-5 py-3 text-sm"><span className="text-xs text-slate-500">Notas de crédito</span><strong className="mt-1 block text-red-600">−{fmt(statement.totals.credited, statement.currency)}</strong></div><div className="bg-white px-5 py-3 text-sm"><span className="text-xs text-slate-500">Recebido</span><strong className="mt-1 block text-green-700">{fmt(statement.totals.received, statement.currency)}</strong></div><div className="bg-white px-5 py-3 text-sm"><span className="text-xs text-slate-500">Por receber</span><strong className="mt-1 block text-amber-700">{fmt(statement.totals.outstanding, statement.currency)}</strong></div></div> : <p className="px-5 py-4 text-sm text-slate-500">Sem contrato configurado.</p>}
        </section>
        {showContractForm && <Modal title="Contrato da obra" subtitle="O valor original fica protegido depois da activação; alterações seguem como adendas." onClose={() => !saving && setShowContractForm(false)} maxWidth="max-w-2xl"><form onSubmit={handleSaveContract} className="space-y-4"><div className="grid gap-3 sm:grid-cols-2"><div><label className="label">Número do contrato</label><input required className="input" value={contractNumber} onChange={(e) => setContractNumber(e.target.value)} /></div><div><label className="label">Cliente</label><input required className="input" value={contractClient} onChange={(e) => setContractClient(e.target.value)} /></div><div><label className="label">Valor original ({project.currency})</label><input required min="0" step="0.01" type="number" className="input" value={contractAmount} onChange={(e) => setContractAmount(e.target.value)} /></div></div><div className="flex justify-end gap-2"><button type="button" className="btn btn-secondary" onClick={() => setShowContractForm(false)}>Cancelar</button><button disabled={saving} className="btn btn-primary">Guardar contrato</button></div></form></Modal>}

        <section className="card overflow-hidden">
          <SectionHeader title="Facturas e recebimentos" description="Autos aprovados geram facturas em rascunho; emita e registe recebimentos totais ou parciais." />
          {!invoices.length ? <p className="px-5 py-5 text-sm text-slate-500">Ainda não existem facturas. Aprove um Auto de Medição para preparar a primeira.</p> : <div className="divide-y divide-slate-100">{invoices.map((invoice) => (
            <article key={invoice.id} className="px-5 py-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div><div className="flex flex-wrap items-center gap-2"><strong className="text-sm text-slate-900">{invoice.invoiceNumber ?? "Factura por emitir"}</strong><span className={`badge ${invoice.status === "paga" ? "badge-green" : invoice.status === "rascunho" ? "badge-yellow" : "badge-blue"}`}>{invoice.status === "rascunho" ? "Rascunho" : invoice.status === "emitida" ? "Emitida" : invoice.status === "parcial" ? "Parcial" : invoice.status === "paga" ? "Paga" : "Cancelada"}</span></div><p className="mt-1 text-xs text-slate-500">{invoice.clientName ?? "Cliente por definir"} · IVA {(Number(invoice.ivaRate) * 100).toFixed(2)}% · Retenção {(Number(invoice.retentionRate) * 100).toFixed(2)}%</p></div>
                <div className="flex flex-wrap items-center gap-2"><div className="mr-2 text-right text-xs"><strong className="block text-sm tabular-nums text-slate-900">{fmt(Number(invoice.netAmount), invoice.currency)}</strong>{invoice.creditAmount > 0 && <span className="block text-red-600">Crédito −{fmt(invoice.creditAmount, invoice.currency)}</span>}<span className="text-slate-500">Saldo {fmt(invoice.outstandingAmount, invoice.currency)}</span></div>{invoice.status === "rascunho" && <button type="button" className="btn btn-primary btn-sm" onClick={() => handleIssueInvoice(invoice)}>Emitir</button>}{(invoice.status === "emitida" || invoice.status === "parcial") && <button type="button" className="btn btn-secondary btn-sm text-green-700" onClick={() => handleInvoiceReceipt(invoice)}>Recebimento</button>}{invoice.status !== "rascunho" && invoice.status !== "cancelada" && <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleCreditNote(invoice)}>Nota de crédito</button>}{invoice.status !== "rascunho" && invoice.status !== "cancelada" && <a className="btn btn-ghost btn-sm" href={financialApi.invoicePdfUrl(invoice.id)} target="_blank" rel="noreferrer">PDF</a>}</div>
              </div>
              {(invoice.receipts.length > 0 || invoice.creditNotes.length > 0) && <details className="mt-3 border-t border-slate-100 pt-3"><summary className="cursor-pointer text-xs font-semibold text-blue-700">Documentos e movimentos ({invoice.receipts.length + invoice.creditNotes.length})</summary><div className="mt-3 grid gap-3 lg:grid-cols-2">
                {invoice.receipts.length > 0 && <div className="rounded-lg border border-slate-200"><strong className="block border-b border-slate-100 px-3 py-2 text-xs">Recebimentos</strong>{invoice.receipts.map((receipt) => <div key={receipt.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"><span>{receipt.receivedDate} · {fmt(Number(receipt.amount), invoice.currency)}</span>{receipt.proofUrl ? <a className="font-semibold text-blue-700" href={receipt.proofUrl} target="_blank" rel="noreferrer">Ver comprovativo</a> : <label className="btn btn-secondary btn-sm cursor-pointer">Anexar comprovativo<input className="sr-only" type="file" accept="application/pdf,image/png,image/jpeg,image/webp,image/gif" onChange={(event) => handleReceiptProof(receipt.id, event.target.files?.[0])} /></label>}</div>)}</div>}
                {invoice.creditNotes.length > 0 && <div className="rounded-lg border border-slate-200"><strong className="block border-b border-slate-100 px-3 py-2 text-xs">Notas de crédito</strong>{invoice.creditNotes.map((note) => <div key={note.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"><span>{note.creditNumber} · {fmt(Number(note.amount), invoice.currency)} · {note.status}</span>{note.status === "rascunho" && <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleIssueCreditNote(note.id)}>Emitir</button>}</div>)}</div>}
              </div></details>}
            </article>
          ))}</div>}
        </section>

        {/* Fluxo de caixa mensal */}
        {summary.fluxoCaixaMensal.length > 0 && (
          <section className="card">
            <SectionHeader title="Fluxo de caixa mensal" description="Receitas e despesas efectivamente pagas por mês" />
            <div className="divide-y divide-slate-100 sm:hidden">{summary.fluxoCaixaMensal.map((m) => <div key={`mobile-${m.month}`} className="p-4"><div className="flex items-center justify-between"><strong className="text-sm text-slate-900">{m.month}</strong><strong className={`text-sm tabular-nums ${m.saldo >= 0 ? "text-green-700" : "text-red-600"}`}>{fmt(m.saldo, currency)}</strong></div><div className="mt-2 flex justify-between text-xs"><span className="text-green-700">Receitas {fmt(m.receitas, currency)}</span><span className="text-red-600">Despesas {fmt(m.despesas, currency)}</span></div></div>)}</div>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-sm min-w-[480px]">
                <thead>
                  <tr className="table-head-row">
                    <th className="text-left py-2 px-5 font-medium">Mês</th>
                    <th className="text-right font-medium">Receitas</th>
                    <th className="text-right font-medium">Despesas</th>
                    <th className="text-right font-medium pr-5">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.fluxoCaixaMensal.map((m) => (
                    <tr key={m.month} className="table-row">
                      <td className="py-2 px-5">{m.month}</td>
                      <td className="text-right tabular-nums text-green-700">{fmt(m.receitas, currency)}</td>
                      <td className="text-right tabular-nums text-red-600">{fmt(m.despesas, currency)}</td>
                      <td className={`text-right pr-5 tabular-nums font-medium ${m.saldo >= 0 ? "text-green-700" : "text-red-600"}`}>
                        {fmt(m.saldo, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Novo lançamento */}
        <section className="card overflow-hidden"><SectionHeader title="Movimentos manuais" description="Valores que não vêm de compras nem autos" actions={<button type="button" onClick={() => setShowForm(true)} className="btn btn-primary btn-sm"><IconPlus className="h-3.5 w-3.5" /> Novo lançamento</button>} /></section>
        {showForm && <Modal title="Novo lançamento financeiro" subtitle={`Receita ou despesa · ${project.name}`} onClose={() => !saving && setShowForm(false)} maxWidth="max-w-3xl"><form onSubmit={handleCreate} className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Tipo</label>
              <select value={type} onChange={(e) => setType(e.target.value as "receita" | "despesa")} className="input">
                <option value="despesa">Despesa</option>
                <option value="receita">Receita</option>
              </select>
            </div>
            <div>
              <label className="label">Categoria</label>
              <input value={category} onChange={(e) => setCategory(e.target.value)} list="category-suggestions" className="input" />
              <datalist id="category-suggestions">
                {suggestions.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div className="sm:col-span-2">
              <label className="label">Descrição (opcional)</label>
              <input value={description} onChange={(e) => setDescription(e.target.value)} className="input" />
            </div>
            <div>
              <label className="label">Valor ({project.currency})</label>
              <input type="number" step="0.01" min="0" required value={amount} onChange={(e) => setAmount(e.target.value)} className="input" />
            </div>
            <div>
              <label className="label">Data de vencimento</label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="input" />
            </div>
            <label className="flex items-center gap-2 rounded-lg bg-slate-50 p-3 text-sm text-gray-700 sm:col-span-2">
              <input type="checkbox" checked={markPaidNow} onChange={(e) => setMarkPaidNow(e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-brand-700" />
              Já foi {type === "receita" ? "recebido" : "pago"} (marca como pago hoje)
            </label>
            <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:col-span-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setShowForm(false)} className="btn btn-secondary">Cancelar</button><button type="submit" disabled={saving} className="btn btn-primary">
              <IconPlus className="w-4 h-4" />
              {saving ? "A guardar..." : "Registar"}
            </button></div>
          </form></Modal>}

        {/* Lista de lançamentos */}
        <section className="card">
          <SectionHeader title="Lançamentos" description={`${entries.length} movimento(s) registado(s)`} />
          <div className="border-b border-slate-100 px-4 py-3 sm:px-5"><PageSearch value={query} onChange={setQuery} placeholder="Pesquisar categoria, descrição, estado ou data…" resultLabel={`${filteredEntries.length} movimento(s)`} /></div>
          <div className="divide-y divide-slate-100 md:hidden">{filteredEntries.map((entry) => <article key={`mobile-${entry.id}`} className="p-4"><div className="flex items-start justify-between gap-3"><div><span className={`badge ${entry.type === "receita" ? "badge-green" : "badge-red"}`}>{entry.type === "receita" ? "Receita" : "Despesa"}</span><strong className="mt-2 block text-sm text-slate-900">{entry.category}</strong><p className="mt-1 text-xs text-slate-500">{entry.description ?? (entry.sourceType === "purchase_order" ? "Ordem de compra" : entry.sourceType === "measurement_certificate" ? "Auto de medição" : "Sem descrição")}</p></div><div className="text-right"><strong className="block text-sm tabular-nums">{fmt(Number(entry.amount), entry.currency)}</strong><span className={`badge mt-2 ${entry.status === "pago" ? "badge-green" : "badge-yellow"}`}>{entry.status === "pago" ? "Pago" : "Pendente"}</span></div></div><div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3"><span className="text-xs text-slate-500">Vence {entry.dueDate || "—"}</span><div className="flex gap-2">{entry.status === "pendente" && <button onClick={() => handleMarkPaid(entry)} className="btn btn-secondary btn-sm text-green-700">Marcar pago</button>}{!entry.sourceType && <button onClick={() => handleDelete(entry)} className="icon-btn-danger" title="Eliminar lançamento"><IconTrash className="h-3.5 w-3.5" /></button>}</div></div></article>)}</div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="table-head-row">
                  <th className="text-left py-2 px-5 font-medium">Tipo</th>
                  <th className="text-left font-medium">Categoria</th>
                  <th className="text-left font-medium">Descrição</th>
                  <th className="text-right font-medium">Valor</th>
                  <th className="text-left font-medium">Vencimento</th>
                  <th className="text-left font-medium">Estado</th>
                  <th className="text-left font-medium pr-5">Acções</th>
                </tr>
              </thead>
              <tbody>
                {filteredEntries.map((e) => (
                  <tr key={e.id} className="table-row group">
                    <td className="py-2 px-5">
                      <span className={`badge ${e.type === "receita" ? "badge-green" : "badge-red"}`}>{e.type === "receita" ? "Receita" : "Despesa"}</span>
                    </td>
                    <td><span className="font-medium">{e.category}</span>{e.sourceType && <span className="mt-1 block w-fit rounded bg-blue-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700">{e.sourceType === "purchase_order" ? "Ordem de compra" : "Auto de medição"}</span>}</td>
                    <td className="text-gray-500">{e.description ?? "—"}</td>
                    <td className="text-right tabular-nums font-medium">{fmt(Number(e.amount), e.currency)}</td>
                    <td className="text-gray-500">{e.dueDate ?? "—"}</td>
                    <td>
                      <span className={`badge ${e.status === "pago" ? "badge-green" : "badge-yellow"}`}>{e.status === "pago" ? "Pago" : "Pendente"}</span>
                    </td>
                    <td className="pr-5 space-x-3">
                      {e.status === "pendente" && (
                        <button onClick={() => handleMarkPaid(e)} className="btn btn-secondary btn-sm text-green-700">
                          Marcar pago
                        </button>
                      )}
                      {!e.sourceType && <button onClick={() => handleDelete(e)} className="icon-btn-danger inline-flex" title="Eliminar lançamento">
                        <IconTrash className="w-3.5 h-3.5" />
                      </button>}
                    </td>
                  </tr>
                ))}
                {entries.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-gray-400">
                      Sem lançamentos ainda — registe o primeiro acima.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {filteredEntries.length === 0 && <div className="px-5 py-10 text-center text-sm text-slate-500">{query ? "Nenhum lançamento corresponde à pesquisa." : "Ainda não existem lançamentos."}</div>}
        </section>
      </div>
    </Layout>
    {dialog}
    </>
  );
}

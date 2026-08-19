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
import MoneyInput from "../components/MoneyInput";
import ClientPaymentPlanModal from "../components/ClientPaymentPlanModal";
import PageSearch from "../components/PageSearch";
import { IconBack, IconPlus, IconTrash } from "../components/icons";
import { formatMoneyAmount } from "../lib/moneyFormat";

const CATEGORY_SUGGESTIONS_DESPESA = ["Mão-de-obra", "Materiais", "Equipamento", "Subcontratação", "Transporte", "Outros"];
const CATEGORY_SUGGESTIONS_RECEITA = ["Adiantamento do cliente", "Pagamento do cliente", "Retenção libertada", "Outros"];

function fmt(value: number, currency: string) {
  return `${formatMoneyAmount(value)} ${currency}`;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type FinancialAction =
  | { kind: "issue"; invoice: ProjectInvoice }
  | { kind: "receipt"; invoice: ProjectInvoice }
  | { kind: "credit"; invoice: ProjectInvoice };

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
  const [showClientPayments, setShowClientPayments] = useState(false);
  const [showContractForm, setShowContractForm] = useState(false);
  const [contractNumber, setContractNumber] = useState("");
  const [contractClient, setContractClient] = useState("");
  const [contractAmount, setContractAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [query, setQuery] = useState("");
  const [financialAction, setFinancialAction] = useState<FinancialAction | null>(null);
  const [actionNumber, setActionNumber] = useState("");
  const [actionAmount, setActionAmount] = useState("");
  const [actionReference, setActionReference] = useState("");
  const [actionReason, setActionReason] = useState("");
  const [actionRetention, setActionRetention] = useState("0");
  const [actionDate, setActionDate] = useState(todayStr());

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

  function openIssueInvoice(invoice: ProjectInvoice) {
    setFinancialAction({ kind: "issue", invoice });
    setActionNumber(invoice.invoiceNumber ?? "");
    setActionRetention((Number(invoice.retentionRate) * 100).toFixed(2));
    setActionDate(todayStr());
  }

  function openInvoiceReceipt(invoice: ProjectInvoice) {
    setFinancialAction({ kind: "receipt", invoice });
    setActionAmount(invoice.outstandingAmount.toFixed(2));
    setActionReference("");
    setActionDate(todayStr());
  }

  function openCreditNote(invoice: ProjectInvoice) {
    setFinancialAction({ kind: "credit", invoice });
    setActionNumber("");
    setActionAmount(invoice.outstandingAmount.toFixed(2));
    setActionReason("");
    setActionDate(todayStr());
  }

  async function handleFinancialAction(e: FormEvent) {
    e.preventDefault();
    if (!financialAction) return;
    setError(null);
    setSaving(true);
    try {
      if (financialAction.kind === "issue") {
        const retentionRate = Number(actionRetention) / 100;
        if (!actionNumber.trim() || !Number.isFinite(retentionRate) || retentionRate < 0 || retentionRate > 1) {
          throw new Error("Indique o número da factura e uma retenção entre 0% e 100%.");
        }
        await financialApi.issueInvoice(financialAction.invoice.id, {
          invoiceNumber: actionNumber.trim(), issueDate: todayStr(), dueDate: actionDate, retentionRate,
        });
      } else if (financialAction.kind === "receipt") {
        const value = Number(actionAmount);
        if (!(value > 0) || value > financialAction.invoice.outstandingAmount) throw new Error("O recebimento deve ser positivo e não pode exceder o saldo.");
        await financialApi.addReceipt(financialAction.invoice.id, { amount: value, receivedDate: actionDate, reference: actionReference.trim() || undefined });
      } else if (financialAction.kind === "credit") {
        const value = Number(actionAmount);
        if (!actionNumber.trim() || !(value > 0) || value > financialAction.invoice.outstandingAmount || actionReason.trim().length < 5) {
          throw new Error("Preencha o número, um valor dentro do saldo e o motivo da nota de crédito.");
        }
        await financialApi.createCreditNote(financialAction.invoice.id, { creditNumber: actionNumber.trim(), issueDate: actionDate, amount: value, reason: actionReason.trim() });
      }
      setFinancialAction(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível concluir a operação");
    } finally {
      setSaving(false);
    }
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
        <div className="flex"><span className="badge badge-green">Sincronizado</span></div>

        {/* Indicadores */}
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-7">
          <MetricCard label="Valor contratado" value={fmt(summary.valorContratado, currency)} />
          <MetricCard label="Valor recebido" value={fmt(summary.valorRecebido, currency)} tone="positive" />
          <MetricCard label="Custo realizado" value={fmt(summary.custoRealizado, currency)} tone="negative" />
          <MetricCard label="Margem realizada" value={fmt(summary.saldo, currency)} tone={summary.saldo >= 0 ? "positive" : "negative"} />
          <MetricCard label="Contas a receber" value={fmt(summary.contasAReceber, currency)} tone="info" />
          <MetricCard label="Contas a pagar" value={fmt(summary.contasAPagar, currency)} tone="warning" />
          <MetricCard label="Compromissos de compra" value={fmt(summary.compromissosCompra, currency)} tone="info" />
        </div>
        <details className="-mt-3 px-1 text-xs text-slate-500"><summary className="cursor-pointer font-semibold text-slate-600">Critério da margem</summary><p className="pt-1 leading-5">Valor recebido menos custo pago; pendências só entram após liquidação.</p></details>

        <section className="card overflow-hidden">
          <SectionHeader
            title="Pagamentos do cliente"
            actions={
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowClientPayments(true)}>
                Gerir pagamentos
              </button>
            }
          />
          <div className="grid gap-px bg-slate-100 sm:grid-cols-3">
            <div className="bg-white px-5 py-4">
              <span className="text-xs text-slate-500">Total do plano</span>
              <strong className="mt-1 block text-xl tabular-nums text-slate-950">
                {fmt(clientPlan?.totalAmount ?? planSuggestion?.amount ?? 0, currency)}
              </strong>
              <p className="mt-1 text-xs text-slate-500">
                {clientPlan ? (clientPlan.mode === "total" ? "Pagamento único" : `${clientPlan.installments.length} parcela(s)`) : "Ainda sem plano definido"}
              </p>
            </div>
            <div className="bg-white px-5 py-4">
              <span className="text-xs text-slate-500">Já pago</span>
              <strong className="mt-1 block text-xl tabular-nums text-green-700">
                {fmt(clientPlan?.installments.reduce((sum, row) => sum + row.paidAmount, 0) ?? 0, currency)}
              </strong>
              <p className="mt-1 text-xs text-slate-500">
                {(clientPlan?.installments.filter((row) => row.status === "paga").length ?? 0)} parcela(s) liquidada(s)
              </p>
            </div>
            <div className="bg-white px-5 py-4">
              <span className="text-xs text-slate-500">Em aberto</span>
              <strong className="mt-1 block text-xl tabular-nums text-amber-800">
                {fmt(
                  Math.max(
                    0,
                    (clientPlan?.totalAmount ?? 0)
                      - (clientPlan?.installments.reduce((sum, row) => sum + row.paidAmount, 0) ?? 0),
                  ),
                  currency,
                )}
              </strong>
              <p className="mt-1 text-xs text-slate-500">
                {(clientPlan?.installments.filter((row) => row.status !== "paga" && (row.overdue || row.status === "atrasada")).length ?? 0)} atrasada(s)
              </p>
            </div>
          </div>
          {clientPlan && clientPlan.installments.length > 0 && (
            <div className="divide-y divide-slate-100 border-t border-slate-100">
              {clientPlan.installments.slice(0, 3).map((row) => (
                <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                  <div>
                    <strong className="text-slate-900">{row.title}</strong>
                    <span className="ml-2 text-xs text-slate-500">vence {row.dueDate}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="tabular-nums text-slate-700">{fmt(row.amount, clientPlan.currency)}</span>
                    <span className={`badge ${row.status === "paga" ? "badge-green" : row.overdue || row.status === "atrasada" ? "badge-red" : row.status === "parcial" ? "badge-yellow" : "badge-gray"}`}>
                      {row.status === "paga" ? "Paga" : row.status === "parcial" ? "Parcial" : row.overdue || row.status === "atrasada" ? "Atrasada" : "Prevista"}
                    </span>
                  </div>
                </div>
              ))}
              {clientPlan.installments.length > 3 && (
                <button type="button" className="w-full px-5 py-3 text-left text-xs font-semibold text-brand-700 hover:bg-slate-50" onClick={() => setShowClientPayments(true)}>
                  Ver todas as {clientPlan.installments.length} parcelas →
                </button>
              )}
            </div>
          )}
          {!clientPlan && (
            <div className="border-t border-slate-100 px-5 py-5 text-sm text-slate-500">
              Defina o plano e registe pagamentos totais ou parciais no popup de gestão.
            </div>
          )}
        </section>

        {control && <section className="card overflow-hidden">
          <SectionHeader title="Controlo da obra" />
          <div className="grid gap-px bg-slate-100 sm:grid-cols-2">
            <div className="bg-white px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Actual</div>
            <div className="bg-white px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Forecast</div>
          </div>
          <div className="grid gap-px bg-slate-100 sm:grid-cols-4">
            <div className="bg-white px-5 py-4"><span className="text-xs text-slate-500">Execução</span><strong className="mt-1 block text-xl tabular-nums">{control.schedule.actualProgress.toFixed(1)}%</strong></div>
            <div className="bg-white px-5 py-4"><span className="text-xs text-slate-500">Custo pago</span><strong className="mt-1 block text-xl tabular-nums">{fmt(control.cost.paidValue, currency)}</strong></div>
            <div className="bg-white px-5 py-4"><span className="text-xs text-slate-500">EAC</span><strong className="mt-1 block text-xl tabular-nums">{control.forecast?.available && control.forecast.eac != null ? fmt(control.forecast.eac, currency) : "Indisponível"}</strong></div>
            <div className="bg-white px-5 py-4"><span className="text-xs text-slate-500">Margem prevista</span><strong className="mt-1 block text-xl tabular-nums">{control.forecast?.available && control.forecast.forecastMargin != null ? fmt(control.forecast.forecastMargin, currency) : "Indisponível"}</strong></div>
          </div>
          {control.alerts.length > 0 && <div className="divide-y divide-slate-100 border-t border-slate-100">{control.alerts.map((alert) => <Link key={alert.code} to={alert.href} className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-slate-50"><div><strong className={`text-sm ${alert.level === "critical" ? "text-red-700" : alert.level === "warning" ? "text-amber-800" : "text-blue-700"}`}>{alert.title}</strong><p className="mt-0.5 text-xs text-slate-500">{alert.detail}</p></div><span className="text-xs font-semibold text-blue-700">Abrir</span></Link>)}</div>}
        </section>}

        <section className="card overflow-hidden">
          <SectionHeader title="Contrato e conta-corrente" description={contract ? `${contract.contractNumber} · ${contract.clientName}` : undefined} actions={<button type="button" className="btn btn-secondary btn-sm" onClick={() => { setContractNumber(contract?.contractNumber ?? ""); setContractClient(contract?.clientName ?? project.client ?? ""); setContractAmount(contract?.originalAmount ?? ""); setShowContractForm(true); }}>{contract ? "Ver contrato" : "Criar contrato"}</button>} />
          {statement ? <div className="grid gap-px bg-slate-100 sm:grid-cols-2 lg:grid-cols-5"><div className="bg-white px-5 py-3 text-sm"><span className="text-xs text-slate-500">Valor revisto</span><strong className="mt-1 block">{fmt(statement.contract.revisedAmount, statement.currency)}</strong></div><div className="bg-white px-5 py-3 text-sm"><span className="text-xs text-slate-500">Facturado</span><strong className="mt-1 block">{fmt(statement.totals.invoiced, statement.currency)}</strong></div><div className="bg-white px-5 py-3 text-sm"><span className="text-xs text-slate-500">Notas de crédito</span><strong className="mt-1 block text-red-600">−{fmt(statement.totals.credited, statement.currency)}</strong></div><div className="bg-white px-5 py-3 text-sm"><span className="text-xs text-slate-500">Recebido</span><strong className="mt-1 block text-green-700">{fmt(statement.totals.received, statement.currency)}</strong></div><div className="bg-white px-5 py-3 text-sm"><span className="text-xs text-slate-500">Por receber</span><strong className="mt-1 block text-amber-700">{fmt(statement.totals.outstanding, statement.currency)}</strong></div></div> : <p className="px-5 py-4 text-sm text-slate-500">Sem contrato configurado.</p>}
        </section>
        {showContractForm && <Modal title="Contrato da obra" subtitle="O valor original fica protegido após activação; alterações seguem como adendas." onClose={() => !saving && setShowContractForm(false)} maxWidth="max-w-2xl"><form onSubmit={handleSaveContract} className="space-y-4"><div className="grid gap-3 sm:grid-cols-2"><div><label className="label">Número do contrato</label><input required className="input" value={contractNumber} onChange={(e) => setContractNumber(e.target.value)} /></div><div><label className="label">Cliente</label><input required className="input" value={contractClient} onChange={(e) => setContractClient(e.target.value)} /></div><div><label className="label">Valor original ({project.currency})</label><MoneyInput required className="input" value={contractAmount} onValueChange={setContractAmount} /></div></div><div className="flex justify-end gap-2"><button type="button" className="btn btn-secondary" onClick={() => setShowContractForm(false)}>Cancelar</button><button disabled={saving} className="btn btn-primary">Guardar contrato</button></div></form></Modal>}

        <section className="card overflow-hidden">
          <SectionHeader title="Facturas e recebimentos" />
          {!invoices.length ? <p className="px-5 py-5 text-sm text-slate-500">Ainda não existem facturas. Aprove um Auto de Medição para preparar a primeira.</p> : <div className="divide-y divide-slate-100">{invoices.map((invoice) => (
            <article key={invoice.id} className="px-5 py-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div><div className="flex flex-wrap items-center gap-2"><strong className="text-sm text-slate-900">{invoice.invoiceNumber ?? "Factura por emitir"}</strong><span className={`badge ${invoice.status === "paga" ? "badge-green" : invoice.status === "rascunho" ? "badge-yellow" : "badge-blue"}`}>{invoice.status === "rascunho" ? "Rascunho" : invoice.status === "emitida" ? "Emitida" : invoice.status === "parcial" ? "Parcial" : invoice.status === "paga" ? "Paga" : "Cancelada"}</span></div><p className="mt-1 text-xs text-slate-500">{invoice.clientName ?? "Cliente por definir"} · IVA {(Number(invoice.ivaRate) * 100).toFixed(2)}% · Retenção {(Number(invoice.retentionRate) * 100).toFixed(2)}%</p></div>
                <div className="flex flex-wrap items-center gap-2"><div className="mr-2 text-right text-xs"><strong className="block text-sm tabular-nums text-slate-900">{fmt(Number(invoice.netAmount), invoice.currency)}</strong>{invoice.creditAmount > 0 && <span className="block text-red-600">Crédito −{fmt(invoice.creditAmount, invoice.currency)}</span>}<span className="text-slate-500">Saldo {fmt(invoice.outstandingAmount, invoice.currency)}</span></div>{invoice.status === "rascunho" && <button type="button" className="btn btn-primary btn-sm" onClick={() => openIssueInvoice(invoice)}>Emitir</button>}{(invoice.status === "emitida" || invoice.status === "parcial") && <button type="button" className="btn btn-secondary btn-sm text-green-700" onClick={() => openInvoiceReceipt(invoice)}>Recebimento</button>}{invoice.status !== "rascunho" && invoice.status !== "cancelada" && <button type="button" className="btn btn-secondary btn-sm" onClick={() => openCreditNote(invoice)}>Nota de crédito</button>}{invoice.status !== "rascunho" && invoice.status !== "cancelada" && <a className="btn btn-ghost btn-sm" href={financialApi.invoicePdfUrl(invoice.id)} target="_blank" rel="noreferrer">PDF</a>}</div>
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
            <SectionHeader title="Fluxo de caixa mensal" />
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
        <section className="card overflow-hidden"><SectionHeader title="Movimentos manuais" actions={<button type="button" onClick={() => setShowForm(true)} className="btn btn-primary btn-sm"><IconPlus className="h-3.5 w-3.5" /> Novo lançamento</button>} /></section>
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
              <MoneyInput required className="input" value={amount} onValueChange={setAmount} />
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
    {financialAction && <Modal
      title={financialAction.kind === "issue" ? "Emitir factura" : financialAction.kind === "receipt" ? "Registar recebimento" : "Nota de crédito"}
      subtitle={`Saldo da factura: ${fmt(financialAction.invoice.outstandingAmount, financialAction.invoice.currency)}`}
      onClose={() => !saving && setFinancialAction(null)}
      maxWidth="max-w-xl"
    >
      <form onSubmit={handleFinancialAction} className="space-y-4">
        {(financialAction.kind === "issue" || financialAction.kind === "credit") && <div>
          <label className="label">{financialAction.kind === "issue" ? "Número da factura" : "Número da nota de crédito"}</label>
          <input autoFocus required className="input" value={actionNumber} onChange={(event) => setActionNumber(event.target.value)} />
        </div>}
        {(financialAction.kind === "receipt" || financialAction.kind === "credit") && <div>
          <label className="label">Valor ({financialAction.invoice.currency})</label>
          <MoneyInput
            autoFocus={financialAction.kind !== "credit"}
            required
            className="input"
            value={actionAmount}
            onValueChange={setActionAmount}
          />
        </div>}
        {financialAction.kind === "issue" && <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="label">Retenção (%)</label><input required type="number" min="0" max="100" step="0.01" className="input" value={actionRetention} onChange={(event) => setActionRetention(event.target.value)} /></div>
          <div><label className="label">Vencimento</label><input required type="date" className="input" value={actionDate} onChange={(event) => setActionDate(event.target.value)} /></div>
        </div>}
        {(financialAction.kind === "receipt" || financialAction.kind === "credit") && <div>
          <label className="label">{financialAction.kind === "receipt" ? "Data do recebimento" : "Data da nota"}</label>
          <input required type="date" className="input" value={actionDate} onChange={(event) => setActionDate(event.target.value)} />
        </div>}
        {financialAction.kind === "receipt" && <div><label className="label">Referência (opcional)</label><input className="input" value={actionReference} onChange={(event) => setActionReference(event.target.value)} /></div>}
        {financialAction.kind === "credit" && <div><label className="label">Motivo</label><textarea required minLength={5} rows={3} className="input resize-y" value={actionReason} onChange={(event) => setActionReason(event.target.value)} /></div>}
        <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end">
          <button type="button" className="btn btn-secondary" onClick={() => setFinancialAction(null)}>Cancelar</button>
          <button disabled={saving} className="btn btn-primary">{saving ? "A guardar..." : "Confirmar"}</button>
        </div>
      </form>
    </Modal>}
    {showClientPayments && projectId && (
      <ClientPaymentPlanModal
        projectId={projectId}
        currency={(project.currency as "MZN" | "USD") ?? "MZN"}
        plan={clientPlan}
        suggestion={planSuggestion}
        onClose={() => setShowClientPayments(false)}
        onChanged={reload}
      />
    )}
    {dialog}
    </>
  );
}

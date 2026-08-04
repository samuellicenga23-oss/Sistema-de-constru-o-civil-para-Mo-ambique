import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import ContractFinancePanel from "../components/ContractFinancePanel";
import ContractOpsPanel from "../components/ContractOpsPanel";
import Layout from "../components/Layout";
import Modal from "../components/Modal";
import PageSearch from "../components/PageSearch";
import ProposalWizard from "../components/ProposalWizard";
import { IconBuilding, IconPlus } from "../components/icons";
import { getServiceType } from "../comercial/proposalTemplates";
import { useAuth } from "../auth/AuthContext";
import { can } from "../permissions";
import { boqApi, type Project } from "../api/boq";
import {
  practiceApi,
  type PracticeClient,
  type PracticeEngagement,
  type PracticeInvoice,
  type PracticePayable,
  type PracticeQuote,
  type PracticeReceipt,
  type PracticeSummary,
} from "../api/practice";

type ClientDossier = PracticeClient & {
  quotes: PracticeQuote[];
  invoices: PracticeInvoice[];
  engagements: PracticeEngagement[];
  receipts: PracticeReceipt[];
};

function money(value: number | string, currency = "MZN") {
  return `${Number(value).toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

const STATUS_PIPELINE: PracticeQuote["status"][] = ["rascunho", "enviada", "aprovada"];

const QUOTE_STATUS: Record<PracticeQuote["status"], string> = {
  rascunho: "Rascunho",
  enviada: "Enviada",
  aprovada: "Aprovada",
  rejeitada: "Rejeitada",
  cancelada: "Cancelada",
};

const INVOICE_STATUS: Record<string, string> = {
  rascunho: "Rascunho",
  emitida: "Emitida",
  parcial: "Parcial",
  paga: "Paga",
  cancelada: "Cancelada",
  vencida: "Vencida",
};

const MILESTONE_STATUS: Record<string, string> = {
  pendente: "Pendente",
  facturado: "Facturado",
  pago: "Pago",
};

const STATUS_BADGE: Record<string, string> = {
  rascunho: "badge-gray",
  enviada: "badge-blue",
  aprovada: "badge-green",
  rejeitada: "badge-red",
  cancelada: "badge-red",
  emitida: "badge-blue",
  parcial: "badge-yellow",
  paga: "badge-green",
  vencida: "badge-red",
  pendente: "badge-yellow",
  facturado: "badge-blue",
  pago: "badge-green",
  activo: "badge-green",
  concluido: "badge-gray",
};

type Tab = "painel" | "clientes" | "propostas" | "contratos" | "facturas" | "terceiros";
type DestDraft = { kind: "caixa" | "terceiro"; amount: string; partyName: string; description: string };

function QuoteStatusPipeline({ status }: { status: PracticeQuote["status"] }) {
  const rejected = status === "rejeitada" || status === "cancelada";
  const order: Record<string, number> = { rascunho: 0, enviada: 1, aprovada: 2 };
  const current = order[status] ?? -1;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {STATUS_PIPELINE.map((step, index) => {
        const stepOrder = order[step];
        const done = !rejected && current > stepOrder;
        const active = !rejected && current === stepOrder;
        return (
          <div key={step} className="flex items-center gap-1.5">
            {index > 0 && <span className="text-slate-300">→</span>}
            <span
              className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                rejected
                  ? "bg-slate-100 text-slate-400"
                  : active
                    ? "bg-brand-500 text-white"
                    : done
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-slate-100 text-slate-500"
              }`}
            >
              {QUOTE_STATUS[step]}
            </span>
          </div>
        );
      })}
      {rejected && <span className={`badge ${STATUS_BADGE[status]}`}>{QUOTE_STATUS[status]}</span>}
    </div>
  );
}

export default function PracticeOfficePage() {
  const { user } = useAuth();
  const canManage = can(user, "escritorio.gerir");
  const [searchParams, setSearchParams] = useSearchParams();

  const [tab, setTab] = useState<Tab>("painel");
  const [summary, setSummary] = useState<PracticeSummary | null>(null);
  const [clients, setClients] = useState<PracticeClient[]>([]);
  const [quotes, setQuotes] = useState<PracticeQuote[]>([]);
  const [engagements, setEngagements] = useState<PracticeEngagement[]>([]);
  const [invoices, setInvoices] = useState<PracticeInvoice[]>([]);
  const [payables, setPayables] = useState<PracticePayable[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [showClient, setShowClient] = useState(false);
  const [clientForm, setClientForm] = useState({
    name: "",
    contact: "",
    email: "",
    phone: "",
    address: "",
    nuit: "",
    notes: "",
  });
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [clientDossier, setClientDossier] = useState<ClientDossier | null>(null);
  const [loadingDossier, setLoadingDossier] = useState(false);

  const [acceptQuote, setAcceptQuote] = useState<PracticeQuote | null>(null);
  const [acceptAmount, setAcceptAmount] = useState("");
  const [acceptDiscountPct, setAcceptDiscountPct] = useState("");
  const [acceptNotes, setAcceptNotes] = useState("");

  const [showQuote, setShowQuote] = useState(false);
  const [quoteClientId, setQuoteClientId] = useState("");
  const [watchQuoteId, setWatchQuoteId] = useState<string | null>(null);

  const [receiptInvoice, setReceiptInvoice] = useState<PracticeInvoice | null>(null);
  const [receiptAmount, setReceiptAmount] = useState("");
  const [receiptDate, setReceiptDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [receiptReference, setReceiptReference] = useState("");
  const [destinations, setDestinations] = useState<DestDraft[]>([
    { kind: "caixa", amount: "", partyName: "", description: "" },
  ]);

  const [linkEngagement, setLinkEngagement] = useState<PracticeEngagement | null>(null);
  const [linkProjectId, setLinkProjectId] = useState("");
  const [expandedEngagementId, setExpandedEngagementId] = useState<string | null>(null);
  const [contractDetailTab, setContractDetailTab] = useState<"financeiro" | "producao">("financeiro");

  async function reload() {
    const [s, c, q, e, i, p, proj] = await Promise.all([
      practiceApi.summary(),
      practiceApi.listClients(),
      practiceApi.listQuotes(),
      practiceApi.listEngagements(),
      practiceApi.listInvoices(),
      practiceApi.listPayables(),
      boqApi.listProjects().catch(() => [] as Project[]),
    ]);
    setSummary(s);
    setClients(c);
    setQuotes(q);
    setEngagements(e);
    setInvoices(i);
    setPayables(p);
    setProjects(proj);
  }

  useEffect(() => {
    reload().catch((err) => setError(err instanceof Error ? err.message : "Erro ao carregar Comercial"));
  }, []);

  useEffect(() => {
    const tabParam = searchParams.get("tab") as Tab | null;
    const quoteParam = searchParams.get("quote");
    if (tabParam && ["painel", "clientes", "propostas", "contratos", "facturas", "terceiros"].includes(tabParam)) {
      setTab(tabParam);
    }
    if (quoteParam) {
      setWatchQuoteId(quoteParam);
      setTab("propostas");
    }
    if (tabParam || quoteParam) {
      const next = new URLSearchParams(searchParams);
      next.delete("tab");
      next.delete("quote");
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currency = summary?.currency ?? "MZN";
  const selectedClient = clients.find((c) => c.id === selectedClientId) ?? null;

  const filteredClients = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("pt");
    if (!needle) return clients;
    return clients.filter((row) =>
      [row.name, row.contact, row.email, row.phone, row.nuit]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase("pt").includes(needle)),
    );
  }, [clients, query]);

  const filteredQuotes = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("pt");
    if (!needle) return quotes;
    return quotes.filter((row) =>
      [row.title, row.clientName, row.quoteNumber, QUOTE_STATUS[row.status]]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase("pt").includes(needle)),
    );
  }, [query, quotes]);

  const filteredEngagements = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("pt");
    if (!needle) return engagements;
    return engagements.filter((row) =>
      [row.title, row.clientName].some((value) => String(value).toLocaleLowerCase("pt").includes(needle)),
    );
  }, [engagements, query]);

  const filteredInvoices = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("pt");
    if (!needle) return invoices;
    return invoices.filter((row) =>
      [row.clientName, row.invoiceNumber, INVOICE_STATUS[row.displayStatus ?? row.status]]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase("pt").includes(needle)),
    );
  }, [query, invoices]);

  async function handleCreateClient(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await practiceApi.createClient({
        name: clientForm.name.trim(),
        contact: clientForm.contact.trim() || null,
        email: clientForm.email.trim() || null,
        phone: clientForm.phone.trim() || null,
        address: clientForm.address.trim() || null,
        nuit: clientForm.nuit.trim() || null,
        notes: clientForm.notes.trim() || null,
      });
      setShowClient(false);
      setClientForm({ name: "", contact: "", email: "", phone: "", address: "", nuit: "", notes: "" });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar cliente");
    } finally {
      setBusy(false);
    }
  }

  function openProposalForClient(client?: PracticeClient | null) {
    setQuoteClientId(client?.id ?? "");
    setShowQuote(true);
  }

  async function handleProposalCreated(quoteId: string, createdClientId: string | null) {
    setShowQuote(false);
    setWatchQuoteId(quoteId);
    await reload();
    if (createdClientId) {
      const dossier = await practiceApi.getClient(createdClientId);
      setClientDossier(dossier);
      setSelectedClientId(createdClientId);
      setTab("clientes");
    } else {
      setTab("propostas");
    }
  }

  async function setStatus(quote: PracticeQuote, status: PracticeQuote["status"]) {
    if (status === "aprovada") {
      setAcceptQuote(quote);
      setAcceptAmount(Number(quote.totalAmount).toFixed(2));
      setAcceptDiscountPct("");
      setAcceptNotes("");
      return;
    }
    setError(null);
    try {
      await practiceApi.setQuoteStatus(quote.id, status);
      setWatchQuoteId(quote.id);
      await reload();
      if (selectedClientId) await refreshDossier();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao actualizar estado");
    }
  }

  function applyDiscountPercent(pctRaw: string) {
    setAcceptDiscountPct(pctRaw);
    if (!acceptQuote) return;
    const pct = Number(pctRaw);
    const proposed = Number(acceptQuote.totalAmount);
    if (!Number.isFinite(pct) || pct < 0) return;
    setAcceptAmount((proposed * (1 - pct / 100)).toFixed(2));
  }

  function applyAcceptedAmount(amountRaw: string) {
    setAcceptAmount(amountRaw);
    if (!acceptQuote) return;
    const accepted = Number(amountRaw);
    const proposed = Number(acceptQuote.totalAmount);
    if (!Number.isFinite(accepted) || proposed <= 0) return;
    setAcceptDiscountPct(Number((((proposed - accepted) / proposed) * 100).toFixed(2)).toString());
  }

  async function confirmAcceptQuote(e: FormEvent) {
    e.preventDefault();
    if (!acceptQuote) return;
    setError(null);
    setBusy(true);
    try {
      const proposed = Number(acceptQuote.totalAmount);
      const accepted = Number(acceptAmount);
      if (!Number.isFinite(accepted) || accepted < 0) throw new Error("Indique o valor aceite");
      if (accepted > proposed + 0.009) throw new Error("O valor aceite não pode ultrapassar a proposta");
      const discountAmount = Number((proposed - accepted).toFixed(2));
      const discountPercent = proposed > 0 ? Number(((discountAmount / proposed) * 100).toFixed(2)) : 0;
      await practiceApi.setQuoteStatus(acceptQuote.id, "aprovada", {
        acceptedAmount: accepted,
        discountAmount,
        discountPercent,
        acceptanceNotes:
          acceptNotes.trim() ||
          (discountAmount > 0.009
            ? `Proposta aceite com desconto de ${discountPercent}% (${money(discountAmount, acceptQuote.currency)}). Valor aceite: ${money(accepted, acceptQuote.currency)}.`
            : "Proposta aceite pelo valor proposto."),
      });
      const acceptedClientId = acceptQuote.clientId;
      setAcceptQuote(null);
      setWatchQuoteId(acceptQuote.id);
      await reload();
      if (acceptedClientId) {
        setSelectedClientId(acceptedClientId);
        setTab("clientes");
        try {
          setClientDossier(await practiceApi.getClient(acceptedClientId));
        } catch {
          setTab("contratos");
        }
      } else {
        setSelectedClientId(null);
        setClientDossier(null);
        setTab("contratos");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao registar aceitação");
    } finally {
      setBusy(false);
    }
  }

  async function openClientDossier(client: PracticeClient) {
    setSelectedClientId(client.id);
    setTab("clientes");
    setLoadingDossier(true);
    setError(null);
    try {
      setClientDossier(await practiceApi.getClient(client.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar ficha do cliente");
      setClientDossier(null);
    } finally {
      setLoadingDossier(false);
    }
  }

  async function refreshDossier() {
    if (!selectedClientId) return;
    const dossier = await practiceApi.getClient(selectedClientId);
    setClientDossier(dossier);
    await reload();
  }

  async function downloadQuote(quote: PracticeQuote) {
    try {
      await practiceApi.downloadQuotePdf(quote.id, `Proposta-${quote.quoteNumber ?? quote.id}.pdf`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao descarregar PDF");
    }
  }

  async function downloadInvoice(invoice: PracticeInvoice) {
    try {
      await practiceApi.downloadInvoicePdf(invoice.id, `Factura-${invoice.invoiceNumber ?? invoice.id}.pdf`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao descarregar PDF");
    }
  }

  async function cancelInvoice(invoice: PracticeInvoice) {
    if (!window.confirm(`Cancelar a factura ${invoice.invoiceNumber ?? ""}? O lançamento na obra (se existir) será removido.`)) {
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await practiceApi.cancelInvoice(invoice.id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao cancelar factura");
    } finally {
      setBusy(false);
    }
  }

  async function invoiceMilestone(milestoneId: string) {
    setError(null);
    setBusy(true);
    try {
      await practiceApi.invoiceMilestone(milestoneId);
      setTab("facturas");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao facturar parcela");
    } finally {
      setBusy(false);
    }
  }

  async function saveLinkProject(e: FormEvent) {
    e.preventDefault();
    if (!linkEngagement) return;
    setBusy(true);
    try {
      await practiceApi.linkEngagementProject(linkEngagement.id, linkProjectId || null);
      setLinkEngagement(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao ligar obra");
    } finally {
      setBusy(false);
    }
  }

  function openReceipt(invoice: PracticeInvoice) {
    const outstanding = invoice.outstandingAmount ?? Math.max(0, Number(invoice.netAmount) - (invoice.receivedAmount ?? 0));
    setReceiptInvoice(invoice);
    setReceiptAmount(outstanding > 0 ? outstanding.toFixed(2) : "");
    setReceiptDate(new Date().toISOString().slice(0, 10));
    setReceiptReference("");
    setDestinations([{ kind: "caixa", amount: outstanding > 0 ? outstanding.toFixed(2) : "", partyName: "", description: "" }]);
  }

  async function handleReceipt(e: FormEvent) {
    e.preventDefault();
    if (!receiptInvoice) return;
    setError(null);
    setBusy(true);
    try {
      const amount = Number(receiptAmount);
      const dests = destinations
        .map((dest) => ({
          kind: dest.kind,
          amount: Number(dest.amount),
          partyName: dest.kind === "terceiro" ? dest.partyName.trim() || undefined : undefined,
          description: dest.description.trim() || undefined,
        }))
        .filter((dest) => dest.amount > 0);
      if (!dests.length) throw new Error("Indique pelo menos um destino");
      await practiceApi.addReceipt(receiptInvoice.id, {
        amount,
        receivedDate: receiptDate,
        reference: receiptReference.trim() || undefined,
        destinations: dests,
      });
      setReceiptInvoice(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao registar recibo");
    } finally {
      setBusy(false);
    }
  }

  async function markPaid(payable: PracticePayable) {
    setError(null);
    try {
      await practiceApi.markDestinationPaid(payable.id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao marcar desembolso");
    }
  }

  const destSum = destinations.reduce((sum, dest) => sum + (Number(dest.amount) || 0), 0);
  const tabs: Array<[Tab, string]> = [
    ["painel", "Painel"],
    ["clientes", `Clientes (${clients.length})`],
    ["propostas", `Propostas (${quotes.length})`],
    ["contratos", `Contratos (${engagements.length})`],
    ["facturas", `Facturas (${invoices.length})`],
    ["terceiros", `A pagar (${payables.length})`],
  ];

  return (
    <Layout
      title="Comercial"
      subtitle="Clientes, propostas por fases, parcelas de honorários e documentos com marca da empresa"
      actions={
        canManage ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowClient(true)}>
              <IconPlus className="h-3.5 w-3.5" /> Cliente
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => openProposalForClient(clientDossier)}>
              <IconPlus className="h-3.5 w-3.5" /> Nova proposta
            </button>
          </div>
        ) : undefined
      }
    >
      <div className="mx-auto w-full max-w-7xl space-y-5">
        {error && !acceptQuote && <p className="text-sm text-red-600">{error}</p>}

        {summary?.documentSetup && (!summary.documentSetup.hasLogo || !summary.documentSetup.hasBankDetails) && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            <p className="font-semibold">Complete a identidade nos PDFs</p>
            <p className="mt-1 text-xs leading-5">
              {!summary.documentSetup.hasLogo ? "Falta o logótipo. " : ""}
              {!summary.documentSetup.hasBankDetails ? "Faltam os meios de pagamento (banco/conta). " : ""}
              Configure em{" "}
              <Link className="font-semibold text-brand-700 hover:underline" to="/empresa">
                Empresa
              </Link>{" "}
              para propostas e facturas saírem com marca e dados de pagamento.
            </p>
          </div>
        )}

        <section className="flex flex-wrap items-center gap-2.5 border-b border-slate-200 pb-2">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`rounded-xl px-3.5 py-2 text-sm font-medium ${tab === key ? "bg-brand-500 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </section>

        {tab === "painel" && (
          <div className="space-y-8">
            <section>
              <div>
                <h2 className="text-lg font-semibold tracking-tight text-slate-900">Escritório</h2>
                <p className="mt-1 max-w-xl text-sm text-slate-500">
                  {summary?.atelier
                    ? `${summary.atelier.comercial.aFechar} proposta(s) a fechar · conversão ${summary.atelier.comercial.conversaoPct}% · ${summary.atelier.producao.activeContracts} contrato(s) activo(s)`
                    : "Resumo do ciclo comercial e do que precisa da sua atenção."}
                </p>
              </div>

              <dl className="mt-5 grid gap-x-8 gap-y-4 border-y border-slate-200 py-4 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="text-xs text-slate-500">A receber</dt>
                  <dd className="mt-0.5 text-xl font-semibold tabular-nums text-slate-900">{money(summary?.receivables ?? 0, currency)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Vencido</dt>
                  <dd className={`mt-0.5 text-xl font-semibold tabular-nums ${(summary?.overdueAmount ?? 0) > 0 ? "text-rose-700" : "text-slate-900"}`}>
                    {money(summary?.overdueAmount ?? 0, currency)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Em negociação</dt>
                  <dd className="mt-0.5 text-xl font-semibold tabular-nums text-slate-900">
                    {money(summary?.atelier?.comercial.valorNegociacao ?? 0, currency)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Recebido</dt>
                  <dd className="mt-0.5 text-xl font-semibold tabular-nums text-slate-900">
                    {money(summary?.atelier?.financeiro.received ?? summary?.cashOnHand ?? 0, currency)}
                  </dd>
                </div>
              </dl>

              {summary?.atelier && (
                <p className="mt-3 text-xs text-slate-500">
                  Pipeline: {summary.atelier.comercial.rascunhos} rascunho(s) · {summary.atelier.comercial.enviadas} enviada(s) ·{" "}
                  {summary.atelier.comercial.aprovadas} aceite(s)
                  {summary.atelier.producao.phasesOverdue > 0 && (
                    <span className="text-rose-600"> · {summary.atelier.producao.phasesOverdue} fase(s) atrasada(s)</span>
                  )}
                  {summary.atelier.equipa.honorariosPendentes > 0 && (
                    <span>
                      {" "}
                      · honorários a pagar {money(summary.atelier.equipa.honorariosPendentes, currency)}
                    </span>
                  )}
                  {(summary.payablesThirdParty ?? 0) > 0 && (
                    <button type="button" className="ml-1 font-medium text-brand-700 hover:underline" onClick={() => setTab("terceiros")}>
                      · a desembolsar {money(summary.payablesThirdParty, currency)}
                    </button>
                  )}
                </p>
              )}
            </section>

            <section className="grid gap-8 lg:grid-cols-3">
              <div>
                <div className="flex items-baseline justify-between gap-2 border-b border-slate-200 pb-2">
                  <h3 className="text-sm font-semibold text-slate-900">Cobrança em atraso</h3>
                  <button type="button" className="text-xs font-medium text-brand-700 hover:underline" onClick={() => setTab("facturas")}>
                    Facturas
                  </button>
                </div>
                <ul className="mt-3 divide-y divide-slate-100">
                  {(summary?.overdueInvoices ?? []).map((row) => (
                    <li key={row.id}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-3 py-2.5 text-left text-sm hover:bg-slate-50"
                        onClick={() => setTab("facturas")}
                      >
                        <span>
                          <span className="font-medium text-slate-900">{row.clientName}</span>
                          <span className="mt-0.5 block text-xs text-rose-600">{row.overdueDays} dias · {row.invoiceNumber ?? "sem nº"}</span>
                        </span>
                        <span className="shrink-0 tabular-nums font-semibold text-rose-700">{money(row.outstanding, row.currency)}</span>
                      </button>
                    </li>
                  ))}
                  {!summary?.overdueInvoices?.length && (
                    <li className="py-6 text-sm text-slate-500">Nada vencido — cobranças em dia.</li>
                  )}
                </ul>
                {(summary?.receivables ?? 0) > 0 && (
                  <div className="mt-4 space-y-1.5">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Aging</p>
                    {(() => {
                      const aging = summary?.aging;
                      const parts = [
                        { key: "current", label: "Em prazo", value: aging?.current ?? 0, tone: "bg-slate-300" },
                        { key: "0-30", label: "0–30", value: aging?.["0-30"] ?? 0, tone: "bg-amber-400" },
                        { key: "30-60", label: "30–60", value: aging?.["30-60"] ?? 0, tone: "bg-orange-500" },
                        { key: "60+", label: "60+", value: aging?.["60+"] ?? 0, tone: "bg-rose-600" },
                      ] as const;
                      const total = parts.reduce((sum, part) => sum + part.value, 0) || 1;
                      return (
                        <>
                          <div className="flex h-2 overflow-hidden rounded-full bg-slate-100">
                            {parts.map((part) =>
                              part.value > 0 ? (
                                <div
                                  key={part.key}
                                  className={part.tone}
                                  style={{ width: `${(part.value / total) * 100}%` }}
                                  title={`${part.label}: ${money(part.value, currency)}`}
                                />
                              ) : null,
                            )}
                          </div>
                          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
                            {parts.map((part) => (
                              <span key={part.key}>
                                {part.label}{" "}
                                <span className="tabular-nums text-slate-700">{money(part.value, currency)}</span>
                              </span>
                            ))}
                          </div>
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>

              <div>
                <div className="flex items-baseline justify-between gap-2 border-b border-slate-200 pb-2">
                  <h3 className="text-sm font-semibold text-slate-900">Propostas a fechar</h3>
                  <button type="button" className="text-xs font-medium text-brand-700 hover:underline" onClick={() => setTab("propostas")}>
                    Ver todas
                  </button>
                </div>
                <ul className="mt-3 divide-y divide-slate-100">
                  {(summary?.pipelineQuotes ?? []).map((row) => (
                    <li key={row.id}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-3 py-2.5 text-left text-sm hover:bg-slate-50"
                        onClick={() => {
                          setWatchQuoteId(row.id);
                          setTab("propostas");
                        }}
                      >
                        <span>
                          <span className="font-medium text-slate-900">{row.title}</span>
                          <span className="mt-0.5 block text-xs text-slate-500">
                            {row.clientName} · {QUOTE_STATUS[row.status]}
                          </span>
                        </span>
                        <span className="shrink-0 tabular-nums font-medium text-slate-800">{money(row.totalAmount, row.currency)}</span>
                      </button>
                    </li>
                  ))}
                  {!summary?.pipelineQuotes?.length && (
                    <li className="py-6 text-sm text-slate-500">
                      Sem propostas abertas.{" "}
                      {canManage && (
                        <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => openProposalForClient(null)}>
                          Criar uma
                        </button>
                      )}
                    </li>
                  )}
                </ul>
              </div>

              <div>
                <div className="flex items-baseline justify-between gap-2 border-b border-slate-200 pb-2">
                  <h3 className="text-sm font-semibold text-slate-900">Parcelas a facturar</h3>
                  <button type="button" className="text-xs font-medium text-brand-700 hover:underline" onClick={() => setTab("contratos")}>
                    Contratos
                  </button>
                </div>
                <ul className="mt-3 divide-y divide-slate-100">
                  {(summary?.pendingMilestones ?? []).map((row) => (
                    <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left hover:bg-slate-50"
                        onClick={() => {
                          setExpandedEngagementId(row.engagementId);
                          setTab("contratos");
                        }}
                      >
                        <span className="font-medium text-slate-900">{row.title}</span>
                        <span className="mt-0.5 block text-xs text-slate-500">
                          {row.clientName} · {row.engagementTitle}
                          {row.dueDate ? ` · até ${row.dueDate}` : ""}
                        </span>
                      </button>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="tabular-nums font-medium text-slate-800">{money(row.amount, row.currency)}</span>
                        {canManage && (
                          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => invoiceMilestone(row.id)}>
                            Facturar
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                  {!summary?.pendingMilestones?.length && (
                    <li className="py-6 text-sm text-slate-500">Nenhuma parcela pendente de facturação.</li>
                  )}
                </ul>
              </div>
            </section>

            {summary?.atelier && (
              <section className="border-t border-slate-200 pt-4">
                <p className="text-xs text-slate-500">
                  Produção: {summary.atelier.producao.phasesInProgress} fase(s) em curso ·{" "}
                  {summary.atelier.producao.deliverablesPending} entregável(eis) pendente(s)
                  {summary.atelier.producao.addendaOpen > 0 && ` · ${summary.atelier.producao.addendaOpen} adenda(s) aberta(s)`}
                  {" · "}
                  equipa {summary.atelier.equipa.membersTotal}
                  {summary.atelier.equipa.membersExternal > 0 && ` (${summary.atelier.equipa.membersExternal} ext.)`}
                  {" · "}
                  facturado {money(summary.atelier.financeiro.invoiced, currency)}
                </p>
              </section>
            )}
          </div>
        )}

        {tab !== "painel" && tab !== "terceiros" && (
          <PageSearch value={query} onChange={setQuery} placeholder="Pesquisar…" />
        )}

        {tab === "clientes" && clientDossier && (
          <section className="space-y-4">
            <div className="card p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <button
                    type="button"
                    className="mb-2 text-xs font-semibold text-brand-700 hover:underline"
                    onClick={() => {
                      setClientDossier(null);
                      setSelectedClientId(null);
                      setWatchQuoteId(null);
                    }}
                  >
                    ← Todos os clientes
                  </button>
                  <h2 className="section-title text-xl">{clientDossier.name}</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    {[clientDossier.contact, clientDossier.phone, clientDossier.email, clientDossier.nuit && `NUIT ${clientDossier.nuit}`]
                      .filter(Boolean)
                      .join(" · ") || "Sem contactos"}
                  </p>
                  {clientDossier.address && <p className="mt-1 text-sm text-slate-500">{clientDossier.address}</p>}
                </div>
                {canManage && (
                  <button type="button" className="btn btn-primary" onClick={() => openProposalForClient(clientDossier)}>
                    <IconPlus className="h-4 w-4" /> Nova proposta
                  </button>
                )}
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-4 text-sm">
                <div className="rounded-lg bg-slate-50 px-3 py-2">
                  <p className="text-xs text-slate-500">Propostas</p>
                  <p className="font-semibold">{clientDossier.quotes.length}</p>
                </div>
                <div className="rounded-lg bg-slate-50 px-3 py-2">
                  <p className="text-xs text-slate-500">Contratos</p>
                  <p className="font-semibold">{clientDossier.engagements.length}</p>
                </div>
                <div className="rounded-lg bg-amber-50 px-3 py-2">
                  <p className="text-xs text-amber-700">Em aberto</p>
                  <p className="font-semibold tabular-nums">
                    {money(
                      Math.max(
                        0,
                        clientDossier.invoices
                          .filter((inv) => !["rascunho", "cancelada", "paga"].includes(inv.status))
                          .reduce((sum, inv) => sum + Number(inv.netAmount), 0) -
                          clientDossier.receipts.reduce((sum, r) => sum + Number(r.amount), 0),
                      ),
                      currency,
                    )}
                  </p>
                </div>
                <div className="rounded-lg bg-emerald-50 px-3 py-2">
                  <p className="text-xs text-emerald-700">Recebido</p>
                  <p className="font-semibold tabular-nums">
                    {money(clientDossier.receipts.reduce((sum, r) => sum + Number(r.amount), 0), currency)}
                  </p>
                </div>
              </div>
            </div>

            <div className="card overflow-hidden">
              <div className="border-b border-slate-200 px-4 py-3 sm:px-5">
                <h3 className="section-title text-base">Propostas deste cliente</h3>
                <p className="mt-0.5 text-xs text-slate-500">Elabore, descarregue PDF e acompanhe Rascunho → Enviada → Aceite.</p>
              </div>
              <ul className="divide-y divide-slate-100">
                {clientDossier.quotes.map((q) => {
                  const live = quotes.find((row) => row.id === q.id) ?? q;
                  const highlighted = watchQuoteId === live.id;
                  return (
                    <li key={live.id} className={`space-y-3 px-4 py-4 sm:px-5 ${highlighted ? "bg-brand-50/50" : ""}`}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900">{live.title}</div>
                          <div className="text-xs text-slate-500">
                            {getServiceType(live.serviceType ?? "")?.label ?? live.serviceType ?? "Proposta"}
                            {" · "}
                            {live.quoteNumber ?? "Sem número"}
                            {live.validUntil ? ` · válida até ${live.validUntil}` : ""}
                          </div>
                          {live.notes && <p className="mt-1 max-w-2xl text-xs text-slate-600 line-clamp-2">{live.notes}</p>}
                          {live.acceptanceNotes && <p className="mt-1 text-xs text-emerald-700">{live.acceptanceNotes}</p>}
                        </div>
                        <div className="text-right">
                          <div className="tabular-nums font-semibold">{money(live.totalAmount, live.currency)}</div>
                          {live.acceptedAmount && Number(live.acceptedAmount) !== Number(live.totalAmount) && (
                            <div className="text-xs font-medium text-emerald-700">Aceite {money(live.acceptedAmount, live.currency)}</div>
                          )}
                        </div>
                      </div>
                      <QuoteStatusPipeline status={live.status} />
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => downloadQuote(live)}>
                          Descarregar PDF
                        </button>
                        {canManage && live.status === "rascunho" && (
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setStatus(live, "enviada")}>
                            Marcar como enviada
                          </button>
                        )}
                        {canManage && (live.status === "rascunho" || live.status === "enviada") && (
                          <button type="button" className="btn btn-primary btn-sm" onClick={() => setStatus(live, "aprovada")}>
                            Registar aceitação
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
                {!clientDossier.quotes.length && (
                  <li className="px-4 py-10 text-center text-sm text-slate-500">
                    Ainda sem propostas. Crie a proposta de arquitectura completa para este cliente.
                    {canManage && (
                      <div className="mt-3">
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => openProposalForClient(clientDossier)}>
                          Nova proposta
                        </button>
                      </div>
                    )}
                  </li>
                )}
              </ul>
            </div>

            {(clientDossier.engagements.length > 0 || clientDossier.invoices.length > 0) && (
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="card p-4">
                  <h3 className="section-title text-sm">Contratos</h3>
                  <ul className="mt-2 space-y-2 text-sm">
                    {clientDossier.engagements.map((eng) => (
                      <li key={eng.id} className="rounded-lg bg-slate-50 px-3 py-2">
                        <div className="flex justify-between gap-2">
                          <span className="font-medium">{eng.title}</span>
                          <span className="tabular-nums">{money(eng.totalAmount, eng.currency)}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="card p-4">
                  <h3 className="section-title text-sm">Facturas</h3>
                  <ul className="mt-2 space-y-2 text-sm">
                    {clientDossier.invoices.map((inv) => (
                      <li key={inv.id} className="flex justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
                        <span>{inv.invoiceNumber ?? "Factura"} · {INVOICE_STATUS[inv.status] ?? inv.status}</span>
                        <span className="tabular-nums font-medium">{money(inv.netAmount, inv.currency)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </section>
        )}

        {tab === "clientes" && !clientDossier && (
          <section className="card overflow-hidden">
            <div className="border-b border-slate-200 px-4 py-3 sm:px-5">
              <h2 className="section-title text-base">Clientes</h2>
              <p className="mt-0.5 text-xs text-slate-500">Abra um cliente para elaborar propostas, PDF e acompanhar o estado.</p>
            </div>
            <ul className="divide-y divide-slate-100">
              {filteredClients.map((client) => {
                const clientQuotes = quotes.filter((q) => q.clientId === client.id || q.clientName === client.name);
                const openCount = clientQuotes.filter((q) => q.status === "rascunho" || q.status === "enviada").length;
                return (
                  <li key={client.id}>
                    <button
                      type="button"
                      className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-4 text-left hover:bg-slate-50 sm:px-5"
                      onClick={() => openClientDossier(client)}
                      disabled={loadingDossier && selectedClientId === client.id}
                    >
                      <div>
                        <div className="font-semibold text-slate-900">{client.name}</div>
                        <div className="text-xs text-slate-500">{client.phone || client.email || client.nuit || "Sem contacto"}</div>
                      </div>
                      <div className="text-right text-xs text-slate-500">
                        <div>{clientQuotes.length} proposta(s)</div>
                        {openCount > 0 && <div className="font-medium text-amber-700">{openCount} em curso</div>}
                        <div className="mt-1 font-semibold text-brand-700">Abrir →</div>
                      </div>
                    </button>
                  </li>
                );
              })}
              {!filteredClients.length && (
                <li className="px-4 py-10 text-center text-sm text-slate-500">Sem clientes. Crie o primeiro para começar a propor.</li>
              )}
            </ul>
          </section>
        )}

        {tab === "propostas" && (
          <section className="card overflow-hidden">
            <div className="border-b border-slate-200 p-4 sm:p-5">
              <div className="flex items-center gap-2">
                <IconBuilding className="h-4 w-4 text-brand-700" />
                <div>
                  <h2 className="section-title text-base">Propostas de honorários</h2>
                  <p className="mt-0.5 text-xs text-slate-500">Rascunho → enviada → aprovada (cria plano de parcelas).</p>
                </div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Proposta</th>
                    <th className="px-4 py-3 font-medium">Cliente</th>
                    <th className="px-4 py-3 font-medium">Estado</th>
                    <th className="px-4 py-3 font-medium text-right">Total</th>
                    <th className="px-4 py-3 font-medium text-right">Acções</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredQuotes.map((quote) => (
                    <tr
                      key={quote.id}
                      className={watchQuoteId === quote.id ? "bg-brand-50/80 ring-1 ring-inset ring-brand-200" : "hover:bg-slate-50/80"}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">
                          {quote.title}
                          {watchQuoteId === quote.id && (
                            <span className="ml-2 rounded-full bg-brand-500 px-2 py-0.5 text-[10px] font-semibold uppercase text-white">
                              Nova
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500">{quote.quoteNumber ?? "Sem número"}</div>
                        {quote.acceptanceNotes && (
                          <div className="mt-1 max-w-xs text-xs text-emerald-700 line-clamp-2">{quote.acceptanceNotes}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        <button
                          type="button"
                          className="text-left font-medium text-brand-700 hover:underline"
                          onClick={() => {
                            const client = clients.find((c) => c.id === quote.clientId || c.name === quote.clientName);
                            if (client) openClientDossier(client);
                          }}
                        >
                          {quote.clientName}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <QuoteStatusPipeline status={quote.status} />
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium">
                        <div>{money(quote.totalAmount, quote.currency)}</div>
                        {quote.status === "aprovada" && quote.acceptedAmount && Number(quote.acceptedAmount) !== Number(quote.totalAmount) && (
                          <div className="text-xs font-semibold text-emerald-700">
                            Aceite {money(quote.acceptedAmount, quote.currency)}
                            {quote.discountPercent ? ` (−${quote.discountPercent}%)` : ""}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex flex-wrap justify-end gap-1">
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => downloadQuote(quote)}>
                            PDF
                          </button>
                          {canManage && quote.status === "rascunho" && (
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setStatus(quote, "enviada")}>
                              Enviar
                            </button>
                          )}
                          {canManage && (quote.status === "rascunho" || quote.status === "enviada") && (
                            <button type="button" className="btn btn-primary btn-sm" onClick={() => setStatus(quote, "aprovada")}>
                              Registar aceitação
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!filteredQuotes.length && (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">
                        Ainda não há propostas. Crie a primeira com fases de honorários.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {tab === "contratos" && (
          <div className="space-y-4">
            {filteredEngagements.map((engagement) => (
              <section key={engagement.id} className="card overflow-hidden">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 p-4 sm:p-5">
                  <div>
                    <h2 className="section-title text-base">{engagement.title}</h2>
                    <p className="mt-1 text-sm text-slate-600">
                      {engagement.clientName} · {money(engagement.totalAmount, engagement.currency)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {engagement.serviceProjectType ? (
                        <span className="mr-2 font-medium text-slate-700">Serviços: {engagement.serviceProjectType}</span>
                      ) : (
                        <span className="mr-2 text-amber-700">Tipo de serviço por definir</span>
                      )}
                      {engagement.projectId ? (
                        <Link className="font-medium text-brand-700 hover:underline" to={`/projectos/${engagement.projectId}`}>
                          · Obra SIGO ligada
                        </Link>
                      ) : (
                        <span> · Sem obra SIGO</span>
                      )}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className={`badge ${STATUS_BADGE[engagement.status] ?? "badge-gray"}`}>{engagement.status}</span>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setExpandedEngagementId((id) => {
                          if (id === engagement.id) return null;
                          setContractDetailTab("financeiro");
                          return engagement.id;
                        });
                      }}
                    >
                      {expandedEngagementId === engagement.id ? "Ocultar detalhe" : "Detalhe do contrato"}
                    </button>
                    {canManage && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          setLinkEngagement(engagement);
                          setLinkProjectId(engagement.projectId ?? "");
                        }}
                      >
                        {engagement.projectId ? "Alterar obra" : "Ligar / criar obra"}
                      </button>
                    )}
                  </div>
                </div>
                {expandedEngagementId === engagement.id && (
                  <div>
                    <div className="flex flex-wrap gap-1.5 border-t border-slate-200 bg-white px-4 pt-3 sm:px-5">
                      {(
                        [
                          ["financeiro", "Equipa & margem"],
                          ["producao", "Cronograma & adendas"],
                        ] as const
                      ).map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                            contractDetailTab === id
                              ? "bg-brand-500 text-white"
                              : "bg-slate-100 text-slate-600"
                          }`}
                          onClick={() => setContractDetailTab(id)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {contractDetailTab === "financeiro" ? (
                      <ContractFinancePanel
                        engagement={engagement}
                        canManage={canManage}
                        onChanged={() => reload().catch(() => undefined)}
                        onError={(message) => setError(message)}
                      />
                    ) : (
                      <ContractOpsPanel
                        engagement={engagement}
                        canManage={canManage}
                        onChanged={() => reload().catch(() => undefined)}
                        onError={(message) => setError(message)}
                      />
                    )}
                  </div>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-3 font-medium">Parcela / fase</th>
                        <th className="px-4 py-3 font-medium">%</th>
                        <th className="px-4 py-3 font-medium text-right">Valor</th>
                        <th className="px-4 py-3 font-medium">Estado</th>
                        <th className="px-4 py-3 font-medium text-right">Acção</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(engagement.milestones ?? []).map((milestone) => (
                        <tr key={milestone.id}>
                          <td className="px-4 py-3 font-medium text-slate-900">{milestone.title}</td>
                          <td className="px-4 py-3 text-slate-600">{milestone.percent ? `${milestone.percent}%` : "—"}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{money(milestone.amount, engagement.currency)}</td>
                          <td className="px-4 py-3">
                            <span className={`badge ${STATUS_BADGE[milestone.status] ?? "badge-gray"}`}>
                              {MILESTONE_STATUS[milestone.status]}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            {canManage && milestone.status === "pendente" && (
                              <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => invoiceMilestone(milestone.id)}>
                                Facturar parcela
                              </button>
                            )}
                            {milestone.invoiceId && (
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => downloadInvoice({ id: milestone.invoiceId!, invoiceNumber: null } as PracticeInvoice)}
                              >
                                PDF factura
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                      {!(engagement.milestones ?? []).length && (
                        <tr>
                          <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">
                            Sem parcelas neste contrato.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
            {!filteredEngagements.length && (
              <div className="card px-4 py-10 text-center text-sm text-slate-500">
                Aprove uma proposta para criar o contrato e o plano de parcelas.
              </div>
            )}
          </div>
        )}

        {tab === "facturas" && (
          <section className="card overflow-hidden">
            <div className="border-b border-slate-200 p-4 sm:p-5">
              <h2 className="section-title text-base">Facturas & recibos</h2>
              <p className="mt-0.5 text-xs text-slate-500">Vencimento, aging e recibos com destino (caixa / terceiro).</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Cliente</th>
                    <th className="px-4 py-3 font-medium">Vencimento</th>
                    <th className="px-4 py-3 font-medium">Estado</th>
                    <th className="px-4 py-3 font-medium text-right">Facturado</th>
                    <th className="px-4 py-3 font-medium text-right">Em aberto</th>
                    <th className="px-4 py-3 font-medium text-right">Acções</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredInvoices.map((invoice) => (
                    <tr key={invoice.id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{invoice.clientName}</div>
                        <div className="text-xs text-slate-500">{invoice.invoiceNumber ?? "—"}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {invoice.dueDate ?? "—"}
                        {invoice.overdue && <div className="text-xs text-rose-600">{invoice.overdueDays}d vencido</div>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`badge ${STATUS_BADGE[invoice.displayStatus ?? invoice.status] ?? "badge-gray"}`}>
                          {INVOICE_STATUS[invoice.displayStatus ?? invoice.status] ?? invoice.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{money(invoice.netAmount, invoice.currency)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-amber-700">{money(invoice.outstandingAmount ?? 0, invoice.currency)}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex flex-wrap justify-end gap-1">
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => downloadInvoice(invoice)}>
                            PDF
                          </button>
                          {canManage && (invoice.outstandingAmount ?? 0) > 0.009 && !["rascunho", "cancelada"].includes(invoice.status) && (
                            <button type="button" className="btn btn-primary btn-sm" onClick={() => openReceipt(invoice)}>
                              Recibo
                            </button>
                          )}
                          {canManage && !["rascunho", "cancelada", "paga"].includes(invoice.status) && (invoice.outstandingAmount ?? 0) + 0.009 >= Number(invoice.netAmount) && (
                            <button type="button" className="btn btn-secondary btn-sm text-rose-700" disabled={busy} onClick={() => cancelInvoice(invoice)}>
                              Cancelar
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!filteredInvoices.length && (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">
                        Sem facturas. Facture uma parcela a partir de um contrato.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {tab === "terceiros" && (
          <section className="card overflow-hidden">
            <div className="border-b border-slate-200 p-4 sm:p-5">
              <h2 className="section-title text-base">A pagar a terceiros</h2>
              <p className="mt-0.5 text-xs text-slate-500">Valores recebidos que ainda têm de ser pagos a serviços externos.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Terceiro</th>
                    <th className="px-4 py-3 font-medium">Cliente / factura</th>
                    <th className="px-4 py-3 font-medium text-right">Valor</th>
                    <th className="px-4 py-3 font-medium text-right">Acção</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {payables.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{row.partyName ?? "Terceiro"}</div>
                        {row.description && <div className="text-xs text-slate-500">{row.description}</div>}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {row.clientName}
                        <div className="text-xs text-slate-500">{row.invoiceNumber ?? row.receivedDate}</div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium text-rose-700">{money(row.amount, row.currency)}</td>
                      <td className="px-4 py-3 text-right">
                        {canManage && (
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => markPaid(row)}>
                            Marcar pago
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!payables.length && (
                    <tr>
                      <td colSpan={4} className="px-4 py-10 text-center text-sm text-slate-500">
                        Nada a desembolsar neste momento.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>

      {acceptQuote && (
        <Modal
          title="Registar aceitação da proposta"
          subtitle={`${acceptQuote.title} · proposta ${money(acceptQuote.totalAmount, acceptQuote.currency)}`}
          onClose={() => setAcceptQuote(null)}
          maxWidth="max-w-lg"
        >
          <form className="space-y-4" onSubmit={confirmAcceptQuote}>
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <p className="text-sm text-slate-600">
              Se o cliente aceitou com desconto ou valor negociado, indique aqui o valor final. O contrato e as parcelas usam esse valor.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Desconto (%)</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={acceptDiscountPct}
                  onChange={(e) => applyDiscountPercent(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="label">Valor aceite</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  step="0.01"
                  required
                  value={acceptAmount}
                  onChange={(e) => applyAcceptedAmount(e.target.value)}
                />
              </div>
            </div>
            {Number(acceptQuote.totalAmount) - Number(acceptAmount || 0) > 0.009 && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Desconto de {money(Number(acceptQuote.totalAmount) - Number(acceptAmount || 0), acceptQuote.currency)} face à proposta original.
              </p>
            )}
            <div>
              <label className="label">Nota de aceitação</label>
              <textarea
                className="input min-h-[88px]"
                value={acceptNotes}
                onChange={(e) => setAcceptNotes(e.target.value)}
                placeholder="Ex.: Cliente aceitou com 10% de desconto na adjudicação, conforme reunião de 4/Ago. Condições de pagamento mantêm-se."
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => setAcceptQuote(null)}>
                Cancelar
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                Confirmar aceitação
              </button>
            </div>
          </form>
        </Modal>
      )}

      {showClient && (
        <Modal title="Novo cliente" subtitle="CRM comercial" onClose={() => setShowClient(false)} maxWidth="max-w-lg">
          <form className="space-y-3" onSubmit={handleCreateClient}>
            <div>
              <label className="label">Nome</label>
              <input className="input" required value={clientForm.name} onChange={(e) => setClientForm({ ...clientForm, name: e.target.value })} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Contacto</label>
                <input className="input" value={clientForm.contact} onChange={(e) => setClientForm({ ...clientForm, contact: e.target.value })} />
              </div>
              <div>
                <label className="label">Telefone</label>
                <input className="input" value={clientForm.phone} onChange={(e) => setClientForm({ ...clientForm, phone: e.target.value })} />
              </div>
              <div>
                <label className="label">Email</label>
                <input className="input" type="email" value={clientForm.email} onChange={(e) => setClientForm({ ...clientForm, email: e.target.value })} />
              </div>
              <div>
                <label className="label">NUIT</label>
                <input className="input" value={clientForm.nuit} onChange={(e) => setClientForm({ ...clientForm, nuit: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="label">Morada</label>
              <input className="input" value={clientForm.address} onChange={(e) => setClientForm({ ...clientForm, address: e.target.value })} />
            </div>
            <div>
              <label className="label">Notas</label>
              <textarea className="input min-h-[72px]" value={clientForm.notes} onChange={(e) => setClientForm({ ...clientForm, notes: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => setShowClient(false)}>
                Cancelar
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                Guardar
              </button>
            </div>
          </form>
        </Modal>
      )}

      {showQuote && (
        <ProposalWizard
          clients={clients}
          initialClient={clients.find((c) => c.id === quoteClientId) ?? clientDossier}
          onClose={() => setShowQuote(false)}
          onCreated={handleProposalCreated}
        />
      )}

      {linkEngagement && (
        <Modal
          title="Ligar obra SIGO (execução)"
          subtitle={linkEngagement.title}
          onClose={() => setLinkEngagement(null)}
          maxWidth="max-w-lg"
        >
          <form className="space-y-4" onSubmit={saveLinkProject}>
            <p className="text-xs text-slate-500">
              Isto liga uma <strong>obra de execução</strong> no SIGO. O projecto de serviços (Arquitectura, Fiscalização, etc.)
              define-se em «Equipa &amp; margem» — são conceitos distintos.
            </p>
            <div>
              <label className="label">Projecto / obra existente</label>
              <select className="input" value={linkProjectId} onChange={(e) => setLinkProjectId(e.target.value)}>
                <option value="">— Sem ligação —</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-xs text-slate-500">
              Para criar uma obra nova, use{" "}
              <Link className="font-medium text-brand-700 hover:underline" to="/medicoes">
                Medições
              </Link>{" "}
              ou{" "}
              <Link className="font-medium text-brand-700 hover:underline" to="/orcamentos">
                Orçamentos
              </Link>{" "}
              e depois volte aqui para ligar.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => setLinkEngagement(null)}>
                Cancelar
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                Guardar
              </button>
            </div>
          </form>
        </Modal>
      )}

      {receiptInvoice && (
        <Modal
          title="Registar recibo"
          subtitle={`${receiptInvoice.clientName} — em aberto ${money(receiptInvoice.outstandingAmount ?? 0, receiptInvoice.currency)}`}
          onClose={() => setReceiptInvoice(null)}
          maxWidth="max-w-lg"
        >
          <form className="space-y-4" onSubmit={handleReceipt}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Valor recebido</label>
                <input className="input" type="number" min={0.01} step="0.01" required value={receiptAmount} onChange={(e) => setReceiptAmount(e.target.value)} />
              </div>
              <div>
                <label className="label">Data</label>
                <input className="input" type="date" required value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <label className="label">Referência (opcional)</label>
                <input className="input" value={receiptReference} onChange={(e) => setReceiptReference(e.target.value)} placeholder="Transferência, cheque…" />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="label mb-0">Destinos do valor</label>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setDestinations([...destinations, { kind: "terceiro", amount: "", partyName: "", description: "" }])}
                >
                  <IconPlus className="h-3.5 w-3.5" /> Destino
                </button>
              </div>
              {destinations.map((dest, index) => (
                <div key={index} className="space-y-2 rounded-lg border border-slate-200 p-3">
                  <div className="grid grid-cols-[120px_1fr] gap-2">
                    <select
                      className="input"
                      value={dest.kind}
                      onChange={(e) =>
                        setDestinations(destinations.map((row, i) => (i === index ? { ...row, kind: e.target.value as "caixa" | "terceiro" } : row)))
                      }
                    >
                      <option value="caixa">Caixa</option>
                      <option value="terceiro">Terceiro</option>
                    </select>
                    <input
                      className="input"
                      type="number"
                      min={0.01}
                      step="0.01"
                      required
                      placeholder="Valor"
                      value={dest.amount}
                      onChange={(e) => setDestinations(destinations.map((row, i) => (i === index ? { ...row, amount: e.target.value } : row)))}
                    />
                  </div>
                  {dest.kind === "terceiro" && (
                    <input
                      className="input"
                      placeholder="Nome do terceiro / prestador"
                      value={dest.partyName}
                      onChange={(e) => setDestinations(destinations.map((row, i) => (i === index ? { ...row, partyName: e.target.value } : row)))}
                    />
                  )}
                  <input
                    className="input"
                    placeholder="Nota (opcional)"
                    value={dest.description}
                    onChange={(e) => setDestinations(destinations.map((row, i) => (i === index ? { ...row, description: e.target.value } : row)))}
                  />
                </div>
              ))}
              <p className={`text-xs ${Math.abs(destSum - Number(receiptAmount || 0)) > 0.02 ? "text-rose-600" : "text-slate-500"}`}>
                Soma dos destinos: {money(destSum, receiptInvoice.currency)}
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => setReceiptInvoice(null)}>
                Cancelar
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                Guardar recibo
              </button>
            </div>
          </form>
        </Modal>
      )}
    </Layout>
  );
}

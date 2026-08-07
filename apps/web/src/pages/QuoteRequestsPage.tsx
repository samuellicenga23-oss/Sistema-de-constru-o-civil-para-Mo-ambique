import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Layout from "../components/Layout";
import GestaoTabs from "../components/GestaoTabs";
import Modal from "../components/Modal";
import QuoteRequestModal from "../components/QuoteRequestModal";
import { quoteRequestsApi, type QuoteRequest, type QuoteRequestDetail, type QuoteRequestStatus } from "../api/quoteRequests";
import { suppliersApi, type Supplier } from "../api/suppliers";
import { ApiError } from "../api/http";
import { IconClipboard, IconDownload, IconPlus } from "../components/icons";

const STATUS_LABELS: Record<QuoteRequestStatus, string> = {
  enviado: "Enviado — a aguardar resposta",
  respondido: "Respondido — pronto a rever",
  aceite: "Aceite",
  recusado: "Recusado",
  expirado: "Expirado",
  cancelado: "Cancelado",
};

const STATUS_BADGE: Record<QuoteRequestStatus, string> = {
  enviado: "badge-neutral",
  respondido: "badge-brand",
  aceite: "badge-success",
  recusado: "badge-danger",
  expirado: "badge-neutral",
  cancelado: "badge-neutral",
};

function formatMoney(value: string | null, currency: string) {
  if (value == null) return "—";
  return `${Number(value).toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

export default function QuoteRequestsPage() {
  const [requests, setRequests] = useState<QuoteRequest[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<QuoteRequestDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pickingSupplier, setPickingSupplier] = useState(false);
  const [quoteSupplier, setQuoteSupplier] = useState<Supplier | null>(null);
  const [selectedSupplierId, setSelectedSupplierId] = useState("");

  async function reload() {
    setRequests(await quoteRequestsApi.list());
  }

  useEffect(() => {
    reload().catch((err) => setError(err.message));
    suppliersApi
      .list()
      .then((rows) => {
        setSuppliers(rows);
        setSelectedSupplierId((current) => current || rows.find((s) => s.supplierAccountId)?.id || rows[0]?.id || "");
      })
      .catch(() => setSuppliers([]));
  }, []);

  async function openDetail(id: string) {
    setError(null);
    try {
      setDetail(await quoteRequestsApi.get(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar pedido");
    }
  }

  async function handleAccept() {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      await quoteRequestsApi.accept(detail.id);
      setDetail(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao aceitar cotação");
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      await quoteRequestsApi.cancel(detail.id);
      setDetail(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao cancelar pedido");
    } finally {
      setBusy(false);
    }
  }

  async function handleDownloadComparisonPdf() {
    if (!detail) return;
    setPdfBusy(true);
    setError(null);
    try {
      await quoteRequestsApi.downloadComparisonPdf(detail.id, detail.title);
    } catch (err) {
      if (err instanceof ApiError && err.status === 402) {
        setError(`${err.message}${err.upgradeHint ? ` — ${err.upgradeHint}` : ""}`);
      } else {
        setError(err instanceof Error ? err.message : "Erro ao gerar PDF de comparação");
      }
    } finally {
      setPdfBusy(false);
    }
  }

  function openCreateFlow() {
    setError(null);
    setDetail(null);
    setPickingSupplier(true);
  }

  function confirmSupplierPick() {
    const supplier = suppliers.find((s) => s.id === selectedSupplierId);
    if (!supplier) {
      setError("Escolha um fornecedor para o pedido.");
      return;
    }
    if (!supplier.supplierAccountId) {
      setError("Este fornecedor ainda não tem conta no Portal do Fornecedor — não pode receber o pedido.");
      return;
    }
    setPickingSupplier(false);
    setQuoteSupplier(supplier);
  }

  return (
    <Layout
      title="Gestão da obra"
      subtitle="Cotações: peça preços aos fornecedores, acompanhe respostas e descarregue o PDF de comparação (Profissional+)"
      actions={
        <button type="button" onClick={openCreateFlow} className="btn btn-primary btn-sm">
          <IconPlus className="h-3.5 w-3.5" />
          Novo pedido de cotação
        </button>
      }
    >
      <div className="mx-auto w-full max-w-5xl space-y-5">
        <GestaoTabs />
        {error && !detail && !pickingSupplier && !quoteSupplier && <p className="text-sm text-red-600">{error}</p>}

        <div className="rounded-xl border border-teal-200 bg-teal-50/60 px-4 py-3 text-sm text-teal-950">
          <p className="font-semibold">Como funciona o pedido de cotação</p>
          <p className="mt-1 text-[13px] leading-relaxed text-teal-900/90">
            Crie um pedido a um fornecedor da sua empresa (incl. SIGO Preços). Ele responde no Portal do Fornecedor; aceite aqui para
            usar nas compras. No Profissional+, o PDF de comparação ordena quem tem o material — zona da obra primeiro, depois do melhor
            preço ao mais caro.
          </p>
        </div>

        <section className="card overflow-hidden">
          <div className="border-b border-slate-200 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <IconClipboard className="h-4 w-4 text-brand-700" />
                <div>
                  <h2 className="section-title text-base">Cotações recebidas</h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Fornecedores respondem no Portal (gratuito para quem vende). Aceite aqui para usar nas compras da obra.
                  </p>
                </div>
              </div>
              <button type="button" onClick={openCreateFlow} className="btn btn-secondary btn-sm">
                <IconPlus className="h-3.5 w-3.5" />
                Novo pedido
              </button>
            </div>
          </div>
          <div className="divide-y divide-slate-100">
            {requests.map((r) => (
              <button key={r.id} onClick={() => openDetail(r.id)} className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-950">{r.title}</p>
                  <p className="text-xs text-slate-500">
                    {r.supplierName}
                    {r.projectName ? ` · ${r.projectName}` : ""} · {new Date(r.createdAt).toLocaleDateString("pt-PT")}
                  </p>
                </div>
                <span className={`badge ${STATUS_BADGE[r.status]}`}>{STATUS_LABELS[r.status]}</span>
              </button>
            ))}
            {requests.length === 0 && (
              <div className="space-y-3 px-5 py-10 text-center">
                <p className="text-sm text-slate-500">Ainda não há cotações. Crie um pedido para um fornecedor com conta no Portal.</p>
                <button type="button" onClick={openCreateFlow} className="btn btn-primary btn-sm">
                  <IconPlus className="h-3.5 w-3.5" />
                  Novo pedido de cotação
                </button>
              </div>
            )}
          </div>
        </section>
      </div>

      {pickingSupplier && (
        <Modal title="Novo pedido de cotação" subtitle="Escolha o fornecedor que vai receber o pedido" onClose={() => setPickingSupplier(false)} maxWidth="max-w-lg">
          {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
          {suppliers.length === 0 ? (
            <p className="text-sm text-slate-500">Sem fornecedores disponíveis. O SIGO Preços aparece automaticamente após a sincronização do catálogo.</p>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="label">Fornecedor</label>
                <select value={selectedSupplierId} onChange={(e) => setSelectedSupplierId(e.target.value)} className="input">
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.isReference ? `${s.name} (referência)` : s.name}
                      {!s.supplierAccountId ? " — sem portal" : ""}
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-[11px] text-slate-500">Só fornecedores com conta no Portal do Fornecedor podem receber o pedido.</p>
              </div>
              <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end">
                <button type="button" onClick={() => setPickingSupplier(false)} className="btn btn-secondary">
                  Cancelar
                </button>
                <button type="button" onClick={confirmSupplierPick} className="btn btn-primary">
                  Continuar
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {quoteSupplier && (
        <QuoteRequestModal
          supplier={quoteSupplier}
          onClose={() => setQuoteSupplier(null)}
          onCreated={() => {
            setQuoteSupplier(null);
            reload().catch((err) => setError(err.message));
          }}
        />
      )}

      {detail && (
        <Modal title={detail.title} subtitle={`${detail.supplierName}${detail.projectName ? ` · ${detail.projectName}` : ""}`} onClose={() => setDetail(null)} maxWidth="max-w-2xl">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`badge ${STATUS_BADGE[detail.status]}`}>{STATUS_LABELS[detail.status]}</span>
              {detail.deadlineDate && <span className="text-xs text-slate-500">Prazo: {new Date(detail.deadlineDate).toLocaleDateString("pt-PT")}</span>}
            </div>
            {detail.message && <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{detail.message}</p>}
            {detail.supplierNotes && (
              <p className="rounded-lg border border-brand-200 bg-brand-50 p-3 text-sm text-slate-700">
                <strong>Nota do fornecedor:</strong> {detail.supplierNotes}
              </p>
            )}

            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Item</th>
                    <th className="px-3 py-2 text-right">Qtd.</th>
                    <th className="px-3 py-2 text-right">Preço do fornecedor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {detail.lines.map((line) => (
                    <tr key={line.id}>
                      <td className="px-3 py-2">
                        {line.description}
                        {line.supplierLineNotes && <p className="mt-0.5 text-xs text-slate-500">{line.supplierLineNotes}</p>}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-500">
                        {line.quantity ?? "—"} {line.unit}
                      </td>
                      <td className="px-3 py-2 text-right font-medium">{formatMoney(line.unitCost, line.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:justify-between">
              <button
                type="button"
                onClick={() => void handleDownloadComparisonPdf()}
                disabled={pdfBusy}
                className="btn btn-secondary"
                title="Lista fornecedores com o material, contactos, ordenados do melhor preço ao mais caro (Profissional+)"
              >
                <IconDownload className="h-3.5 w-3.5" />
                {pdfBusy ? "A gerar PDF…" : "PDF comparação de fornecedores"}
              </button>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                {(detail.status === "enviado" || detail.status === "respondido") && (
                  <button onClick={handleCancel} disabled={busy} className="btn btn-secondary">
                    Cancelar pedido
                  </button>
                )}
                {detail.status === "respondido" && (
                  <button onClick={handleAccept} disabled={busy} className="btn btn-primary">
                    {busy ? "A aceitar..." : "Aceitar e guardar cotação do fornecedor"}
                  </button>
                )}
              </div>
            </div>
            {error && (
              <p className="text-sm text-red-600">
                {error}{" "}
                {error.includes("Profissional") && (
                  <Link to="/creditos" className="font-semibold underline">
                    Ver planos
                  </Link>
                )}
              </p>
            )}
          </div>
        </Modal>
      )}
    </Layout>
  );
}

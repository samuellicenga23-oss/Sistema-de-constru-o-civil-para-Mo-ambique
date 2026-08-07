import { useEffect, useState } from "react";
import Layout from "../components/Layout";
import Modal from "../components/Modal";
import { quoteRequestsApi, type QuoteRequest, type QuoteRequestDetail, type QuoteRequestStatus } from "../api/quoteRequests";
import { IconClipboard } from "../components/icons";

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
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<QuoteRequestDetail | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    setRequests(await quoteRequestsApi.list());
  }

  useEffect(() => {
    reload().catch((err) => setError(err.message));
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

  return (
    <Layout
      title="Pedidos de Cotação"
      subtitle="Pedidos ao Portal do Fornecedor — as cotações aceites ficam na ficha do fornecedor; o preço base do Catálogo (orçamentos) edita-se à parte, sem fornecedor"
    >
      <div className="mx-auto w-full max-w-5xl space-y-5">
        {error && <p className="text-sm text-red-600">{error}</p>}

        <section className="card overflow-hidden">
          <div className="border-b border-slate-200 p-4 sm:p-5">
            <div className="flex items-center gap-2">
              <IconClipboard className="h-4 w-4 text-brand-700" />
              <div>
                <h2 className="section-title text-base">Pedidos enviados</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Peça cotações em Fornecedores → Pedir cotação. Aceitar guarda só a cotação do fornecedor; não substitui o preço base do catálogo.
                </p>
              </div>
            </div>
          </div>
          <div className="divide-y divide-slate-100">
            {requests.map((r) => (
              <button key={r.id} onClick={() => openDetail(r.id)} className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-950">{r.title}</p>
                  <p className="text-xs text-slate-500">{r.supplierName}{r.projectName ? ` · ${r.projectName}` : ""} · {new Date(r.createdAt).toLocaleDateString("pt-PT")}</p>
                </div>
                <span className={`badge ${STATUS_BADGE[r.status]}`}>{STATUS_LABELS[r.status]}</span>
              </button>
            ))}
            {requests.length === 0 && <p className="px-5 py-10 text-center text-sm text-slate-500">Ainda não enviou nenhum pedido de cotação.</p>}
          </div>
        </section>
      </div>

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
                      <td className="px-3 py-2">{line.description}{line.supplierLineNotes && <p className="mt-0.5 text-xs text-slate-500">{line.supplierLineNotes}</p>}</td>
                      <td className="px-3 py-2 text-right text-slate-500">{line.quantity ?? "—"} {line.unit}</td>
                      <td className="px-3 py-2 text-right font-medium">{formatMoney(line.unitCost, line.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end">
              {(detail.status === "enviado" || detail.status === "respondido") && (
                <button onClick={handleCancel} disabled={busy} className="btn btn-secondary">Cancelar pedido</button>
              )}
              {detail.status === "respondido" && (
                <button onClick={handleAccept} disabled={busy} className="btn btn-primary">
                  {busy ? "A aceitar..." : "Aceitar e guardar cotação do fornecedor"}
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </Layout>
  );
}

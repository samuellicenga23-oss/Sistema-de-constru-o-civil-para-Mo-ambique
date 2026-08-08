import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { supplierPortalAuthApi, type SupplierAccount } from "../api/supplierPortal";
import { supplierAccountsPayableApi, type SupplierNcr } from "../api/accountsPayable";

type ResolutionType = "substituicao" | "nota_credito" | "devolucao" | "aceite_com_desconto" | "outro";

const RESOLUTION_LABELS: Record<ResolutionType, string> = {
  substituicao: "Substituir material",
  nota_credito: "Emitir nota de crédito",
  devolucao: "Aceitar devolução",
  aceite_com_desconto: "Aceite com desconto",
  outro: "Outra solução",
};

const RETURN_LABELS: Record<string, string> = {
  rascunho: "Rascunho",
  expedida: "Em devolução",
  recebida_fornecedor: "Recebida pelo fornecedor",
  cancelada: "Cancelada",
};

export default function SupplierNonconformitiesPage() {
  const navigate = useNavigate();
  const [account, setAccount] = useState<SupplierAccount | null>(null);
  const [rows, setRows] = useState<SupplierNcr[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [resolution, setResolution] = useState<Record<string, ResolutionType>>({});
  const [message, setMessage] = useState<Record<string, string>>({});
  const [qty, setQty] = useState<Record<string, string>>({});
  const [credit, setCredit] = useState<Record<string, string>>({});

  async function reload() {
    setRows(await supplierAccountsPayableApi.nonconformities());
  }

  useEffect(() => {
    document.title = "Não-conformidades — Portal do Fornecedor SIGO";
    supplierPortalAuthApi.me()
      .then(async (me) => {
        setAccount(me);
        await reload();
      })
      .catch(() => navigate("/login", { replace: true }))
      .finally(() => setLoading(false));
    return () => { document.title = "Portal do Fornecedor — SIGO"; };
  }, [navigate]);

  async function respond(row: SupplierNcr) {
    const id = row.ncr.id;
    const type = resolution[id] ?? "substituicao";
    setSavingId(id);
    setError(null);
    try {
      await supplierAccountsPayableApi.respondNcr(id, {
        resolutionType: type,
        replacementQty: type === "substituicao" ? Number(qty[id] ?? row.ncr.rejectedQty) : undefined,
        creditAmount: ["nota_credito", "aceite_com_desconto"].includes(type) ? Number(credit[id] ?? 0) : undefined,
        response: message[id] ?? "",
      });
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível responder");
    } finally {
      setSavingId(null);
    }
  }

  async function confirmReturn(returnId: string) {
    setSavingId(returnId);
    setError(null);
    try {
      await supplierAccountsPayableApi.confirmReturn(returnId);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível confirmar a devolução");
    } finally {
      setSavingId(null);
    }
  }

  if (loading || !account) {
    return (
      <AppShell accountName={account?.name ?? "…"}>
        <main className="portal-main"><div className="skeleton" style={{ height: "14rem" }} /></main>
      </AppShell>
    );
  }

  return (
    <AppShell accountName={account.name}>
      <main className="portal-main">
        <section className="hero-panel fade-up">
          <div className="hero-panel-content">
            <p className="hero-eyebrow">Qualidade</p>
            <h1 className="hero-title">Não-conformidades</h1>
            <p className="hero-subtitle">Materiais rejeitados pela obra, solução acordada e cadeia de devolução.</p>
          </div>
        </section>

        {error && <div className="card card-pad" style={{ color: "#b42318" }}>{error}</div>}

        {rows.length === 0 ? (
          <div className="card card-pad">Sem não-conformidades.</div>
        ) : rows.map((row) => {
          const id = row.ncr.id;
          const activeResolution = resolution[id] ?? "substituicao";
          return (
            <div key={id} className="card card-pad" style={{ display: "grid", gap: "0.85rem" }}>
              <div>
                <p className="text-muted-sm">{row.companyName} · {row.projectName}</p>
                <h2>{row.ncr.reference} · {row.materialName}</h2>
                <p>{row.ncr.description}</p>
                <p className="text-muted-sm">
                  Rejeitado: {Number(row.ncr.rejectedQty).toLocaleString("pt-MZ")} · Estado: {row.ncr.status.replaceAll("_", " ")}
                </p>
              </div>

              {row.returns.length > 0 && (
                <div style={{ display: "grid", gap: "0.5rem" }}>
                  <strong style={{ fontSize: "0.8rem" }}>Devoluções associadas</strong>
                  {row.returns.map((ret) => (
                    <div key={ret.id} style={{ border: "1px solid var(--border)", borderRadius: "0.8rem", padding: "0.75rem", display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
                      <div>
                        <strong>{ret.reference}</strong>
                        <p className="text-muted-sm">
                          {Number(ret.quantity).toLocaleString("pt-MZ")} · {ret.returnDate ?? "sem data"} · {RETURN_LABELS[ret.status] ?? ret.status}
                        </p>
                        {ret.trackingReference && <p className="text-muted-sm">Transporte/ref.: {ret.trackingReference}</p>}
                        {ret.reason && <p className="text-muted-sm">{ret.reason}</p>}
                      </div>
                      {ret.status === "expedida" && (
                        <button className="btn btn-primary" disabled={savingId === ret.id} onClick={() => void confirmReturn(ret.id)}>
                          {savingId === ret.id ? "A confirmar…" : "Confirmar recepção da devolução"}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {row.ncr.supplierResponse ? (
                <p><strong>Resposta enviada:</strong> {row.ncr.supplierResponse}</p>
              ) : !["resolvida", "cancelada"].includes(row.ncr.status) ? (
                <div style={{ display: "grid", gap: "0.6rem" }}>
                  <select className="input" value={activeResolution} onChange={(e) => setResolution((current) => ({ ...current, [id]: e.target.value as ResolutionType }))}>
                    {Object.entries(RESOLUTION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  {activeResolution === "substituicao" && (
                    <input type="number" className="input" placeholder="Quantidade a substituir" value={qty[id] ?? row.ncr.rejectedQty} onChange={(e) => setQty((current) => ({ ...current, [id]: e.target.value }))} />
                  )}
                  {["nota_credito", "aceite_com_desconto"].includes(activeResolution) && (
                    <input type="number" className="input" placeholder="Valor do crédito/desconto" value={credit[id] ?? ""} onChange={(e) => setCredit((current) => ({ ...current, [id]: e.target.value }))} />
                  )}
                  <textarea className="input" rows={2} placeholder="Descreva a solução" value={message[id] ?? ""} onChange={(e) => setMessage((current) => ({ ...current, [id]: e.target.value }))} />
                  <button className="btn btn-primary" disabled={savingId === id || (message[id]?.trim().length ?? 0) < 5} onClick={() => void respond(row)}>
                    {savingId === id ? "A enviar…" : "Enviar proposta de solução"}
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </main>
    </AppShell>
  );
}

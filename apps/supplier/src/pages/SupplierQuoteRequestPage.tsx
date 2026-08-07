import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../api/http";
import { AppShell } from "../components/AppShell";
import { useToast } from "../components/Toast";
import { IconCheck, IconClipboard } from "../components/icons";
import { supplierPortalApi, supplierPortalAuthApi, type SupplierAccount, type SupplierQuoteRequestDetail } from "../api/supplierPortal";

const STATUS_LABELS: Record<string, string> = {
  enviado: "Por responder",
  respondido: "Respondido",
  aceite: "Aceite",
  recusado: "Recusado",
  expirado: "Expirado",
  cancelado: "Cancelado",
};

export default function SupplierQuoteRequestPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const [account, setAccount] = useState<SupplierAccount | null>(null);
  const [detail, setDetail] = useState<SupplierQuoteRequestDetail | null>(null);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [supplierNotes, setSupplierNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!id) return;
    document.title = "Pedido de cotação — Portal do Fornecedor SIGO";
    supplierPortalAuthApi
      .me()
      .then((me) => {
        setAccount(me);
        return supplierPortalApi.quoteRequest(id);
      })
      .then((d) => {
        setDetail(d);
        setSupplierNotes(d.supplierNotes ?? "");
        const initialPrices: Record<string, string> = {};
        const initialNotes: Record<string, string> = {};
        for (const line of d.lines) {
          if (line.unitCost != null) initialPrices[line.id] = line.unitCost;
          if (line.supplierLineNotes) initialNotes[line.id] = line.supplierLineNotes;
        }
        setPrices(initialPrices);
        setNotes(initialNotes);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) navigate("/login", { replace: true });
        else setError(err instanceof Error ? err.message : "Erro ao carregar pedido");
      })
      .finally(() => setLoading(false));
    return () => {
      document.title = "Portal do Fornecedor — SIGO";
    };
  }, [id, navigate]);

  const readOnly = detail ? detail.status === "aceite" || detail.status === "cancelado" || detail.status === "recusado" : false;
  const filledCount = useMemo(() => (detail ? detail.lines.filter((l) => prices[l.id]?.trim()).length : 0), [detail, prices]);
  const totalCount = detail?.lines.length ?? 0;
  const progressPct = totalCount ? Math.round((filledCount / totalCount) * 100) : 0;

  async function handleSubmit() {
    if (!detail) return;
    const lines = detail.lines
      .filter((l) => prices[l.id]?.trim())
      .map((l) => ({ id: l.id, unitCost: Number(prices[l.id]), notes: notes[l.id]?.trim() || undefined }));
    if (lines.length !== detail.lines.length) {
      setError("Preencha o preço de todos os itens antes de enviar");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await supplierPortalApi.respond(detail.id, { supplierNotes: supplierNotes.trim() || undefined, lines });
      setDone(true);
      toast.success("Cotação enviada com sucesso.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro ao enviar resposta";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <AppShell accountName={account?.name ?? "…"}>
        <main className="portal-main">
          <div className="skeleton" style={{ height: "5rem", borderRadius: "1rem" }} />
          <div className="skeleton" style={{ height: "18rem" }} />
        </main>
      </AppShell>
    );
  }
  if (!detail) {
    return (
      <AppShell accountName={account?.name ?? "…"}>
        <div className="centered-screen text-error">{error ?? "Pedido não encontrado"}</div>
      </AppShell>
    );
  }

  return (
    <AppShell accountName={account?.name ?? detail.companyName} pendingCount={detail.status === "enviado" ? 1 : 0}>
      <main className="portal-main">
        <section className="hero-panel fade-up">
          <div className="hero-panel-content">
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center", marginBottom: "0.65rem" }}>
              <Link to="/painel" className="badge" style={{ background: "rgba(255,255,255,0.14)", color: "#fff", textDecoration: "none" }}>
                ← Painel
              </Link>
              <span className={`badge ${detail.status === "enviado" ? "badge-brand" : detail.status === "aceite" ? "badge-success" : "badge-neutral"}`}>
                {STATUS_LABELS[detail.status] ?? detail.status}
              </span>
            </div>
            <p className="hero-eyebrow">{detail.companyName}{detail.projectName ? ` · ${detail.projectName}` : ""}</p>
            <h1 className="hero-title">{detail.title}</h1>
            {detail.message && <p className="hero-subtitle">{detail.message}</p>}
            {detail.deadlineDate && (
              <p className="hero-subtitle" style={{ marginTop: "0.25rem" }}>Prazo de resposta: {new Date(detail.deadlineDate).toLocaleDateString("pt-PT")}</p>
            )}
            {(detail.buyerName || detail.companyPhone) && (
              <div style={{ marginTop: "1rem", display: "flex", flexWrap: "wrap", gap: "0.6rem", alignItems: "center" }}>
                <span style={{ fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(255,255,255,0.6)" }}>Contacto de compras</span>
                {detail.buyerName && <span className="badge" style={{ background: "rgba(255,255,255,0.14)", color: "#fff" }}>{detail.buyerName}</span>}
                {detail.buyerEmail && (
                  <a href={`mailto:${detail.buyerEmail}`} className="badge" style={{ background: "rgba(255,255,255,0.14)", color: "#fff", textDecoration: "none" }}>{detail.buyerEmail}</a>
                )}
                {detail.companyPhone && (
                  <a href={`tel:${detail.companyPhone}`} className="badge" style={{ background: "var(--orange)", color: "#fff", textDecoration: "none", fontWeight: 700 }}>Ligar: {detail.companyPhone}</a>
                )}
              </div>
            )}
          </div>
        </section>

        {done ? (
          <div className="card card-pad fade-up" style={{ textAlign: "center" }}>
            <span className="empty-state-icon" style={{ margin: "0 auto", background: "#ecfdf3", color: "#15803d" }}><IconCheck size={22} /></span>
            <p style={{ fontWeight: 700, fontFamily: "var(--font-display)", marginTop: "0.75rem" }}>Resposta enviada com sucesso.</p>
            <p className="text-muted-sm" style={{ marginTop: "0.25rem" }}>A empresa foi notificada e vai rever a sua cotação.</p>
            <Link to="/painel" className="btn btn-primary" style={{ marginTop: "1rem", display: "inline-flex" }}>Voltar ao painel</Link>
          </div>
        ) : (
          <div className="card fade-up delay-1">
            <div className="card-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>
              <div>
                <h2>Itens pedidos</h2>
                <p>Indique o seu preço unitário para cada item.</p>
              </div>
              {!readOnly && totalCount > 0 && (
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <span className="text-muted-sm">{filledCount}/{totalCount} preenchidos</span>
                  <div className="pipeline-bar" style={{ width: "7rem", marginTop: "0.3rem" }}>
                    <div className="pipeline-seg" style={{ width: `${progressPct}%`, background: progressPct === 100 ? "#22c55e" : "var(--teal)" }} />
                  </div>
                </div>
              )}
            </div>
            {error && <p className="text-error" style={{ padding: "0.75rem 1.25rem 0" }}>{error}</p>}
            <div className="stagger">
              {detail.lines.map((line) => {
                const isFilled = Boolean(prices[line.id]?.trim());
                return (
                  <div key={line.id} style={{ display: "grid", gap: "0.6rem", padding: "0.9rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", minWidth: 0 }}>
                        <span
                          style={{
                            width: "1.4rem",
                            height: "1.4rem",
                            borderRadius: "999px",
                            display: "grid",
                            placeItems: "center",
                            flexShrink: 0,
                            background: isFilled ? "#dcfce7" : "#f1f5f9",
                            color: isFilled ? "#15803d" : "var(--ink-400)",
                          }}
                        >
                          {isFilled ? <IconCheck size={12} /> : <IconClipboard size={11} />}
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <p style={{ margin: 0, fontWeight: 600 }}>{line.description}</p>
                          <p className="text-muted-sm">{line.quantity ?? "—"} {line.unit}</p>
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          disabled={readOnly}
                          value={prices[line.id] ?? ""}
                          onChange={(e) => setPrices((prev) => ({ ...prev, [line.id]: e.target.value }))}
                          className="input"
                          style={{ width: "8rem", textAlign: "right" }}
                          placeholder="Preço"
                        />
                        <span className="text-muted-sm">{line.currency}</span>
                      </div>
                    </div>
                    <input
                      disabled={readOnly}
                      value={notes[line.id] ?? ""}
                      onChange={(e) => setNotes((prev) => ({ ...prev, [line.id]: e.target.value }))}
                      className="input"
                      placeholder="Nota sobre este item (opcional)"
                      style={{ marginLeft: "2rem" }}
                    />
                  </div>
                );
              })}
            </div>
            <div style={{ padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
              <label className="label">Mensagem geral (opcional)</label>
              <textarea disabled={readOnly} value={supplierNotes} onChange={(e) => setSupplierNotes(e.target.value)} className="input" rows={3} />
            </div>
            {!readOnly && (
              <div style={{ display: "flex", justifyContent: "flex-end", padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
                <button onClick={handleSubmit} disabled={saving} className="btn btn-primary">{saving ? "A enviar..." : "Enviar cotação"}</button>
              </div>
            )}
            {readOnly && <p className="text-muted-sm" style={{ padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>Este pedido já não pode ser respondido.</p>}
          </div>
        )}
      </main>
    </AppShell>
  );
}

import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../api/http";
import { supplierPortalApi, supplierPortalAuthApi, type SupplierQuoteRequestDetail } from "../api/supplierPortal";

export default function SupplierQuoteRequestPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
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
    supplierPortalAuthApi
      .me()
      .then(() => supplierPortalApi.quoteRequest(id))
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
  }, [id, navigate]);

  const readOnly = detail ? detail.status === "aceite" || detail.status === "cancelado" || detail.status === "recusado" : false;

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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao enviar resposta");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="centered-screen text-muted-sm">A carregar...</div>;
  if (!detail) return <div className="centered-screen text-error">{error ?? "Pedido não encontrado"}</div>;

  return (
    <div className="portal-shell">
      <header className="portal-header">
        <div className="portal-header-inner">
          <Link to="/painel" className="link-muted" style={{ fontSize: "0.85rem" }}>
            ← Voltar ao painel
          </Link>
          <span className={`badge ${detail.status === "enviado" ? "badge-brand" : detail.status === "aceite" ? "badge-success" : "badge-neutral"}`}>
            {detail.status}
          </span>
        </div>
      </header>

      <main className="portal-main">
        <div className="card card-pad">
          <p className="portal-eyebrow">{detail.companyName}{detail.projectName ? ` · ${detail.projectName}` : ""}</p>
          <h1 className="portal-title">{detail.title}</h1>
          {detail.message && <p className="text-muted-sm" style={{ marginTop: "0.5rem" }}>{detail.message}</p>}
          {detail.deadlineDate && <p className="text-muted-sm" style={{ marginTop: "0.5rem" }}>Prazo de resposta: {new Date(detail.deadlineDate).toLocaleDateString("pt-PT")}</p>}
        </div>

        {done ? (
          <div className="card card-pad" style={{ textAlign: "center" }}>
            <p style={{ fontWeight: 600 }}>Resposta enviada com sucesso.</p>
            <p className="text-muted-sm" style={{ marginTop: "0.25rem" }}>A empresa foi notificada e vai rever a sua cotação.</p>
            <Link to="/painel" className="btn btn-primary" style={{ marginTop: "1rem", display: "inline-flex" }}>Voltar ao painel</Link>
          </div>
        ) : (
          <div className="card">
            <div className="card-header">
              <h2>Itens pedidos</h2>
              <p>Indique o seu preço unitário para cada item.</p>
            </div>
            {error && <p className="text-error" style={{ padding: "0.75rem 1.25rem 0" }}>{error}</p>}
            <div>
              {detail.lines.map((line) => (
                <div key={line.id} style={{ display: "grid", gap: "0.5rem", padding: "0.75rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
                    <div>
                      <p style={{ margin: 0, fontWeight: 500 }}>{line.description}</p>
                      <p className="text-muted-sm">{line.quantity ?? "—"} {line.unit}</p>
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
                  />
                </div>
              ))}
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
    </div>
  );
}

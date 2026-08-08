import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { supplierPortalAuthApi, type SupplierAccount } from "../api/supplierPortal";
import { supplierProcurementApi, type SupplierProcurementOpportunityDetail } from "../api/procurement";

type LineDraft = { rfqLineId: string; available: boolean; quantityOffered: string; unitCost: string; discountPct: string; brand: string; leadTimeDays: string; notes: string };

function money(value: number, currency: string) {
  return new Intl.NumberFormat("pt-MZ", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}

export default function SupplierProcurementQuotePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [account, setAccount] = useState<SupplierAccount | null>(null);
  const [data, setData] = useState<SupplierProcurementOpportunityDetail | null>(null);
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [leadTime, setLeadTime] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [transportIncluded, setTransportIncluded] = useState(true);
  const [transportCost, setTransportCost] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!id) return;
    try {
      const [me, detail] = await Promise.all([supplierPortalAuthApi.me(), supplierProcurementApi.opportunity(id)]);
      setAccount(me); setData(detail);
      setLines(detail.lines.map((line) => ({ rfqLineId: line.id, available: true, quantityOffered: line.quantity, unitCost: "", discountPct: "0", brand: "", leadTimeDays: "", notes: "" })));
    } catch { navigate("/login", { replace: true }); }
  }
  useEffect(() => { void load(); }, [id]);

  const subtotal = useMemo(() => lines.reduce((sum, line) => {
    if (!line.available) return sum;
    const q = Number(line.quantityOffered || 0); const p = Number(line.unitCost || 0); const d = Math.min(100, Math.max(0, Number(line.discountPct || 0)));
    return sum + q * p * (1 - d / 100);
  }, 0), [lines]);
  const total = subtotal + (transportIncluded ? 0 : Number(transportCost || 0));

  async function submit() {
    if (!id || !data) return;
    setSaving(true); setError(null);
    try {
      await supplierProcurementApi.submitQuote(id, {
        validUntil: validUntil || null,
        leadTimeDays: leadTime ? Number(leadTime) : null,
        paymentTerms: paymentTerms || undefined,
        transportIncluded,
        transportCost: transportIncluded ? 0 : Number(transportCost || 0),
        supplierNotes: notes || undefined,
        lines: lines.map((line) => ({
          rfqLineId: line.rfqLineId,
          available: line.available,
          quantityOffered: line.available ? Number(line.quantityOffered || 0) : 0,
          unitCost: line.available ? Number(line.unitCost || 0) : 0,
          discountPct: Number(line.discountPct || 0),
          brand: line.brand || undefined,
          leadTimeDays: line.leadTimeDays ? Number(line.leadTimeDays) : null,
          notes: line.notes || undefined,
        })),
      });
      await load();
      setError("Proposta submetida com sucesso. Uma nova submissão criará uma nova versão e preservará esta no histórico.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível submeter a proposta"); }
    finally { setSaving(false); }
  }

  if (!account || !data) return <div className="portal-main">A carregar...</div>;
  const editable = data.status === "aberta";

  return (
    <AppShell accountName={account.name} pendingCount={0}>
      <main className="portal-main">
        <Link className="badge" to="/oportunidades">← Oportunidades</Link>
        <section className="hero-panel fade-up"><div className="hero-panel-content"><p className="hero-eyebrow">{data.reference}</p><h1 className="hero-title">{data.title}</h1><p className="hero-subtitle">{data.companyName} · {data.projectName}</p>{data.deliveryLocation && <p className="hero-meta">Entrega: {data.deliveryLocation}</p>}</div></section>
        {error && <div className="text-error">{error}</div>}
        <section className="card">
          <div className="card-header"><div><h2>Itens a cotar</h2><p>{data.allowPartialQuotes ? "Proposta parcial permitida" : "Todos os itens devem ser cotados integralmente"}</p></div></div>
          <div className="stagger">
            {data.lines.map((item, index) => {
              const line = lines[index]; if (!line) return null;
              return <div key={item.id} className="card card-pad"><div className="rich-row-main"><div><strong>{item.description}</strong><span>{Number(item.quantity).toLocaleString("pt-MZ")} {item.unit}</span></div>{data.allowPartialQuotes && <label><input type="checkbox" checked={line.available} onChange={(e) => setLines((cur) => cur.map((x, i) => i === index ? { ...x, available: e.target.checked } : x))} /> Disponível</label>}</div>{item.specification && <p className="text-muted-sm">{item.specification}</p>}{line.available && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.85rem", marginTop: "0.85rem" }}><label><span>Qtd. disponível</span><input className="input" type="number" step="0.001" value={line.quantityOffered} onChange={(e) => setLines((cur) => cur.map((x, i) => i === index ? { ...x, quantityOffered: e.target.value } : x))} /></label><label><span>Preço unit. s/ IVA ({data.currency})</span><input className="input" type="number" step="0.01" value={line.unitCost} onChange={(e) => setLines((cur) => cur.map((x, i) => i === index ? { ...x, unitCost: e.target.value } : x))} /></label><label><span>Desconto %</span><input className="input" type="number" min="0" max="100" step="0.1" value={line.discountPct} onChange={(e) => setLines((cur) => cur.map((x, i) => i === index ? { ...x, discountPct: e.target.value } : x))} /></label><label><span>Marca / referência</span><input className="input" value={line.brand} onChange={(e) => setLines((cur) => cur.map((x, i) => i === index ? { ...x, brand: e.target.value } : x))} /></label></div>}</div>;
            })}
          </div>
        </section>
        <section className="card" style={{ padding: "1.25rem" }}><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.85rem", marginTop: "0.85rem" }}><label><span>Prazo de entrega (dias)</span><input className="input" type="number" min="0" value={leadTime} onChange={(e) => setLeadTime(e.target.value)} /></label><label><span>Validade da proposta</span><input className="input" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></label><label><span>Condições de pagamento</span><input className="input" value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="Ex.: 30 dias" /></label><label><span>Transporte</span><select className="input" value={transportIncluded ? "incluido" : "separado"} onChange={(e) => setTransportIncluded(e.target.value === "incluido")}><option value="incluido">Incluído no preço</option><option value="separado">Cobrado à parte</option></select></label>{!transportIncluded && <label><span>Custo de transporte s/ IVA</span><input className="input" type="number" min="0" step="0.01" value={transportCost} onChange={(e) => setTransportCost(e.target.value)} /></label>}</div><label style={{ display: "block", marginTop: "1rem" }}><span>Observações comerciais</span><textarea className="input" style={{ minHeight: "6rem" }} value={notes} onChange={(e) => setNotes(e.target.value)} /></label><div style={{ marginTop: "1rem", padding: "1rem", borderRadius: "0.9rem", background: "var(--surface-soft, #f8fafc)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}><span>Total proposto s/ IVA</span><strong>{money(total, data.currency)}</strong></div><div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem" }}><button className="btn btn-primary" disabled={!editable || saving} onClick={submit}>{data.quoteVersions.length ? "Submeter nova versão" : "Submeter proposta"}</button></div>{data.quoteVersions.length > 0 && <p className="text-muted-sm" style={{ marginTop: ".75rem" }}>Histórico: {data.quoteVersions.map((q) => `v${q.version} ${q.status}`).join(" · ")}</p>}</section>
      </main>
    </AppShell>
  );
}

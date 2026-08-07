import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { useToast } from "../components/Toast";
import { IconMapPin, IconUser } from "../components/icons";
import {
  marketplaceApi,
  publicApi,
  supplierPortalAuthApi,
  type MarketplaceProfile,
  type PriceZone,
  type SupplierAccount,
} from "../api/supplierPortal";

export default function SupplierProfilePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [account, setAccount] = useState<SupplierAccount | null>(null);
  const [profile, setProfile] = useState<MarketplaceProfile | null>(null);
  const [zones, setZones] = useState<PriceZone[]>([]);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [nuit, setNuit] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Perfil — Portal do Fornecedor SIGO";
    Promise.all([supplierPortalAuthApi.me(), marketplaceApi.profile(), publicApi.zones()])
      .then(([me, p, z]) => {
        setAccount(me);
        setProfile(p);
        setZones(z);
        setName(p.name);
        setContact(p.contact ?? me.phone ?? "");
        setNuit(p.nuit ?? "");
        setZoneId(p.zoneId ?? "");
      })
      .catch(() => navigate("/login", { replace: true }))
      .finally(() => setLoading(false));
    return () => {
      document.title = "Portal do Fornecedor — SIGO";
    };
  }, [navigate]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!zoneId) {
      setError("Indique a zona em que opera.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await marketplaceApi.updateProfile({
        name: name.trim(),
        contact: contact.trim() || undefined,
        nuit: nuit.trim() || undefined,
        zoneId,
      });
      const refreshed = await marketplaceApi.profile().catch(() => null);
      setProfile(refreshed ?? { ...profile!, ...updated, location: zones.find((z) => z.id === zoneId)?.name ?? profile?.location ?? null });
      toast.success("Perfil actualizado.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível guardar");
    } finally {
      setSaving(false);
    }
  }

  async function handleLogoutOthers() {
    setLogoutBusy(true);
    try {
      await supplierPortalAuthApi.logoutOthers();
      toast.success("Sessões noutros dispositivos terminadas.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível terminar as outras sessões");
    } finally {
      setLogoutBusy(false);
    }
  }

  if (loading || !account) {
    return (
      <AppShell accountName={account?.name ?? "…"}>
        <main className="portal-main">
          <div className="skeleton" style={{ height: "8rem", borderRadius: "1.25rem" }} />
          <div className="skeleton" style={{ height: "16rem" }} />
        </main>
      </AppShell>
    );
  }

  const offerTags = [
    profile?.offersMaterials ? "Materiais" : null,
    profile?.offersLabour ? "Mão-de-obra" : null,
    profile?.offersEquipment ? "Máquinas" : null,
  ].filter(Boolean);

  return (
    <AppShell accountName={account.name}>
      <main className="portal-main">
        <section className="hero-panel fade-up">
          <div className="hero-panel-content">
            <p className="hero-eyebrow">Conta e marketplace</p>
            <h1 className="hero-title">O seu perfil</h1>
            <p className="hero-subtitle">
              Estes dados aparecem às empresas de construção quando pesquisam fornecedores na sua zona.
            </p>
          </div>
        </section>

        <div className="profile-grid fade-up delay-1">
          <section className="card card-pad">
            <div className="card-inline-title">
              <span className="stat-tile-icon tone-teal"><IconUser size={17} /></span>
              <div>
                <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: "0.95rem", fontWeight: 700 }}>Ficha no marketplace</h2>
                <p className="text-muted-sm" style={{ margin: "0.15rem 0 0" }}>Nome comercial, contacto e zona de operação</p>
              </div>
            </div>

            <form onSubmit={handleSave} className="form-stack" style={{ marginTop: "1.25rem" }}>
              {error && <p className="text-error">{error}</p>}
              <div>
                <label className="label">Nome comercial</label>
                <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <label className="label">Contacto (telefone ou e-mail público)</label>
                <input className="input" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Ex.: +258 84…" />
              </div>
              <div>
                <label className="label">NUIT (opcional)</label>
                <input className="input" value={nuit} onChange={(e) => setNuit(e.target.value)} />
              </div>
              <div>
                <label className="label">Zona em que opera</label>
                <select className="input" required value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
                  <option value="">Escolher zona…</option>
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name}{z.province ? ` · ${z.province}` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? "A guardar…" : "Guardar perfil"}
              </button>
            </form>
          </section>

          <div className="profile-side">
            <section className="card card-pad">
              <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: "0.95rem", fontWeight: 700 }}>Conta de acesso</h2>
              <dl className="detail-list">
                <div>
                  <dt>Nome</dt>
                  <dd>{account.name}</dd>
                </div>
                <div>
                  <dt>E-mail</dt>
                  <dd>{account.email}</dd>
                </div>
                <div>
                  <dt>Telefone</dt>
                  <dd>{account.phone ?? "—"}</dd>
                </div>
              </dl>
              <button type="button" className="btn btn-secondary" style={{ width: "100%", marginTop: "1rem" }} disabled={logoutBusy} onClick={handleLogoutOthers}>
                {logoutBusy ? "A terminar…" : "Terminar sessões noutros dispositivos"}
              </button>
              <p className="text-muted-sm" style={{ marginTop: "0.55rem" }}>
                Mantém apenas esta sessão activa — útil se partilhou o login noutro telemóvel.
              </p>
            </section>

            <section className="card card-pad">
              <div className="card-inline-title">
                <span className="stat-tile-icon tone-orange"><IconMapPin size={17} /></span>
                <div>
                  <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: "0.95rem", fontWeight: 700 }}>Resumo público</h2>
                  <p className="text-muted-sm" style={{ margin: "0.15rem 0 0" }}>Como as empresas o vêem</p>
                </div>
              </div>
              <p style={{ margin: "1rem 0 0.35rem", fontWeight: 700 }}>{profile?.name ?? name}</p>
              <p className="text-muted-sm">{profile?.location ?? "Zona por definir"}</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.75rem" }}>
                {offerTags.length ? (
                  offerTags.map((tag) => (
                    <span key={tag} className="badge badge-neutral">{tag}</span>
                  ))
                ) : (
                  <span className="badge badge-brand">Defina o que vende em «O que vendo»</span>
                )}
              </div>
            </section>
          </div>
        </div>
      </main>
    </AppShell>
  );
}

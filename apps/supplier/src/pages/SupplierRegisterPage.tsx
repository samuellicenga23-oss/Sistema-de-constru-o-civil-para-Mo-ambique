import { useEffect, useId, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthLayout } from "../components/AuthLayout";
import { OfferSetupForm, type OfferDraft } from "../components/OfferSetupForm";
import { publicApi, supplierPortalAuthApi, type MarketplaceCatalog, type PriceZone } from "../api/supplierPortal";

export default function SupplierRegisterPage() {
  const navigate = useNavigate();
  const nameId = useId();
  const emailId = useId();
  const passwordId = useId();
  const phoneId = useId();
  const nuitId = useId();
  const zoneId2 = useId();

  const [step, setStep] = useState<1 | 2>(1);
  const [zones, setZones] = useState<PriceZone[]>([]);
  const [catalog, setCatalog] = useState<MarketplaceCatalog | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [nuit, setNuit] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [offer, setOffer] = useState<OfferDraft>({
    offersMaterials: true,
    offersLabour: false,
    offersEquipment: false,
    materialIds: [],
    labourCategoryIds: [],
    equipmentIds: [],
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    document.title = "Registar fornecedor — SIGO Fornecedores";
    Promise.all([publicApi.zones(), publicApi.marketplaceCatalog()])
      .then(([zoneRows, cat]) => {
        setZones(zoneRows);
        if (zoneRows.length) setZoneId(zoneRows[0].id);
        setCatalog(cat);
      })
      .catch(() => {});
    return () => {
      document.title = "Portal do Fornecedor — SIGO";
    };
  }, []);

  function goNext(e: FormEvent) {
    e.preventDefault();
    if (!zoneId) {
      setError("Indique a zona onde opera");
      return;
    }
    setError(null);
    setStep(2);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    if (!(offer.offersMaterials || offer.offersLabour || offer.offersEquipment)) {
      setError("Seleccione pelo menos um tipo: materiais, mão-de-obra ou máquinas.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await supplierPortalAuthApi.register({
        name: name.trim(),
        email: email.trim(),
        password,
        phone: phone.trim() || undefined,
        nuit: nuit.trim() || undefined,
        zoneId,
        offersMaterials: offer.offersMaterials,
        offersLabour: offer.offersLabour,
        offersEquipment: offer.offersEquipment,
        materialIds: offer.materialIds,
        labourCategoryIds: offer.labourCategoryIds,
        equipmentIds: offer.equipmentIds,
      });
      navigate("/precos", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao registar");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      eyebrow="SIGO Fornecedores"
      footer={
        <p>
          Já tem conta?{" "}
          <Link to="/login" className="link-strong">
            Entrar
          </Link>
        </p>
      }
    >
      {step === 1 ? (
        <form onSubmit={goNext} noValidate className="auth-card">
          <div className="auth-card-intro">
            <h1 className="auth-title">Registe a sua empresa</h1>
            <p className="auth-subtitle">Passo 1 de 2 — dados da conta. A seguir escolhe o que vende, para o painel não encher com produtos que não trabalha.</p>
          </div>
          <div className="field-stack">
            <div>
              <label className="field-label" htmlFor={nameId}>
                Nome da empresa/fornecedor
              </label>
              <input id={nameId} required value={name} onChange={(e) => setName(e.target.value)} className="field-input" placeholder="Ex: Cimentos do Sul Lda" autoFocus />
            </div>
            <div>
              <label className="field-label" htmlFor={emailId}>
                Email
              </label>
              <input id={emailId} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="field-input" placeholder="nome@fornecedor.co.mz" autoComplete="username" />
            </div>
            <div>
              <label className="field-label" htmlFor={passwordId}>
                Palavra-passe
              </label>
              <input id={passwordId} type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="field-input" placeholder="Mínimo 8 caracteres" autoComplete="new-password" />
            </div>
            <div>
              <label className="field-label" htmlFor={zoneId2}>
                Zona onde opera
              </label>
              <select id={zoneId2} required value={zoneId} onChange={(e) => setZoneId(e.target.value)} className="field-input">
                {zones.length === 0 && <option value="">A carregar zonas...</option>}
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor={phoneId}>
                Telefone (opcional)
              </label>
              <input id={phoneId} value={phone} onChange={(e) => setPhone(e.target.value)} className="field-input" placeholder="+258 8..." />
            </div>
            <div>
              <label className="field-label" htmlFor={nuitId}>
                NUIT (opcional)
              </label>
              <input id={nuitId} value={nuit} onChange={(e) => setNuit(e.target.value)} className="field-input" />
            </div>
          </div>
          <div className="auth-alert-slot">{error && <div className="auth-alert">{error}</div>}</div>
          <button type="submit" className="btn-login">
            Continuar — o que vendo
          </button>
        </form>
      ) : (
        <form onSubmit={handleSubmit} noValidate aria-busy={loading} className="auth-card" style={{ maxWidth: "36rem" }}>
          <div className="auth-card-intro">
            <h1 className="auth-title">O que vende?</h1>
            <p className="auth-subtitle">
              Passo 2 de 2 — escolha os tipos e os produtos. Se o item não estiver na lista SIGO, pode cadastrá-lo depois de criar a conta em «O que
              vendo».
            </p>
          </div>
          {catalog ? (
            <OfferSetupForm catalog={catalog} value={offer} onChange={setOffer} />
          ) : (
            <p>A carregar catálogo…</p>
          )}
          <p style={{ fontSize: "0.8rem", color: "var(--ink-400)", margin: "0.75rem 0 0" }}>
            Não encontra o seu produto na lista? Complete o registo e, no portal, use «Cadastre um material/máquina novo no sistema».
          </p>
          <div className="auth-alert-slot">{error && <div className="auth-alert">{error}</div>}</div>
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
            <button type="button" className="btn btn-secondary" onClick={() => setStep(1)} disabled={loading}>
              Voltar
            </button>
            <button type="submit" className="btn-login" disabled={loading} style={{ flex: 1 }}>
              {loading ? "A registar..." : "Criar conta de fornecedor"}
            </button>
          </div>
        </form>
      )}
    </AuthLayout>
  );
}

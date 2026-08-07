import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../api/http";
import { AppShell } from "../components/AppShell";
import { OfferSetupForm, type OfferDraft } from "../components/OfferSetupForm";
import { useToast } from "../components/Toast";
import { marketplaceApi, supplierPortalAuthApi, type MarketplaceCatalog, type SupplierAccount } from "../api/supplierPortal";

export default function SupplierOfferingsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [account, setAccount] = useState<SupplierAccount | null>(null);
  const [catalog, setCatalog] = useState<MarketplaceCatalog | null>(null);
  const [offer, setOffer] = useState<OfferDraft>({
    offersMaterials: false,
    offersLabour: false,
    offersEquipment: false,
    materialIds: [],
    labourCategoryIds: [],
    equipmentIds: [],
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const [cat, profile] = await Promise.all([marketplaceApi.catalog(), marketplaceApi.profile()]);
    setCatalog(cat);
    setOffer({
      offersMaterials: profile.offersMaterials,
      offersLabour: profile.offersLabour,
      offersEquipment: profile.offersEquipment,
      materialIds: profile.materialIds ?? [],
      labourCategoryIds: profile.labourCategoryIds ?? [],
      equipmentIds: profile.equipmentIds ?? [],
    });
  }

  useEffect(() => {
    document.title = "O que vendo — Portal do Fornecedor SIGO";
    supplierPortalAuthApi
      .me()
      .then((me) => {
        setAccount(me);
        return reload();
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) navigate("/login", { replace: true });
        else setError(err instanceof Error ? err.message : "Erro ao carregar");
      })
      .finally(() => setLoading(false));
    return () => {
      document.title = "Portal do Fornecedor — SIGO";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave() {
    if (!(offer.offersMaterials || offer.offersLabour || offer.offersEquipment)) {
      setError("Seleccione pelo menos um tipo.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await marketplaceApi.updateOfferings(offer);
      toast.success("Oferta actualizada.");
      navigate("/precos");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao guardar");
    } finally {
      setSaving(false);
    }
  }

  async function afterCreate(kind: "material" | "labour" | "equipment", id: string) {
    await reload();
    if (kind === "material") setOffer((o) => ({ ...o, offersMaterials: true, materialIds: [...new Set([...o.materialIds, id])] }));
    if (kind === "labour") setOffer((o) => ({ ...o, offersLabour: true, labourCategoryIds: [...new Set([...o.labourCategoryIds, id])] }));
    if (kind === "equipment") setOffer((o) => ({ ...o, offersEquipment: true, equipmentIds: [...new Set([...o.equipmentIds, id])] }));
    toast.success("Produto cadastrado no sistema e adicionado à sua oferta.");
  }

  if (loading || !account || !catalog) {
    return (
      <AppShell accountName={account?.name ?? "…"}>
        <main className="portal-main">
          <div className="skeleton" style={{ height: "14rem" }} />
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell accountName={account.name}>
      <main className="portal-main">
        <section className="hero-panel fade-up">
          <div className="hero-panel-content">
            <p className="hero-eyebrow">A sua oferta</p>
            <h1 className="hero-title">O que vendo</h1>
            <p className="hero-subtitle">
              Escolha se vende materiais, fornece mão-de-obra ou aluga máquinas, e seleccione só os produtos da lista. O resto não aparece em Meus
              preços. Se faltar um item, cadastre-o no sistema.
            </p>
          </div>
        </section>

        {error && <p className="text-error">{error}</p>}

        <section className="card fade-up delay-1" style={{ padding: "1.25rem" }}>
          <OfferSetupForm
            catalog={catalog}
            value={offer}
            onChange={setOffer}
            creating={creating}
            onCreateMaterial={async (data) => {
              setCreating(true);
              try {
                const row = await marketplaceApi.createMaterial(data);
                await afterCreate("material", row.id);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Erro ao criar material");
                throw err;
              } finally {
                setCreating(false);
              }
            }}
            onCreateLabour={async (data) => {
              setCreating(true);
              try {
                const row = await marketplaceApi.createLabour(data);
                await afterCreate("labour", row.id);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Erro ao criar mão-de-obra");
                throw err;
              } finally {
                setCreating(false);
              }
            }}
            onCreateEquipment={async (data) => {
              setCreating(true);
              try {
                const row = await marketplaceApi.createEquipment(data);
                await afterCreate("equipment", row.id);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Erro ao criar máquina");
                throw err;
              } finally {
                setCreating(false);
              }
            }}
          />
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "1.25rem" }}>
            <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void handleSave()}>
              {saving ? "A guardar…" : "Guardar oferta"}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => navigate("/precos")}>
              Ir para Meus preços
            </button>
          </div>
        </section>
      </main>
    </AppShell>
  );
}

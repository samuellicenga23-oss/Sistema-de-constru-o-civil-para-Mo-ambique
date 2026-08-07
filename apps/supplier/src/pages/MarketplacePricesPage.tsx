import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../api/http";
import { AppShell } from "../components/AppShell";
import { useToast } from "../components/Toast";
import { IconSearch, IconTag, IconTrash, IconPlus } from "../components/icons";
import {
  marketplaceApi,
  supplierPortalAuthApi,
  type MarketplaceCatalog,
  type MarketplaceMaterialPrice,
  type MarketplaceLabourPrice,
  type MarketplaceEquipmentPrice,
  type SupplierAccount,
} from "../api/supplierPortal";

type Tab = "materiais" | "mao-de-obra" | "maquinas";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "materiais", label: "Materiais" },
  { id: "mao-de-obra", label: "Mão-de-obra" },
  { id: "maquinas", label: "Máquinas" },
];

export default function MarketplacePricesPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [account, setAccount] = useState<SupplierAccount | null>(null);
  const [tab, setTab] = useState<Tab>("materiais");
  const [catalog, setCatalog] = useState<MarketplaceCatalog | null>(null);
  const [materialPrices, setMaterialPrices] = useState<MarketplaceMaterialPrice[]>([]);
  const [labourPrices, setLabourPrices] = useState<MarketplaceLabourPrice[]>([]);
  const [equipmentPrices, setEquipmentPrices] = useState<MarketplaceEquipmentPrice[]>([]);
  const [resourceId, setResourceId] = useState("");
  const [cost, setCost] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const [cat, mats, labs, eqs] = await Promise.all([
      marketplaceApi.catalog(),
      marketplaceApi.listMaterials(),
      marketplaceApi.listLabour(),
      marketplaceApi.listEquipment(),
    ]);
    setCatalog(cat);
    setMaterialPrices(mats);
    setLabourPrices(labs);
    setEquipmentPrices(eqs);
  }

  useEffect(() => {
    document.title = "Meus preços — Portal do Fornecedor SIGO";
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

  const options = useMemo(() => {
    if (!catalog) return [];
    const source = tab === "materiais" ? catalog.materials : tab === "mao-de-obra" ? catalog.labourCategories : catalog.equipment;
    const needle = query.trim().toLocaleLowerCase("pt");
    return needle ? source.filter((o) => o.name.toLocaleLowerCase("pt").includes(needle)) : source;
  }, [catalog, tab, query]);

  const activeList = tab === "materiais" ? materialPrices : tab === "mao-de-obra" ? labourPrices : equipmentPrices;
  const filteredActiveList = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("pt");
    if (!needle) return activeList;
    return (activeList as Array<{ materialName?: string; labourName?: string; equipmentName?: string }>).filter((p) =>
      (p.materialName ?? p.labourName ?? p.equipmentName ?? "").toLocaleLowerCase("pt").includes(needle),
    );
  }, [activeList, query]);

  async function handleAdd() {
    const c = Number(cost);
    if (!resourceId || !(c >= 0)) return;
    setError(null);
    setSaving(true);
    try {
      if (tab === "materiais") await marketplaceApi.setMaterial({ materialId: resourceId, unitCost: c });
      else if (tab === "mao-de-obra") await marketplaceApi.setLabour({ labourCategoryId: resourceId, hourlyCost: c });
      else await marketplaceApi.setEquipment({ equipmentId: resourceId, hourlyCost: c });
      const resourceName = options.find((o) => o.id === resourceId)?.name ?? "Preço";
      setCost("");
      setResourceId("");
      await reload();
      toast.success(`${resourceName} — preço guardado.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro ao guardar preço";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(kind: Tab, priceId: string) {
    setError(null);
    try {
      if (kind === "materiais") await marketplaceApi.deleteMaterial(priceId);
      else if (kind === "mao-de-obra") await marketplaceApi.deleteLabour(priceId);
      else await marketplaceApi.deleteEquipment(priceId);
      await reload();
      toast.success("Preço removido.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro ao remover preço";
      setError(message);
      toast.error(message);
    }
  }

  if (loading || !account) {
    return (
      <AppShell accountName={account?.name ?? "…"}>
        <main className="portal-main">
          <div className="skeleton" style={{ height: "7rem", borderRadius: "1.25rem" }} />
          <div className="skeleton" style={{ height: "16rem" }} />
        </main>
      </AppShell>
    );
  }

  const unitOf = (p: MarketplaceMaterialPrice) => p.unit;

  return (
    <AppShell accountName={account.name}>
      <main className="portal-main">
        <section className="hero-panel fade-up">
          <div className="hero-panel-content">
            <p className="hero-eyebrow">SIGO Fornecedores</p>
            <h1 className="hero-title">Meus preços</h1>
            <p className="hero-subtitle">
              Os preços que indicar aqui ficam visíveis a todas as empresas que usam o SIGO na sua zona — é o que elas veem antes de lhe
              pedirem uma cotação. Mantenha-os actualizados para receber mais pedidos.
            </p>
          </div>
        </section>

        {error && <p className="text-error">{error}</p>}

        <section className="card fade-up delay-1">
          <div style={{ display: "flex", gap: "0.5rem", padding: "1.1rem 1.25rem 0", flexWrap: "wrap" }}>
            {TABS.map((t) => {
              const count = t.id === "materiais" ? materialPrices.length : t.id === "mao-de-obra" ? labourPrices.length : equipmentPrices.length;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => { setTab(t.id); setResourceId(""); setQuery(""); }}
                  className={`btn btn-sm ${tab === t.id ? "btn-primary" : "btn-secondary"}`}
                >
                  {t.label} <span style={{ opacity: 0.75 }}>({count})</span>
                </button>
              );
            })}
            <div className="search-field" style={{ marginLeft: "auto", minWidth: "12rem", flex: 1 }}>
              <IconSearch size={15} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} className="input" placeholder="Pesquisar recurso…" />
            </div>
          </div>

          <div style={{ display: "grid", gap: "0.75rem", padding: "1.25rem", gridTemplateColumns: "1fr 8rem auto", alignItems: "end" }}>
            <div>
              <label className="label">{tab === "materiais" ? "Material" : tab === "mao-de-obra" ? "Categoria" : "Equipamento"}</label>
              <select value={resourceId} onChange={(e) => setResourceId(e.target.value)} className="input">
                <option value="">Seleccione...</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}{"unit" in o ? ` (${o.unit})` : ""}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Preço</label>
              <input type="number" min="0" step="any" value={cost} onChange={(e) => setCost(e.target.value)} className="input" placeholder="0.00" />
            </div>
            <button type="button" onClick={handleAdd} disabled={saving || !resourceId || !cost} className="btn btn-primary">
              <IconPlus size={14} /> {saving ? "A guardar..." : "Guardar"}
            </button>
          </div>

          <div className="stagger">
            {tab === "materiais" && filteredActiveList.map((p) => {
              const price = p as MarketplaceMaterialPrice;
              return (
                <div key={price.id} className="rich-row">
                  <span className="rich-row-avatar" style={{ background: "#effbfb", color: "var(--teal-700)" }}><IconTag size={16} /></span>
                  <div className="rich-row-body">
                    <p className="list-row-title">{price.materialName}</p>
                    <p className="list-row-sub">{unitOf(price)}</p>
                  </div>
                  <strong style={{ fontFamily: "var(--font-display)" }}>{Number(price.unitCost).toLocaleString("pt-PT", { minimumFractionDigits: 2 })} {price.currency}</strong>
                  <button type="button" onClick={() => handleRemove("materiais", price.id)} className="icon-btn-ghost" title="Remover">
                    <IconTrash size={14} />
                  </button>
                </div>
              );
            })}
            {tab === "mao-de-obra" && filteredActiveList.map((p) => {
              const price = p as MarketplaceLabourPrice;
              return (
                <div key={price.id} className="rich-row">
                  <span className="rich-row-avatar" style={{ background: "#fff1e8", color: "var(--orange-hover)" }}><IconTag size={16} /></span>
                  <p className="list-row-title rich-row-body">{price.labourName}</p>
                  <strong style={{ fontFamily: "var(--font-display)" }}>{Number(price.hourlyCost).toLocaleString("pt-PT", { minimumFractionDigits: 2 })} {price.currency}/h</strong>
                  <button type="button" onClick={() => handleRemove("mao-de-obra", price.id)} className="icon-btn-ghost" title="Remover">
                    <IconTrash size={14} />
                  </button>
                </div>
              );
            })}
            {tab === "maquinas" && filteredActiveList.map((p) => {
              const price = p as MarketplaceEquipmentPrice;
              return (
                <div key={price.id} className="rich-row">
                  <span className="rich-row-avatar" style={{ background: "#f1f5f9", color: "var(--ink-400)" }}><IconTag size={16} /></span>
                  <p className="list-row-title rich-row-body">{price.equipmentName}</p>
                  <strong style={{ fontFamily: "var(--font-display)" }}>{Number(price.hourlyCost).toLocaleString("pt-PT", { minimumFractionDigits: 2 })} {price.currency}/h</strong>
                  <button type="button" onClick={() => handleRemove("maquinas", price.id)} className="icon-btn-ghost" title="Remover">
                    <IconTrash size={14} />
                  </button>
                </div>
              );
            })}
            {filteredActiveList.length === 0 && (
              <div className="empty-state">
                <span className="empty-state-icon"><IconTag size={20} /></span>
                <h3>{query ? "Nenhum resultado" : "Sem preços aqui ainda"}</h3>
                <p>{query ? "Experimente outro termo de pesquisa." : "Escolha um item acima e indique o seu preço — é o primeiro passo para começar a receber pedidos."}</p>
              </div>
            )}
          </div>
        </section>
      </main>
    </AppShell>
  );
}

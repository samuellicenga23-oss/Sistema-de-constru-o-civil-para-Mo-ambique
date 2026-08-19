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

type MaterialOption = MarketplaceCatalog["materials"][number];

function groupKey(category: string | undefined | null) {
  const c = (category ?? "").trim();
  return c || "Outros";
}

function groupMaterialsByCategory<T extends { category?: string | null; name?: string; materialName?: string }>(items: T[]) {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = groupKey(item.category);
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "pt"))
    .map(([category, rows]) => ({
      category,
      rows: rows.slice().sort((x, y) => (x.materialName ?? x.name ?? "").localeCompare(y.materialName ?? y.name ?? "", "pt")),
    }));
}

export default function MarketplacePricesPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [account, setAccount] = useState<SupplierAccount | null>(null);
  const [tab, setTab] = useState<Tab>("materiais");
  const [offers, setOffers] = useState({ materials: true, labour: true, equipment: true });
  const [materialPrices, setMaterialPrices] = useState<MarketplaceMaterialPrice[]>([]);
  const [labourPrices, setLabourPrices] = useState<MarketplaceLabourPrice[]>([]);
  const [equipmentPrices, setEquipmentPrices] = useState<MarketplaceEquipmentPrice[]>([]);
  const [resourceId, setResourceId] = useState("");
  const [cost, setCost] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  async function reload() {
    const [profile, mats, labs, eqs] = await Promise.all([
      marketplaceApi.profile(),
      marketplaceApi.listMaterials(),
      marketplaceApi.listLabour(),
      marketplaceApi.listEquipment(),
    ]);
    if (profile.needsOfferSetup) {
      navigate("/oferta", { replace: true });
      return;
    }
    setOffers({
      materials: profile.offersMaterials,
      labour: profile.offersLabour,
      equipment: profile.offersEquipment,
    });
    setMaterialPrices(mats);
    setLabourPrices(labs);
    setEquipmentPrices(eqs);
    const firstTab: Tab = profile.offersMaterials ? "materiais" : profile.offersLabour ? "mao-de-obra" : "maquinas";
    setTab((current) => {
      if (current === "materiais" && !profile.offersMaterials) return firstTab;
      if (current === "mao-de-obra" && !profile.offersLabour) return firstTab;
      if (current === "maquinas" && !profile.offersEquipment) return firstTab;
      return current;
    });
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

  const materialOptionsGrouped = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("pt");
    const filtered = needle
      ? materialPrices.filter((o) => {
          const name = o.materialName.toLocaleLowerCase("pt");
          const spec = (o.specification ?? "").toLocaleLowerCase("pt");
          const cat = (o.category ?? "").toLocaleLowerCase("pt");
          return name.includes(needle) || spec.includes(needle) || cat.includes(needle);
        })
      : materialPrices;
    return groupMaterialsByCategory(
      filtered.map((p) => ({
        id: p.materialId,
        name: p.materialName,
        unit: p.unit,
        category: p.category,
        specification: p.specification,
        source: p.source,
      })),
    );
  }, [materialPrices, query]);

  const labourOptions = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("pt");
    const rows = labourPrices.map((p) => ({ id: p.labourCategoryId, name: p.labourName }));
    return needle ? rows.filter((o) => o.name.toLocaleLowerCase("pt").includes(needle)) : rows;
  }, [labourPrices, query]);

  const equipmentOptions = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("pt");
    const rows = equipmentPrices.map((p) => ({ id: p.equipmentId, name: p.equipmentName }));
    return needle ? rows.filter((o) => o.name.toLocaleLowerCase("pt").includes(needle)) : rows;
  }, [equipmentPrices, query]);

  const filteredMaterials = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("pt");
    if (!needle) return materialPrices;
    return materialPrices.filter((p) => {
      const label = p.materialName.toLocaleLowerCase("pt");
      const spec = (p.specification ?? "").toLocaleLowerCase("pt");
      const cat = (p.category ?? "").toLocaleLowerCase("pt");
      return label.includes(needle) || spec.includes(needle) || cat.includes(needle);
    });
  }, [materialPrices, query]);

  const materialGroups = useMemo(() => groupMaterialsByCategory(filteredMaterials), [filteredMaterials]);

  const filteredLabour = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("pt");
    if (!needle) return labourPrices;
    return labourPrices.filter((p) => p.labourName.toLocaleLowerCase("pt").includes(needle));
  }, [labourPrices, query]);

  const filteredEquipment = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("pt");
    if (!needle) return equipmentPrices;
    return equipmentPrices.filter((p) => p.equipmentName.toLocaleLowerCase("pt").includes(needle));
  }, [equipmentPrices, query]);

  const pricedCount = useMemo(() => {
    if (tab === "materiais") return materialPrices.filter((p) => p.unitCost != null).length;
    if (tab === "mao-de-obra") return labourPrices.filter((p) => p.hourlyCost != null).length;
    return equipmentPrices.filter((p) => p.hourlyCost != null).length;
  }, [tab, materialPrices, labourPrices, equipmentPrices]);

  const activeListLength =
    tab === "materiais" ? materialPrices.length : tab === "mao-de-obra" ? labourPrices.length : equipmentPrices.length;

  function selectRow(id: string, existingCost: string | null) {
    setResourceId(id);
    setCost(existingCost != null ? String(Number(existingCost)) : "");
  }

  function toggleGroup(category: string) {
    setCollapsedGroups((prev) => ({ ...prev, [category]: !prev[category] }));
  }

  async function handleAdd() {
    const c = Number(cost);
    if (!resourceId || !(c >= 0)) return;
    setError(null);
    setSaving(true);
    try {
      if (tab === "materiais") await marketplaceApi.setMaterial({ materialId: resourceId, unitCost: c });
      else if (tab === "mao-de-obra") await marketplaceApi.setLabour({ labourCategoryId: resourceId, hourlyCost: c });
      else await marketplaceApi.setEquipment({ equipmentId: resourceId, hourlyCost: c });
      const allOptions: Array<{ id: string; name: string }> =
        tab === "materiais"
          ? materialOptionsGrouped.flatMap((g) => g.rows.map((o: MaterialOption) => ({ id: o.id, name: o.name })))
          : tab === "mao-de-obra"
            ? labourOptions
            : equipmentOptions;
      const resourceName = allOptions.find((o) => o.id === resourceId)?.name ?? "Preço";
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

  async function handleRemove(kind: Tab, priceId: string | null) {
    if (!priceId) return;
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

  return (
    <AppShell accountName={account.name}>
      <main className="portal-main">
        <section className="hero-panel fade-up">
          <div className="hero-panel-content">
            <p className="hero-eyebrow">SIGO Fornecedores</p>
            <h1 className="hero-title">Catálogo e preços</h1>
            <p className="hero-subtitle">Preços públicos do que vende.</p>
            <p style={{ marginTop: "0.75rem" }}>
              <a href="/oferta" className="link-strong" onClick={(e) => { e.preventDefault(); navigate("/oferta"); }}>
                Escolher ou cadastrar o que vendo →
              </a>
            </p>
          </div>
        </section>

        {error && <p className="text-error">{error}</p>}

        <section className="card fade-up delay-1">
          <div style={{ display: "flex", gap: "0.5rem", padding: "1.1rem 1.25rem 0", flexWrap: "wrap" }}>
            {TABS.filter((t) =>
              t.id === "materiais" ? offers.materials : t.id === "mao-de-obra" ? offers.labour : offers.equipment,
            ).map((t) => {
              const total = t.id === "materiais" ? materialPrices.length : t.id === "mao-de-obra" ? labourPrices.length : equipmentPrices.length;
              const priced =
                t.id === "materiais"
                  ? materialPrices.filter((p) => p.unitCost != null).length
                  : t.id === "mao-de-obra"
                    ? labourPrices.filter((p) => p.hourlyCost != null).length
                    : equipmentPrices.filter((p) => p.hourlyCost != null).length;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setTab(t.id);
                    setResourceId("");
                    setQuery("");
                  }}
                  className={`btn btn-sm ${tab === t.id ? "btn-primary" : "btn-secondary"}`}
                >
                  {t.label}{" "}
                  <span style={{ opacity: 0.75 }}>
                    ({priced}/{total})
                  </span>
                </button>
              );
            })}
            <div className="search-field" style={{ marginLeft: "auto", minWidth: "12rem", flex: 1 }}>
              <IconSearch size={15} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} className="input" placeholder="Pesquisar grupo ou marca (Limak, 42.5)…" />
            </div>
          </div>

          <div style={{ display: "grid", gap: "0.75rem", padding: "1.25rem", gridTemplateColumns: "1fr 8rem auto", alignItems: "end" }}>
            <div>
              <label className="label">{tab === "materiais" ? "Material" : tab === "mao-de-obra" ? "Categoria" : "Equipamento"}</label>
              <select value={resourceId} onChange={(e) => setResourceId(e.target.value)} className="input">
                <option value="">Seleccione...</option>
                {tab === "materiais" &&
                  materialOptionsGrouped.map((group) => (
                    <optgroup key={group.category} label={group.category}>
                      {group.rows.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name} ({o.unit})
                        </option>
                      ))}
                    </optgroup>
                  ))}
                {tab === "mao-de-obra" &&
                  labourOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                {tab === "maquinas" &&
                  equipmentOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="label">Preço</label>
              <input type="number" min="0" step="any" value={cost} onChange={(e) => setCost(e.target.value)} className="input" placeholder="0.00" />
            </div>
            <button type="button" onClick={handleAdd} disabled={saving || !resourceId || cost === ""} className="btn btn-primary">
              <IconPlus size={14} /> {saving ? "A guardar..." : "Guardar"}
            </button>
          </div>

          <p style={{ padding: "0 1.25rem 0.5rem", margin: 0, fontSize: "0.8rem", color: "var(--ink-400)" }}>
            {pricedCount} com preço · {activeListLength - pricedCount} sem preço
            {tab === "materiais" ? ` · ${materialGroups.length} grupos` : ""}
          </p>

          <div className="stagger">
            {tab === "materiais" &&
              materialGroups.map((group) => {
                const collapsed = collapsedGroups[group.category];
                const pricedInGroup = group.rows.filter((r) => r.unitCost != null).length;
                return (
                  <div key={group.category} style={{ marginBottom: "0.75rem" }}>
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.category)}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        gap: "0.6rem",
                        padding: "0.65rem 1.25rem",
                        background: "transparent",
                        border: "none",
                        borderBottom: "1px solid var(--border, #e2e8f0)",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <span style={{ fontSize: "0.75rem", opacity: 0.7 }}>{collapsed ? "▸" : "▾"}</span>
                      <strong style={{ fontSize: "0.95rem" }}>{group.category}</strong>
                      <span style={{ fontSize: "0.78rem", color: "var(--ink-400)" }}>
                        {pricedInGroup}/{group.rows.length} com preço
                      </span>
                    </button>
                    {!collapsed &&
                      group.rows.map((price) => {
                        const unpriced = price.unitCost == null;
                        return (
                          <div
                            key={price.materialId}
                            className="rich-row"
                            role="button"
                            tabIndex={0}
                            onClick={() => selectRow(price.materialId, price.unitCost)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") selectRow(price.materialId, price.unitCost);
                            }}
                            style={{ cursor: "pointer", opacity: unpriced ? 0.92 : 1 }}
                          >
                            <span className="rich-row-avatar" style={{ background: "#effbfb", color: "var(--teal-700)" }}>
                              <IconTag size={16} />
                            </span>
                            <div className="rich-row-body">
                              <p className="list-row-title">
                                {price.materialName}
                              </p>
                              <p className="list-row-sub">
                                {price.unit}
                                {price.specification ? ` · ${price.specification}` : ""}
                              </p>
                            </div>
                            {unpriced ? (
                              <span style={{ color: "var(--orange-hover)", fontWeight: 600, fontSize: "0.85rem" }}>Sem preço</span>
                            ) : (
                              <strong style={{ fontFamily: "var(--font-display)" }}>
                                {Number(price.unitCost).toLocaleString("pt-PT", { minimumFractionDigits: 2 })} {price.currency}
                              </strong>
                            )}
                            {price.id ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleRemove("materiais", price.id);
                                }}
                                className="icon-btn-ghost"
                                title="Remover preço"
                              >
                                <IconTrash size={14} />
                              </button>
                            ) : (
                              <span style={{ width: "2rem" }} />
                            )}
                          </div>
                        );
                      })}
                  </div>
                );
              })}

            {tab === "mao-de-obra" &&
              filteredLabour.map((price) => {
                const unpriced = price.hourlyCost == null;
                return (
                  <div
                    key={price.labourCategoryId}
                    className="rich-row"
                    role="button"
                    tabIndex={0}
                    onClick={() => selectRow(price.labourCategoryId, price.hourlyCost)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") selectRow(price.labourCategoryId, price.hourlyCost);
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    <span className="rich-row-avatar" style={{ background: "#fff1e8", color: "var(--orange-hover)" }}>
                      <IconTag size={16} />
                    </span>
                    <p className="list-row-title rich-row-body">{price.labourName}</p>
                    {unpriced ? (
                      <span style={{ color: "var(--orange-hover)", fontWeight: 600, fontSize: "0.85rem" }}>Sem preço</span>
                    ) : (
                      <strong style={{ fontFamily: "var(--font-display)" }}>
                        {Number(price.hourlyCost).toLocaleString("pt-PT", { minimumFractionDigits: 2 })} {price.currency}/h
                      </strong>
                    )}
                    {price.id ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleRemove("mao-de-obra", price.id);
                        }}
                        className="icon-btn-ghost"
                        title="Remover"
                      >
                        <IconTrash size={14} />
                      </button>
                    ) : (
                      <span style={{ width: "2rem" }} />
                    )}
                  </div>
                );
              })}

            {tab === "maquinas" &&
              filteredEquipment.map((price) => {
                const unpriced = price.hourlyCost == null;
                return (
                  <div
                    key={price.equipmentId}
                    className="rich-row"
                    role="button"
                    tabIndex={0}
                    onClick={() => selectRow(price.equipmentId, price.hourlyCost)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") selectRow(price.equipmentId, price.hourlyCost);
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    <span className="rich-row-avatar" style={{ background: "#f1f5f9", color: "var(--ink-400)" }}>
                      <IconTag size={16} />
                    </span>
                    <p className="list-row-title rich-row-body">{price.equipmentName}</p>
                    {unpriced ? (
                      <span style={{ color: "var(--orange-hover)", fontWeight: 600, fontSize: "0.85rem" }}>Sem preço</span>
                    ) : (
                      <strong style={{ fontFamily: "var(--font-display)" }}>
                        {Number(price.hourlyCost).toLocaleString("pt-PT", { minimumFractionDigits: 2 })} {price.currency}/h
                      </strong>
                    )}
                    {price.id ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleRemove("maquinas", price.id);
                        }}
                        className="icon-btn-ghost"
                        title="Remover"
                      >
                        <IconTrash size={14} />
                      </button>
                    ) : (
                      <span style={{ width: "2rem" }} />
                    )}
                  </div>
                );
              })}

            {((tab === "materiais" && materialGroups.length === 0) ||
              (tab === "mao-de-obra" && filteredLabour.length === 0) ||
              (tab === "maquinas" && filteredEquipment.length === 0)) && (
              <div className="empty-state">
                <span className="empty-state-icon">
                  <IconTag size={20} />
                </span>
                <h3>{query ? "Nenhum resultado" : "Catálogo vazio"}</h3>
                <p>{query ? "Experimente outro grupo, marca ou classe." : "O catálogo nacional ainda não tem itens nesta categoria."}</p>
              </div>
            )}
          </div>
        </section>
      </main>
    </AppShell>
  );
}

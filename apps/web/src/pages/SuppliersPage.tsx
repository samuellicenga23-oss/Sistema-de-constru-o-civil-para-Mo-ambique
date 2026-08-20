import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { suppliersApi, type Supplier } from "../api/suppliers";
import { marketplaceApi, type MarketplaceSupplier } from "../api/marketplace";
import { catalogApi, type PriceZone } from "../api/catalog";
import SupplierMaterialsModal from "../components/SupplierMaterialsModal";
import MarketplaceSupplierModal from "../components/MarketplaceSupplierModal";
import Layout from "../components/Layout";
import GestaoTabs from "../components/GestaoTabs";
import PageSearch from "../components/PageSearch";
import { IconUpload, IconBuilding, IconSearch } from "../components/icons";

type ListedSupplier =
  | { kind: "sigo"; supplier: Supplier }
  | { kind: "marketplace"; supplier: MarketplaceSupplier };

type OfferFilter = "all" | "materials" | "labour" | "equipment" | "with_prices";

function offerChips(s: MarketplaceSupplier) {
  const chips: string[] = [];
  if (s.offersMaterials) chips.push("Materiais");
  if (s.offersLabour) chips.push("Mão-de-obra");
  if (s.offersEquipment) chips.push("Máquinas");
  return chips;
}

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [materialsModalSupplier, setMaterialsModalSupplier] = useState<Supplier | null>(null);

  const [zones, setZones] = useState<PriceZone[]>([]);
  const [zoneId, setZoneId] = useState("");
  const [marketplace, setMarketplace] = useState<
    | { locked: true; error: string; count: number }
    | { locked: false; suppliers: MarketplaceSupplier[] }
    | null
  >(null);
  const [query, setQuery] = useState("");
  const [searchNeedle, setSearchNeedle] = useState("");
  const [offerFilter, setOfferFilter] = useState<OfferFilter>("all");
  const [sortBy, setSortBy] = useState<"name" | "materials" | "coverage">("name");
  const [viewSupplier, setViewSupplier] = useState<MarketplaceSupplier | null>(null);

  async function reload() {
    setSuppliers(await suppliersApi.list());
  }

  async function reloadMarketplace(zone: string, q: string) {
    const res = await marketplaceApi.listSuppliers(zone || undefined, q.trim() || undefined);
    setMarketplace(res.locked ? { locked: true, error: res.error, count: res.count } : { locked: false, suppliers: res.suppliers });
  }

  useEffect(() => {
    reload().catch((err) => setError(err.message));
    catalogApi.listPriceZones().then(setZones).catch(() => {});
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setSearchNeedle(query), 280);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    reloadMarketplace(zoneId, searchNeedle).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [zoneId, searchNeedle]);

  const sigoPrecos = suppliers.find((s) => s.isReference);
  const marketplaceCount = marketplace && !marketplace.locked ? marketplace.suppliers.length : marketplace?.count ?? 0;

  const listed: ListedSupplier[] = useMemo(() => {
    const items: ListedSupplier[] = [];
    if (sigoPrecos && offerFilter === "all") items.push({ kind: "sigo", supplier: sigoPrecos });
    if (marketplace && !marketplace.locked) {
      let rows = [...marketplace.suppliers];
      if (offerFilter === "materials") rows = rows.filter((s) => s.offersMaterials || s.materialCount > 0);
      if (offerFilter === "labour") rows = rows.filter((s) => s.offersLabour || s.labourCount > 0);
      if (offerFilter === "equipment") rows = rows.filter((s) => s.offersEquipment || s.equipmentCount > 0);
      if (offerFilter === "with_prices") rows = rows.filter((s) => s.materialCount + s.labourCount + s.equipmentCount > 0);

      rows.sort((a, b) => {
        if (sortBy === "materials") return b.materialCount - a.materialCount || a.name.localeCompare(b.name, "pt");
        if (sortBy === "coverage") {
          const ca = a.materialCount + a.labourCount + a.equipmentCount;
          const cb = b.materialCount + b.labourCount + b.equipmentCount;
          return cb - ca || a.name.localeCompare(b.name, "pt");
        }
        return a.name.localeCompare(b.name, "pt");
      });

      for (const s of rows) items.push({ kind: "marketplace", supplier: s });
    }
    return items;
  }, [sigoPrecos, marketplace, offerFilter, sortBy]);

  return (
    <Layout
      title="Fornecedores e preços"
      actions={
        <a href="/fornecedor/registar" target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">Adicionar fornecedor</a>
      }
    >
      <div className="mx-auto w-full max-w-7xl space-y-5">
        <GestaoTabs />
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

        <section className="card flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span><strong className="text-slate-950">{marketplaceCount}</strong> fornecedores</span>
            <span><strong className="text-slate-950">{sigoPrecos?.referenceMaterialCount ?? 0}</strong> preços de referência</span>
          </div>
          <span className="text-xs text-slate-500">Os contactos ficam disponíveis para consulta directa.</span>
        </section>

        <section className="card overflow-hidden">
          <div className="border-b border-slate-200 p-4 sm:p-5">
            <div className="mb-4 flex items-center gap-2">
              <IconBuilding className="mt-0.5 h-4 w-4 shrink-0 text-brand-700" />
              <h2 className="section-title text-base">Fornecedores disponíveis</h2>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <select value={zoneId} onChange={(e) => setZoneId(e.target.value)} className="input max-w-xs" aria-label="Filtrar por zona">
                <option value="">Todas as zonas</option>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </select>
              <PageSearch
                value={query}
                onChange={setQuery}
                placeholder="Fornecedor ou material…"
                resultLabel={`${listed.length} resultado(s)`}
              />
              <select value={offerFilter} onChange={(e) => setOfferFilter(e.target.value as OfferFilter)} className="input max-w-[11rem]" aria-label="Filtrar oferta">
                <option value="all">Toda a oferta</option>
                <option value="materials">Materiais</option>
                <option value="labour">Mão-de-obra</option>
                <option value="equipment">Máquinas</option>
                <option value="with_prices">Com preços</option>
              </select>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)} className="input max-w-[11rem]" aria-label="Ordenar">
                <option value="name">Ordenar: nome</option>
                <option value="materials">Mais materiais</option>
                <option value="coverage">Maior cobertura</option>
              </select>
            </div>
          </div>

          {!marketplace ? (
            <p className="p-6 text-center text-sm text-slate-500">A carregar...</p>
          ) : (
            <>
              {marketplace.locked && (
                <div className="border-b border-amber-100 bg-amber-50 px-5 py-3 text-xs text-amber-950">
                  {marketplace.count} fornecedor(es) do marketplace nesta zona — {marketplace.error}{" "}
                  <Link to="/creditos" className="font-semibold underline">
                    Actualizar para Profissional
                  </Link>
                </div>
              )}
              <div className="grid gap-px bg-slate-200 sm:grid-cols-2 xl:grid-cols-3">
                {listed.map((item) => {
                  if (item.kind === "sigo") {
                    const supplier = item.supplier;
                    return (
                      <article key={`sigo-${supplier.id}`} className="flex min-w-0 flex-col bg-white p-5">
                        <div className="flex items-start gap-3">
                          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-100 text-sm font-bold text-brand-800">SI</span>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="break-words font-semibold text-slate-950">{supplier.name}</h3>
                              <span className="badge badge-brand">Fornecedor SIGO</span>
                            </div>
                            <p className="mt-1 text-xs text-slate-500">Referência nacional · disponível em qualquer plano</p>
                          </div>
                        </div>
                        <p className="mt-3 text-xs text-slate-500">
                          {supplier.referenceMaterialCount ?? 0} materiais · preços por zona no livro de preços
                        </p>
                        <label className="mt-3 block text-xs text-slate-500">
                          Governação
                          <select
                            className="input mt-1 py-1 text-xs"
                            value={supplier.governanceStatus ?? "qualificado"}
                            onChange={(event) => {
                              const governanceStatus = event.target.value as NonNullable<Supplier["governanceStatus"]>;
                              const blockedReason = governanceStatus === "bloqueado" ? window.prompt("Motivo do bloqueio") : null;
                              if (governanceStatus === "bloqueado" && blockedReason == null) return;
                              void suppliersApi
                                .setGovernance(supplier.id, { governanceStatus, blockedReason: blockedReason?.trim() || null })
                                .then(reload)
                                .catch((err) => setError(err instanceof Error ? err.message : "Erro ao actualizar"));
                            }}
                          >
                            <option value="qualificado">Qualificado</option>
                            <option value="preferencial">Preferencial</option>
                            <option value="observacao">Observação</option>
                            <option value="bloqueado">Bloqueado</option>
                          </select>
                        </label>
                        <div className="mt-auto flex items-center gap-2 pt-5">
                          <button type="button" onClick={() => setMaterialsModalSupplier(supplier)} className="btn btn-primary btn-sm flex-1">
                            Ver preços
                          </button>
                        </div>
                      </article>
                    );
                  }
                  const supplier = item.supplier;
                  const chips = offerChips(supplier);
                  const matched = supplier.matchedMaterials ?? [];
                  return (
                    <article key={supplier.id} className="flex min-w-0 flex-col bg-white p-5">
                      <div className="flex items-start gap-3">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-slate-100 text-sm font-bold text-slate-700">
                          {supplier.name.trim().slice(0, 2).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <h3 className="break-words font-semibold text-slate-950">{supplier.name}</h3>
                          <p className="mt-1 text-xs text-slate-500">{supplier.zoneName ?? "Zona não indicada"}</p>
                      {supplier.contact && <a href={`tel:${supplier.contact.replace(/\s+/g, "")}`} className="mt-1 block text-sm font-semibold text-brand-700 hover:underline">{supplier.contact}</a>}
                        </div>
                      </div>
                      {chips.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1">
                          {chips.map((chip) => (
                            <span key={chip} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                              {chip}
                            </span>
                          ))}
                        </div>
                      )}
                      <p className="mt-3 text-xs text-slate-500">
                        {supplier.materialCount} materiais · {supplier.labourCount} mão-de-obra · {supplier.equipmentCount} máquinas
                      </p>
                      {matched.length > 0 && (
                        <p className="mt-2 flex items-start gap-1 text-xs text-teal-800">
                          <IconSearch className="mt-0.5 h-3 w-3 shrink-0" />
                          Coincide: {matched.slice(0, 3).join(", ")}
                          {matched.length > 3 ? ` +${matched.length - 3}` : ""}
                        </p>
                      )}
                      <div className="mt-auto pt-5">
                        <button type="button" onClick={() => setViewSupplier(supplier)} className="btn btn-primary btn-sm w-full">Ver materiais e preços</button>
                      </div>
                    </article>
                  );
                })}
                {listed.length === 0 && (
                  <div className="bg-white px-5 py-10 text-center text-sm text-slate-500 sm:col-span-2 xl:col-span-3">
                    <IconUpload className="mx-auto mb-2 h-5 w-5 text-slate-300" />
                    Nenhum fornecedor corresponde aos filtros{zoneId ? " nesta zona" : ""}.
                    {searchNeedle ? " Tente outro material ou limpe a pesquisa." : ""}
                  </div>
                )}
              </div>
            </>
          )}
        </section>

        {materialsModalSupplier && <SupplierMaterialsModal supplier={materialsModalSupplier} onClose={() => setMaterialsModalSupplier(null)} />}
        {viewSupplier && (
          <MarketplaceSupplierModal
            supplier={viewSupplier}
            onClose={() => setViewSupplier(null)}
          />
        )}
      </div>
    </Layout>
  );
}

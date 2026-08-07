import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { suppliersApi, type Supplier } from "../api/suppliers";
import { marketplaceApi, type MarketplaceSupplier } from "../api/marketplace";
import { catalogApi, type PriceZone } from "../api/catalog";
import SupplierMaterialsModal from "../components/SupplierMaterialsModal";
import MarketplaceSupplierModal from "../components/MarketplaceSupplierModal";
import QuoteRequestModal from "../components/QuoteRequestModal";
import Layout from "../components/Layout";
import GestaoTabs from "../components/GestaoTabs";
import PageSearch from "../components/PageSearch";
import { IconUpload, IconBuilding } from "../components/icons";

type ListedSupplier =
  | { kind: "sigo"; supplier: Supplier }
  | { kind: "marketplace"; supplier: MarketplaceSupplier };

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [materialsModalSupplier, setMaterialsModalSupplier] = useState<Supplier | null>(null);

  const [zones, setZones] = useState<PriceZone[]>([]);
  const [zoneId, setZoneId] = useState("");
  const [marketplace, setMarketplace] = useState<{ locked: true; error: string; count: number } | { locked: false; suppliers: MarketplaceSupplier[] } | null>(null);
  const [query, setQuery] = useState("");
  const [viewSupplier, setViewSupplier] = useState<MarketplaceSupplier | null>(null);
  const [quoteSupplier, setQuoteSupplier] = useState<MarketplaceSupplier | null>(null);

  async function reload() {
    setSuppliers(await suppliersApi.list());
  }

  async function reloadMarketplace(zone: string) {
    const res = await marketplaceApi.listSuppliers(zone || undefined);
    setMarketplace(res.locked ? { locked: true, error: res.error, count: res.count } : { locked: false, suppliers: res.suppliers });
  }

  useEffect(() => {
    reload().catch((err) => setError(err.message));
    catalogApi.listPriceZones().then(setZones).catch(() => {});
  }, []);

  useEffect(() => {
    reloadMarketplace(zoneId).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [zoneId]);

  const sigoPrecos = suppliers.find((s) => s.isReference);

  const listed: ListedSupplier[] = useMemo(() => {
    const items: ListedSupplier[] = [];
    if (sigoPrecos) items.push({ kind: "sigo", supplier: sigoPrecos });
    if (marketplace && !marketplace.locked) {
      for (const s of marketplace.suppliers) items.push({ kind: "marketplace", supplier: s });
    }
    const needle = query.trim().toLocaleLowerCase("pt");
    if (!needle) return items;
    return items.filter((item) => item.supplier.name.toLocaleLowerCase("pt").includes(needle));
  }, [sigoPrecos, marketplace, query]);

  return (
    <Layout
      title="Fornecedores"
      subtitle="SIGO Preços e fornecedores reais. Cada um indica preços por zona em que opera."
      actions={<Link to="/gestao/cotacoes" className="btn btn-secondary btn-sm"><IconUpload className="h-3.5 w-3.5" /> Pedidos de cotação</Link>}
    >
      <div className="mx-auto w-full max-w-7xl space-y-5">
        <GestaoTabs />
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

        <section className="card overflow-hidden">
          <div className="border-b border-slate-200 p-4 sm:p-5">
            <div className="mb-4 flex items-center gap-2">
              <IconBuilding className="h-4 w-4 text-brand-700" />
              <div>
                <h2 className="section-title text-base">Fornecedores disponíveis</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  SIGO Preços está sempre disponível. Fornecedores do marketplace exigem plano Profissional+. Filtre por zona para ver quem opera na sua região.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <select value={zoneId} onChange={(e) => setZoneId(e.target.value)} className="input max-w-xs" aria-label="Filtrar por zona">
                <option value="">Todas as zonas</option>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>{z.name}</option>
                ))}
              </select>
              <PageSearch value={query} onChange={setQuery} placeholder="Pesquisar fornecedor…" resultLabel={`${listed.length} resultado(s)`} />
            </div>
          </div>

          {!marketplace ? (
            <p className="p-6 text-center text-sm text-slate-500">A carregar...</p>
          ) : (
            <>
              {marketplace.locked && (
                <div className="border-b border-amber-100 bg-amber-50 px-5 py-3 text-xs text-amber-950">
                  {marketplace.count} fornecedor(es) do marketplace nesta zona — {marketplace.error}{" "}
                  <Link to="/creditos" className="font-semibold underline">Actualizar para Profissional</Link>
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
                        <p className="mt-3 text-xs text-slate-500">{supplier.referenceMaterialCount ?? 0} materiais · preços por zona no livro de preços</p>
                        <div className="mt-auto flex items-center gap-2 pt-5">
                          <button type="button" onClick={() => setMaterialsModalSupplier(supplier)} className="btn btn-primary btn-sm flex-1">Ver / editar preços</button>
                        </div>
                      </article>
                    );
                  }
                  const supplier = item.supplier;
                  return (
                    <article key={supplier.id} className="flex min-w-0 flex-col bg-white p-5">
                      <div className="flex items-start gap-3">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-slate-100 text-sm font-bold text-slate-700">{supplier.name.trim().slice(0, 2).toUpperCase()}</span>
                        <div className="min-w-0">
                          <h3 className="break-words font-semibold text-slate-950">{supplier.name}</h3>
                          <p className="mt-1 text-xs text-slate-500">{supplier.zoneName ?? "Zona não indicada"}</p>
                        </div>
                      </div>
                      <p className="mt-3 text-xs text-slate-500">{supplier.materialCount} materiais · {supplier.labourCount} mão-de-obra · {supplier.equipmentCount} máquinas</p>
                      <div className="mt-auto flex items-center gap-2 pt-5">
                        <button type="button" onClick={() => setViewSupplier(supplier)} className="btn btn-secondary btn-sm flex-1">Ver preços</button>
                        <button type="button" onClick={() => setQuoteSupplier(supplier)} className="btn btn-primary btn-sm flex-1">Pedir cotação</button>
                      </div>
                    </article>
                  );
                })}
                {listed.length === 0 && (
                  <div className="bg-white px-5 py-10 text-center text-sm text-slate-500 sm:col-span-2 xl:col-span-3">
                    Nenhum fornecedor corresponde à pesquisa{zoneId ? " nesta zona" : ""}.
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
            onRequestQuote={() => {
              setQuoteSupplier(viewSupplier);
              setViewSupplier(null);
            }}
          />
        )}
        {quoteSupplier && (
          <QuoteRequestModal
            supplier={quoteSupplier}
            onClose={() => setQuoteSupplier(null)}
            onCreated={() => setQuoteSupplier(null)}
          />
        )}
      </div>
    </Layout>
  );
}

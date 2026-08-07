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
import { IconUsers, IconUpload, IconBuilding } from "../components/icons";

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

  const filteredMarketplace = useMemo(() => {
    if (!marketplace || marketplace.locked) return [];
    const needle = query.trim().toLocaleLowerCase("pt");
    if (!needle) return marketplace.suppliers;
    return marketplace.suppliers.filter((s) => s.name.toLocaleLowerCase("pt").includes(needle));
  }, [marketplace, query]);

  return (
    <Layout
      title="Fornecedores"
      subtitle="Individual: SIGO Preços. Profissional+: fornecedores reais na zona da obra, contactos e PDF do pedido ordenado por preço"
      actions={<Link to="/gestao/cotacoes" className="btn btn-secondary btn-sm"><IconUpload className="h-3.5 w-3.5" /> Pedidos de cotação</Link>}
    >
      <div className="mx-auto w-full max-w-7xl space-y-5">
        <GestaoTabs />
        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

        {sigoPrecos && (
          <section className="card overflow-hidden">
            <div className="border-b border-slate-200 p-4 sm:p-5">
              <div className="flex items-center gap-2">
                <IconUsers className="h-4 w-4 text-brand-700" />
                <div><h2 className="section-title text-base">SIGO Preços</h2><p className="mt-0.5 text-xs text-slate-500">Catálogo nacional de referência — sempre disponível, em qualquer plano, e livre para editar.</p></div>
              </div>
            </div>
            <div className="p-4 sm:p-5">
              <article className="flex min-w-0 flex-col rounded-xl border border-brand-200 bg-brand-50/40 p-5 sm:max-w-sm">
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-100 text-sm font-bold text-brand-800">SI</span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="break-words font-semibold text-slate-950">{sigoPrecos.name}</h3>
                      <span className="badge badge-brand">Fornecedor SIGO</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{sigoPrecos.referenceMaterialCount ?? 0} materiais · preços editáveis · sem IVA</p>
                  </div>
                </div>
                <button onClick={() => setMaterialsModalSupplier(sigoPrecos)} className="btn btn-primary btn-sm mt-5">Editar preços</button>
              </article>
            </div>
          </section>
        )}

        <section className="card overflow-hidden">
          <div className="border-b border-slate-200 p-4 sm:p-5">
            <div className="mb-4 flex items-center gap-2">
              <IconBuilding className="h-4 w-4 text-brand-700" />
              <div>
                <h2 className="section-title text-base">SIGO Fornecedores — a partir do Profissional</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Preços reais por zona, contacto directo e pedidos com PDF ordenado do melhor custo ao mais caro na região da obra.
                  O Portal do Fornecedor é gratuito para quem vende.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <select value={zoneId} onChange={(e) => setZoneId(e.target.value)} className="input max-w-xs">
                <option value="">Todas as zonas</option>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>{z.name}</option>
                ))}
              </select>
              {marketplace && !marketplace.locked && (
                <PageSearch value={query} onChange={setQuery} placeholder="Pesquisar fornecedor…" resultLabel={`${filteredMarketplace.length} resultado(s)`} />
              )}
            </div>
          </div>

          {!marketplace ? (
            <p className="p-6 text-center text-sm text-slate-500">A carregar...</p>
          ) : marketplace.locked ? (
            <div className="relative overflow-hidden">
              <div aria-hidden className="pointer-events-none grid select-none gap-px bg-slate-200 opacity-40 blur-sm sm:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <article key={i} className="flex flex-col gap-3 bg-white p-5">
                    <div className="h-10 w-10 rounded-lg bg-slate-200" />
                    <div className="h-3 w-2/3 rounded bg-slate-200" />
                    <div className="h-3 w-1/2 rounded bg-slate-100" />
                  </article>
                ))}
              </div>
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white/70 p-6 text-center">
                <p className="text-sm font-medium text-slate-950">{marketplace.count} fornecedor(es) disponível(eis) nesta zona</p>
                <p className="max-w-sm text-xs text-slate-600">{marketplace.error}</p>
                <Link to="/creditos" className="btn btn-primary btn-sm">Actualizar para Profissional</Link>
              </div>
            </div>
          ) : (
            <div className="grid gap-px bg-slate-200 sm:grid-cols-2 xl:grid-cols-3">
              {filteredMarketplace.map((supplier) => (
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
                    <button onClick={() => setViewSupplier(supplier)} className="btn btn-secondary btn-sm flex-1">Ver preços</button>
                    <button onClick={() => setQuoteSupplier(supplier)} className="btn btn-primary btn-sm flex-1">Pedir cotação</button>
                  </div>
                </article>
              ))}
              {filteredMarketplace.length === 0 && (
                <div className="bg-white px-5 py-10 text-center text-sm text-slate-500 sm:col-span-2 xl:col-span-3">
                  {marketplace.suppliers.length === 0 ? "Ainda não há fornecedores registados nesta zona." : "Nenhum fornecedor corresponde à pesquisa."}
                </div>
              )}
            </div>
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

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { suppliersApi, type Supplier } from "../api/suppliers";
import { marketplaceApi, type MarketplaceSupplier } from "../api/marketplace";
import { catalogApi, type PriceZone } from "../api/catalog";
import { quoteRequestsApi, type QuoteRequest } from "../api/quoteRequests";
import SupplierMaterialsModal from "../components/SupplierMaterialsModal";
import MarketplaceSupplierModal from "../components/MarketplaceSupplierModal";
import QuoteRequestModal from "../components/QuoteRequestModal";
import Layout from "../components/Layout";
import GestaoTabs from "../components/GestaoTabs";
import PageSearch from "../components/PageSearch";
import { IconUpload, IconBuilding, IconClipboard, IconSearch } from "../components/icons";

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
  const [quotes, setQuotes] = useState<QuoteRequest[]>([]);
  const [viewSupplier, setViewSupplier] = useState<MarketplaceSupplier | null>(null);
  const [quoteSupplier, setQuoteSupplier] = useState<MarketplaceSupplier | null>(null);

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
    quoteRequestsApi.list().then(setQuotes).catch(() => setQuotes([]));
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setSearchNeedle(query), 280);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    reloadMarketplace(zoneId, searchNeedle).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [zoneId, searchNeedle]);

  const sigoPrecos = suppliers.find((s) => s.isReference);
  const openQuotes = quotes.filter((q) => q.status === "enviado" || q.status === "respondido").length;
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

  const filters: Array<{ id: OfferFilter; label: string }> = [
    { id: "all", label: "Todos" },
    { id: "materials", label: "Materiais" },
    { id: "labour", label: "Mão-de-obra" },
    { id: "equipment", label: "Máquinas" },
    { id: "with_prices", label: "Com preços" },
  ];

  return (
    <Layout
      title="Fornecedores"
      subtitle="SIGO Preços e marketplace nacional — pesquise por zona, material ou especialidade"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/gestao/cotacoes" className="btn btn-secondary btn-sm">
            <IconClipboard className="h-3.5 w-3.5" />
            Pedidos de cotação
            {openQuotes > 0 && <span className="ml-1 rounded-full bg-amber-100 px-1.5 text-[10px] font-bold text-amber-800">{openQuotes}</span>}
          </Link>
          <a href="/fornecedor/registar" target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
            Convidar fornecedor
          </a>
        </div>
      }
    >
      <div className="mx-auto w-full max-w-7xl space-y-5">
        <GestaoTabs />
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">No marketplace</p>
            <p className="mt-1 font-display text-2xl font-bold text-slate-950">{marketplaceCount}</p>
            <p className="text-xs text-slate-500">{zoneId ? "Nesta zona" : "Todas as zonas"}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">SIGO Preços</p>
            <p className="mt-1 font-display text-2xl font-bold text-slate-950">{sigoPrecos ? "Activo" : "—"}</p>
            <p className="text-xs text-slate-500">{sigoPrecos?.referenceMaterialCount ?? 0} materiais de referência</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Cotações abertas</p>
            <p className="mt-1 font-display text-2xl font-bold text-slate-950">{openQuotes}</p>
            <p className="text-xs text-slate-500">Enviadas ou já respondidas</p>
          </div>
          <div className="rounded-xl border border-teal-100 bg-teal-50/60 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-teal-700">Como funciona</p>
            <p className="mt-1 text-xs leading-5 text-slate-700">
              Veja preços publicados, peça cotação com quantidades e aceite a resposta no módulo de cotações.
            </p>
          </div>
        </section>

        <section className="card overflow-hidden">
          <div className="border-b border-slate-200 p-4 sm:p-5">
            <div className="mb-4 flex items-start gap-2">
              <IconBuilding className="mt-0.5 h-4 w-4 shrink-0 text-brand-700" />
              <div>
                <h2 className="section-title text-base">Fornecedores disponíveis</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Pesquise por nome do fornecedor ou por material (ex.: «cimento»). O portal do fornecedor é gratuito — os preços vêm do próprio.
                </p>
              </div>
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
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)} className="input max-w-[11rem]" aria-label="Ordenar">
                <option value="name">Ordenar: nome</option>
                <option value="materials">Mais materiais</option>
                <option value="coverage">Maior cobertura</option>
              </select>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {filters.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setOfferFilter(f.id)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
                    offerFilter === f.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {f.label}
                </button>
              ))}
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
                        <div className="mt-auto flex items-center gap-2 pt-5">
                          <button type="button" onClick={() => setMaterialsModalSupplier(supplier)} className="btn btn-primary btn-sm flex-1">
                            Ver / editar preços
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
                          {supplier.contact && <p className="mt-0.5 text-xs text-slate-500">{supplier.contact}</p>}
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
                      <div className="mt-auto flex items-center gap-2 pt-5">
                        <button type="button" onClick={() => setViewSupplier(supplier)} className="btn btn-secondary btn-sm flex-1">
                          Ver preços
                        </button>
                        <button type="button" onClick={() => setQuoteSupplier(supplier)} className="btn btn-primary btn-sm flex-1">
                          Pedir cotação
                        </button>
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

        <section className="grid gap-3 lg:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-slate-900">1. Filtrar pela zona da obra</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">Os fornecedores publicam preços na região onde operam — alinhe com a zona do projecto.</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-slate-900">2. Pedir cotação com quantidades</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">Confirme preço e stock no Portal do Fornecedor; não edite preços de marketplace no SIGO.</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-slate-900">3. Aceitar e orçamentar</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Em <Link to="/gestao/cotacoes" className="font-semibold text-brand-700 hover:underline">Pedidos de cotação</Link> aceite a resposta e use o PDF de comparação.
            </p>
          </div>
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
            onCreated={() => {
              setQuoteSupplier(null);
              quoteRequestsApi.list().then(setQuotes).catch(() => {});
            }}
          />
        )}
      </div>
    </Layout>
  );
}

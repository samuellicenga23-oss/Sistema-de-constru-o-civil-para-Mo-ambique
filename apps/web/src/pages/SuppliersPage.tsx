import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { suppliersApi, type Supplier } from "../api/suppliers";
import SupplierMaterialsModal from "../components/SupplierMaterialsModal";
import SupplierInviteModal from "../components/SupplierInviteModal";
import QuoteRequestModal from "../components/QuoteRequestModal";
import Layout from "../components/Layout";
import Modal from "../components/Modal";
import ConfirmDialog from "../components/ConfirmDialog";
import PageSearch from "../components/PageSearch";
import { IconPlus, IconTrash, IconUsers, IconUpload } from "../components/icons";

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [materialsModalSupplier, setMaterialsModalSupplier] = useState<Supplier | null>(null);
  const [inviteModalSupplier, setInviteModalSupplier] = useState<Supplier | null>(null);
  const [quoteModalSupplier, setQuoteModalSupplier] = useState<Supplier | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Supplier | null>(null);
  const [query, setQuery] = useState("");

  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [location, setLocation] = useState("");
  const [nuit, setNuit] = useState("");

  async function reload() {
    setSuppliers(await suppliersApi.list());
  }

  useEffect(() => {
    reload().catch((err) => setError(err.message));
  }, []);

  const filteredSuppliers = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("pt");
    if (!needle) return suppliers;
    return suppliers.filter((supplier) =>
      [supplier.name, supplier.contact, supplier.location, supplier.nuit]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase("pt").includes(needle)),
    ).sort((a, b) => Number(b.isReference) - Number(a.isReference) || a.name.localeCompare(b.name, "pt"));
  }, [query, suppliers]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await suppliersApi.create({
        name,
        contact: contact.trim() || undefined,
        location: location.trim() || undefined,
        nuit: nuit.trim() || undefined,
      });
      setName("");
      setContact("");
      setLocation("");
      setNuit("");
      setShowForm(false);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar fornecedor");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(supplier: Supplier) {
    setError(null);
    try {
      await suppliersApi.delete(supplier.id);
      setPendingDelete(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao eliminar fornecedor");
    }
  }

  return (
    <Layout
      title="Fornecedores"
      subtitle="Empresas, contactos e cotações para compras"
      actions={
        <div className="flex items-center gap-2">
          <Link to="/fornecedores/pedidos" className="btn btn-secondary btn-sm"><IconUpload className="h-3.5 w-3.5" /> Pedidos de cotação</Link>
          <button onClick={() => setShowForm(true)} className="btn btn-primary btn-sm"><IconPlus className="h-3.5 w-3.5" /> Novo fornecedor</button>
        </div>
      }
    >
      <div className="mx-auto w-full max-w-7xl space-y-5">
        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

        <section className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
          <strong className="text-slate-950">{suppliers.length} fornecedor(es)</strong>
          <span className="text-slate-500">{suppliers.filter((supplier) => supplier.contact).length} com contacto</span>
          <span className="text-slate-500">{suppliers.filter((supplier) => supplier.nuit).length} com NUIT</span>
        </section>

        <section className="card overflow-hidden">
          <div className="border-b border-slate-200 p-4 sm:p-5">
            <div className="mb-4 flex items-center gap-2">
              <IconUsers className="h-4 w-4 text-brand-700" />
              <div><h2 className="section-title text-base">Fornecedores</h2><p className="mt-0.5 text-xs text-slate-500">Pesquise ou abra um fornecedor para gerir as suas cotações.</p></div>
            </div>
            <PageSearch
              value={query}
              onChange={setQuery}
              placeholder="Pesquisar por nome, contacto, localização ou NUIT…"
              resultLabel={`${filteredSuppliers.length} resultado(s)`}
            />
          </div>

          {showForm && (
            <Modal title="Novo fornecedor" subtitle="Dados essenciais para cotações e compras" onClose={() => !saving && setShowForm(false)}>
            <form onSubmit={handleCreate} className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Nome</label>
                <input required value={name} onChange={(e) => setName(e.target.value)} className="input" />
              </div>
              <div>
                <label className="label">Contacto</label>
                <input value={contact} onChange={(e) => setContact(e.target.value)} className="input" placeholder="Telefone/email" />
              </div>
              <div>
                <label className="label">Localização</label>
                <input value={location} onChange={(e) => setLocation(e.target.value)} className="input" />
              </div>
              <div>
                <label className="label">NUIT</label>
                <input value={nuit} onChange={(e) => setNuit(e.target.value)} className="input" />
              </div>
              <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:col-span-2 sm:flex-row sm:justify-end">
                <button type="button" onClick={() => setShowForm(false)} className="btn btn-secondary">Cancelar</button>
                <button type="submit" disabled={saving} className="btn btn-primary">
                  {saving ? "A guardar..." : "Guardar fornecedor"}
                </button>
              </div>
            </form>
            </Modal>
          )}

          <div className="grid gap-px bg-slate-200 sm:grid-cols-2 xl:grid-cols-3">
            {filteredSuppliers.map((supplier) => (
              <article key={supplier.id} className={`flex min-w-0 flex-col bg-white p-5 ${supplier.isReference ? "ring-1 ring-inset ring-brand-200" : ""}`}>
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-slate-100 text-sm font-bold text-slate-700">{supplier.name.trim().slice(0, 2).toUpperCase()}</span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="break-words font-semibold text-slate-950">{supplier.name}</h3>
                      {supplier.isReference && <span className="badge badge-brand">Fornecedor SIGO</span>}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {supplier.isReference
                        ? `${supplier.referenceMaterialCount ?? 0} materiais · preços editáveis · sem IVA`
                        : supplier.location || "Localização por definir"}
                    </p>
                  </div>
                </div>
                {(supplier.contact || supplier.nuit) && <dl className="mt-4 space-y-2 border-t border-slate-100 pt-4 text-xs">
                  {supplier.contact && <div className="flex justify-between gap-3"><dt className="text-slate-500">Contacto</dt><dd className="break-all text-right font-medium text-slate-700">{supplier.contact}</dd></div>}
                  {supplier.nuit && <div className="flex justify-between gap-3"><dt className="text-slate-500">NUIT</dt><dd className="text-right font-medium text-slate-700">{supplier.nuit}</dd></div>}
                </dl>}
                <div className="mt-auto flex flex-col gap-2 pt-5">
                  <div className="flex items-center gap-2">
                    <button onClick={() => setMaterialsModalSupplier(supplier)} className={`btn btn-sm flex-1 ${supplier.isReference ? "btn-primary" : "btn-secondary"}`}>
                      {supplier.isReference ? "Editar preços" : "Cotações e recursos"}
                    </button>
                    {!supplier.isReference && <button onClick={() => setPendingDelete(supplier)} className="icon-btn-danger" title="Eliminar fornecedor">
                      <IconTrash className="h-3.5 w-3.5" />
                    </button>}
                  </div>
                  {!supplier.isReference && (
                    supplier.supplierAccountId ? (
                      <button onClick={() => setQuoteModalSupplier(supplier)} className="btn btn-secondary btn-sm w-full">
                        Pedir cotação no Portal do Fornecedor
                      </button>
                    ) : (
                      <button onClick={() => setInviteModalSupplier(supplier)} className="btn btn-secondary btn-sm w-full">
                        Convidar para o Portal do Fornecedor
                      </button>
                    )
                  )}
                </div>
              </article>
            ))}
            {filteredSuppliers.length === 0 && !showForm && (
              <div className="bg-white px-5 py-10 text-center text-sm text-slate-500 sm:col-span-2 xl:col-span-3">
                {suppliers.length === 0 ? "Ainda não existem fornecedores. Registe o primeiro para começar a comparar cotações." : "Nenhum fornecedor corresponde à pesquisa."}
              </div>
            )}
          </div>
        </section>

        {materialsModalSupplier && <SupplierMaterialsModal supplier={materialsModalSupplier} onClose={() => setMaterialsModalSupplier(null)} />}
        {inviteModalSupplier && (
          <SupplierInviteModal
            supplier={inviteModalSupplier}
            onClose={() => setInviteModalSupplier(null)}
            onInvited={() => { reload().catch(() => {}); }}
          />
        )}
        {quoteModalSupplier && (
          <QuoteRequestModal
            supplier={quoteModalSupplier}
            onClose={() => setQuoteModalSupplier(null)}
            onCreated={() => setQuoteModalSupplier(null)}
          />
        )}
        {pendingDelete && <ConfirmDialog title="Eliminar fornecedor?" message={`O fornecedor “${pendingDelete.name}” e as cotações associadas serão removidos.`} confirmLabel="Eliminar fornecedor" danger onCancel={() => setPendingDelete(null)} onConfirm={() => handleDelete(pendingDelete)} />}
      </div>
    </Layout>
  );
}

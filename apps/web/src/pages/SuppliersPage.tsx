import { useEffect, useState, type FormEvent } from "react";
import { suppliersApi, type Supplier } from "../api/suppliers";
import SupplierMaterialsModal from "../components/SupplierMaterialsModal";
import Layout from "../components/Layout";
import { IconPlus, IconTrash, IconUsers } from "../components/icons";

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [materialsModalSupplier, setMaterialsModalSupplier] = useState<Supplier | null>(null);

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
    if (!window.confirm(`Eliminar o fornecedor "${supplier.name}"? Esta acção não pode ser desfeita.`)) return;
    setError(null);
    try {
      await suppliersApi.delete(supplier.id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao eliminar fornecedor");
    }
  }

  return (
    <Layout title="Fornecedores" subtitle="Cadastro de fornecedores da empresa — materiais e preços ligados ao Catálogo de Preços">
      <div className="max-w-4xl">
        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

        <section className="card">
          <div className="flex items-center justify-between px-5 pt-4 pb-2 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <IconUsers className="w-4 h-4 text-brand-700" />
              <h2 className="section-title text-base">Fornecedores</h2>
            </div>
            <button onClick={() => setShowForm((s) => !s)} className="btn btn-secondary btn-sm">
              <IconPlus className="w-3.5 h-3.5" />
              Adicionar
            </button>
          </div>

          {showForm && (
            <form onSubmit={handleCreate} className="grid gap-3 sm:grid-cols-2 px-5 py-4 border-b border-gray-100">
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
              <div className="sm:col-span-2">
                <button type="submit" disabled={saving} className="btn btn-primary">
                  {saving ? "A guardar..." : "Guardar fornecedor"}
                </button>
              </div>
            </form>
          )}

          <ul>
            {suppliers.map((s) => (
              <li key={s.id} className="table-row group flex items-center justify-between px-5 py-3">
                <div>
                  <p className="font-medium text-gray-900">{s.name}</p>
                  <p className="text-xs text-gray-500">
                    {[s.contact, s.location, s.nuit ? `NUIT ${s.nuit}` : null].filter(Boolean).join(" · ") || "Sem dados de contacto"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setMaterialsModalSupplier(s)} className="btn btn-ghost btn-sm">
                    materiais e preços
                  </button>
                  <button
                    onClick={() => handleDelete(s)}
                    className="icon-btn-danger opacity-0 pointer-coarse:opacity-100 group-hover:opacity-100 transition-opacity"
                    title="Eliminar fornecedor"
                  >
                    <IconTrash className="w-3.5 h-3.5" />
                  </button>
                </div>
              </li>
            ))}
            {suppliers.length === 0 && !showForm && (
              <li className="px-5 py-6 text-sm text-gray-400 text-center">Sem fornecedores ainda — adicione o primeiro acima.</li>
            )}
          </ul>
        </section>

        {materialsModalSupplier && <SupplierMaterialsModal supplier={materialsModalSupplier} onClose={() => setMaterialsModalSupplier(null)} />}
      </div>
    </Layout>
  );
}

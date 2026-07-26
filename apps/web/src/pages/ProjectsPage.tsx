import { useEffect, useState, type FormEvent, type MouseEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { boqApi, type Project } from "../api/boq";
import { catalogApi, type PriceZone } from "../api/catalog";
import QuickEstimateWizard from "../components/QuickEstimateWizard";
import Layout from "../components/Layout";
import { IconFolder, IconPlus, IconTrash, IconWand } from "../components/icons";

export default function ProjectsPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [currency, setCurrency] = useState<"MZN" | "USD">("MZN");
  const [zoneId, setZoneId] = useState("");
  const [zones, setZones] = useState<PriceZone[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [freshDocumentId, setFreshDocumentId] = useState<string | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [loading, setLoading] = useState(true);

  async function reload() {
    setProjects(await boqApi.listProjects());
    setLoading(false);
  }

  useEffect(() => {
    reload().catch((err) => setError(err.message));
    catalogApi.listPriceZones().then(setZones).catch(() => {});
  }, []);

  const zoneName = (id: string | null) => zones.find((z) => z.id === id)?.name;

  async function handleDelete(e: MouseEvent, id: string, name: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm(`Eliminar o projecto "${name}"? Isto apaga também os seus Mapas de Quantidades, plantas carregadas e autos de medição. Esta acção não pode ser desfeita.`)) return;
    try {
      await boqApi.deleteProject(id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao eliminar projecto");
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const created = await boqApi.createProject({ name, client: client || undefined, currency, zoneId: zoneId || undefined });
      // O projecto nasce com um Mapa de Quantidades padrão. Em vez de navegar logo para lá,
      // oferece-se primeiro o Assistente de Medições para preencher as quantidades automaticamente
      // — com opção de saltar directamente para o mapa.
      if (created.defaultDocumentId) {
        setFreshDocumentId(created.defaultDocumentId);
      } else {
        navigate(`/projectos/${created.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar projecto");
    }
  }

  return (
    <Layout
      title="Projectos"
      subtitle={`${projects.length} projecto(s)`}
      actions={
        <button onClick={() => setShowForm((s) => !s)} className="btn btn-primary btn-sm">
          <IconPlus className="w-3.5 h-3.5" />
          Novo projecto
        </button>
      }
    >
      <div className="space-y-5 max-w-4xl">
        {error && <p className="text-sm text-red-600">{error}</p>}

        {freshDocumentId && (
          <section className="card card-pad bg-brand-50/60 border-brand-200 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h2 className="section-title mb-1">Projecto criado com sucesso</h2>
              <p className="text-sm text-gray-600">
                Quer preencher as quantidades automaticamente com o Assistente de Medições, ou prefere ir directamente para
                o Mapa de Quantidades e preencher manualmente?
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button onClick={() => navigate(`/documentos/${freshDocumentId}`)} className="btn btn-secondary btn-sm">
                Ir para o Mapa
              </button>
              <button onClick={() => setShowWizard(true)} className="btn btn-primary btn-sm">
                <IconWand className="w-3.5 h-3.5" />
                Usar Assistente
              </button>
            </div>
          </section>
        )}

        {showForm && (
          <section className="card card-pad">
            <h2 className="section-title mb-3">Novo projecto</h2>
            <form onSubmit={handleCreate} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto_auto] items-end">
              <div>
                <label className="label">Nome do projecto *</label>
                <input required value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="ex: Moradia T3 — Marracuene" />
              </div>
              <div>
                <label className="label">Dono da obra</label>
                <input value={client} onChange={(e) => setClient(e.target.value)} className="input" placeholder="cliente" />
              </div>
              <div>
                <label className="label">Zona do edifício</label>
                <select value={zoneId} onChange={(e) => setZoneId(e.target.value)} className="input">
                  <option value="">Sem zona definida</option>
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Moeda</label>
                <select value={currency} onChange={(e) => setCurrency(e.target.value as "MZN" | "USD")} className="input">
                  <option value="MZN">MZN</option>
                  <option value="USD">USD</option>
                </select>
              </div>
              <button type="submit" className="btn btn-primary">
                Criar
              </button>
            </form>
            <p className="text-xs text-gray-500 mt-2">
              A zona determina que preços de material se aplicam (quando um material tem preço próprio nessa zona) —
              defina/gira as zonas no Catálogo de Preços.
            </p>
          </section>
        )}

        {loading ? (
          <p className="text-sm text-gray-400 py-8 text-center">A carregar...</p>
        ) : projects.length === 0 && !showForm ? (
          <div className="card p-12 text-center">
            <IconFolder className="w-10 h-10 mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500 mb-4">Ainda não há projectos. Crie o primeiro para começar a orçamentar.</p>
            <button onClick={() => setShowForm(true)} className="btn btn-primary">
              <IconPlus className="w-4 h-4" />
              Criar projecto
            </button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {projects.map((p) => (
              <Link key={p.id} to={`/projectos/${p.id}`} className="card card-pad hover:border-brand-400 hover:shadow-md transition-all group relative">
                <div className="flex items-start justify-between gap-2">
                  <div className="w-10 h-10 rounded-lg bg-brand-100 text-brand-700 flex items-center justify-center">
                    <IconFolder className="w-5 h-5" />
                  </div>
                  <span className="flex items-center gap-1.5">
                    <span className="badge badge-gray">{p.currency}</span>
                    <button
                      onClick={(e) => handleDelete(e, p.id, p.name)}
                      className="icon-btn-danger opacity-0 pointer-coarse:opacity-100 group-hover:opacity-100 transition-opacity"
                      title="Eliminar projecto"
                    >
                      <IconTrash className="w-3.5 h-3.5" />
                    </button>
                  </span>
                </div>
                <p className="font-semibold text-gray-900 mt-3 group-hover:text-brand-800 transition-colors">{p.name}</p>
                {p.client && <p className="text-sm text-gray-500 mt-0.5">{p.client}</p>}
                {zoneName(p.zoneId) && <p className="muted mt-0.5">Zona: {zoneName(p.zoneId)}</p>}
              </Link>
            ))}
          </div>
        )}
      </div>

      {showWizard && freshDocumentId && (
        <QuickEstimateWizard
          documentId={freshDocumentId}
          onClose={() => {
            setShowWizard(false);
            navigate(`/documentos/${freshDocumentId}`);
          }}
          onApplied={() => {}}
        />
      )}
    </Layout>
  );
}

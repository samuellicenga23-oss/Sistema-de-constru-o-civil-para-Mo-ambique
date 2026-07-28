import { useEffect, useState, type FormEvent, type MouseEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { boqApi, type Project } from "../api/boq";
import { catalogApi, type PriceZone } from "../api/catalog";
import { plantsApi } from "../api/plants";
import Layout from "../components/Layout";
import Modal from "../components/Modal";
import ConfirmDialog from "../components/ConfirmDialog";
import { IconFolder, IconPlus, IconTrash } from "../components/icons";

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
  const [creating, setCreating] = useState(false);
  const [createProgress, setCreateProgress] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function reload() {
    setProjects(await boqApi.listProjects());
    setLoading(false);
  }

  useEffect(() => {
    reload().catch((err) => setError(err.message));
    catalogApi.listPriceZones().then(setZones).catch(() => {});
  }, []);

  const zoneName = (id: string | null) => zones.find((z) => z.id === id)?.name;
  const filteredProjects = projects.filter((project) =>
    `${project.name} ${project.client ?? ""} ${zoneName(project.zoneId) ?? ""}`.toLocaleLowerCase("pt").includes(query.toLocaleLowerCase("pt")),
  );

  function handleDelete(e: MouseEvent, id: string, name: string) {
    e.preventDefault();
    e.stopPropagation();
    setPendingDelete({ id, name });
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await boqApi.deleteProject(pendingDelete.id);
      setPendingDelete(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao eliminar projecto");
    } finally {
      setDeleting(false);
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const architectureFile = (form.elements.namedItem("architectureFile") as HTMLInputElement | null)?.files?.[0];
    const structuralFile = (form.elements.namedItem("structuralFile") as HTMLInputElement | null)?.files?.[0];
    setError(null);
    setCreating(true);
    setCreateProgress("A criar projecto...");
    let createdProjectId: string | null = null;
    try {
      const created = await boqApi.createProject({ name, client: client || undefined, currency, zoneId: zoneId || undefined });
      createdProjectId = created.id;

      const uploadedPlants = [];
      if (architectureFile) {
        setCreateProgress("A analisar a planta de arquitectura...");
        uploadedPlants.push(await plantsApi.upload(created.id, architectureFile, "arquitectura"));
      }
      if (structuralFile) {
        setCreateProgress("A analisar o projecto estrutural...");
        uploadedPlants.push(await plantsApi.upload(created.id, structuralFile, "estrutura"));
      }

      // Com plantas, segue directamente para confirmar o que foi extraído; sem plantas, abre a
      // obra no passo de carregamento. Nunca envia primeiro para a estrutura manual do orçamento.
      navigate(uploadedPlants.length > 0 ? `/plantas/${uploadedPlants[0].id}` : `/projectos/${created.id}#plantas-do-projecto`);
    } catch (err) {
      if (createdProjectId) {
        navigate(`/projectos/${createdProjectId}?uploadErro=1`);
      } else {
        setError(err instanceof Error ? err.message : "Erro ao criar projecto");
      }
    } finally {
      setCreating(false);
      setCreateProgress("");
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
      <div className="space-y-5 max-w-6xl">
        {error && <p className="text-sm text-red-600">{error}</p>}

        {showForm && (
          <Modal title="Novo projecto" subtitle="Identifique a obra e, se já os tiver, carregue os projectos para iniciar a medição automaticamente." onClose={() => !creating && setShowForm(false)} maxWidth="max-w-2xl">
            <form onSubmit={handleCreate} className="grid gap-4 sm:grid-cols-2 items-end">
              <div className="sm:col-span-2">
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
              <div className="sm:col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3">
                  <p className="text-sm font-semibold text-slate-900">Projectos técnicos (opcional)</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Pode carregar agora ou depois. O SIGO analisará os ficheiros e levará directamente à confirmação dos dados antes de medir.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="label">Planta de arquitectura (PDF)</label>
                    <input type="file" name="architectureFile" accept="application/pdf" disabled={creating} className="input py-1.5 file:mr-2 file:rounded-md file:border-0 file:bg-white file:px-2 file:py-1 file:text-xs" />
                  </div>
                  <div>
                    <label className="label">Projecto estrutural (PDF)</label>
                    <input type="file" name="structuralFile" accept="application/pdf" disabled={creating} className="input py-1.5 file:mr-2 file:rounded-md file:border-0 file:bg-white file:px-2 file:py-1 file:text-xs" />
                  </div>
                </div>
              </div>
              <div className="sm:col-span-2 flex justify-end gap-2 border-t border-slate-200 pt-4">
              <button type="button" onClick={() => setShowForm(false)} disabled={creating} className="btn btn-secondary">Cancelar</button>
              <button type="submit" disabled={creating} className="btn btn-primary min-w-44">
                {creating ? createProgress : "Criar projecto"}
              </button>
              </div>
            </form>
            <p className="text-xs text-gray-500 mt-2">
              A zona determina que preços de material se aplicam (quando um material tem preço próprio nessa zona) —
              defina/gira as zonas no Catálogo de Preços. Os mapas automáticos de custo usam MZN, a moeda do catálogo;
              documentos externos em USD continuam separados e não são convertidos silenciosamente.
            </p>
          </Modal>
        )}

        {!loading && projects.length > 0 && (
          <div className="toolbar">
            <div className="min-w-[240px] flex-1 max-w-md">
              <label className="label">Pesquisar projectos</label>
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} className="input" placeholder="Nome, cliente ou zona" />
            </div>
            <div className="flex items-center gap-6 px-2 text-sm">
              <div><span className="block text-xs text-slate-400">Total</span><strong className="text-slate-900">{projects.length}</strong></div>
              <div><span className="block text-xs text-slate-400">Em MZN</span><strong className="text-slate-900">{projects.filter((p) => p.currency === "MZN").length}</strong></div>
              <div><span className="block text-xs text-slate-400">Em USD</span><strong className="text-slate-900">{projects.filter((p) => p.currency === "USD").length}</strong></div>
            </div>
          </div>
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
          <div className="card overflow-hidden">
            <div className="hidden sm:grid grid-cols-[minmax(0,1fr)_minmax(10rem,0.7fr)_10rem_6rem] gap-4 px-5 py-2.5 table-head-row border-x-0 border-t-0">
              <span>Projecto</span><span>Dono da obra</span><span>Zona</span><span>Moeda</span>
            </div>
            {filteredProjects.map((p) => (
              <Link key={p.id} to={`/projectos/${p.id}`} className="group grid sm:grid-cols-[minmax(0,1fr)_minmax(10rem,0.7fr)_10rem_6rem] items-center gap-3 sm:gap-4 border-b border-slate-100 px-5 py-4 last:border-0 hover:bg-blue-50/40">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="w-9 h-9 shrink-0 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center"><IconFolder className="w-4.5 h-4.5" /></div>
                  <div className="min-w-0"><p className="font-semibold text-slate-900 truncate group-hover:text-blue-700">{p.name}</p><p className="sm:hidden text-xs text-slate-500 mt-0.5">{p.client || "Sem cliente definido"}</p></div>
                </div>
                <span className="hidden sm:block truncate text-sm text-slate-600">{p.client || "—"}</span>
                <span className="hidden sm:block truncate text-sm text-slate-500">{zoneName(p.zoneId) || "—"}</span>
                <span className="flex items-center justify-between gap-2">
                    <span className="badge badge-gray">{p.currency}</span>
                    <button
                      onClick={(e) => handleDelete(e, p.id, p.name)}
                      className="icon-btn-danger opacity-0 pointer-coarse:opacity-100 group-hover:opacity-100 transition-opacity"
                      title="Eliminar projecto"
                    >
                      <IconTrash className="w-3.5 h-3.5" />
                    </button>
                </span>
              </Link>
            ))}
            {filteredProjects.length === 0 && <p className="px-5 py-10 text-center text-sm text-slate-500">Nenhum projecto corresponde à pesquisa.</p>}
          </div>
        )}
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title="Eliminar projecto?"
          message={`O projecto “${pendingDelete.name}” e todos os mapas, plantas e autos associados serão eliminados definitivamente.`}
          confirmLabel="Eliminar projecto"
          danger
          busy={deleting}
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
        />
      )}
    </Layout>
  );
}

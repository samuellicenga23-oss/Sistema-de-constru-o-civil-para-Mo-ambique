import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { boqApi, type Project } from "../api/boq";
import { siteDiaryApi, type SiteDiaryEntry } from "../api/siteDiary";
import Layout from "../components/Layout";
import ProjectWorkspaceNav from "../components/ProjectWorkspaceNav";
import { IconBack, IconPlus, IconTrash, IconDownload, IconUpload } from "../components/icons";

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const WEATHER_OPTIONS = ["Sol", "Nublado", "Chuva", "Chuva forte (obra parada)"];

export default function ProjectSiteDiaryPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [entries, setEntries] = useState<SiteDiaryEntry[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingPhotoFor, setUploadingPhotoFor] = useState<string | null>(null);

  const [date, setDate] = useState(todayStr());
  const [weather, setWeather] = useState("Sol");
  const [workersPresent, setWorkersPresent] = useState("");
  const [equipmentPresent, setEquipmentPresent] = useState("");
  const [workDone, setWorkDone] = useState("");
  const [materialsReceived, setMaterialsReceived] = useState("");
  const [materialsConsumed, setMaterialsConsumed] = useState("");
  const [visitors, setVisitors] = useState("");
  const [inspectorInstructions, setInspectorInstructions] = useState("");
  const [incidents, setIncidents] = useState("");
  const [decisions, setDecisions] = useState("");
  const [entryTime, setEntryTime] = useState("07:00");
  const [exitTime, setExitTime] = useState("17:00");

  async function reload() {
    if (!projectId) return;
    const [proj, list] = await Promise.all([boqApi.getProject(projectId), siteDiaryApi.list(projectId)]);
    setProject(proj);
    setEntries(list);
  }

  useEffect(() => {
    reload().catch((err) => setError(err.message));
  }, [projectId]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!projectId || !workDone.trim()) return;
    setError(null);
    setSaving(true);
    try {
      await siteDiaryApi.create(projectId, {
        date,
        weather,
        workersPresent: workersPresent ? Number(workersPresent) : undefined,
        equipmentPresent: equipmentPresent.trim() || undefined,
        workDone: workDone.trim(),
        materialsReceived: materialsReceived.trim() || undefined,
        materialsConsumed: materialsConsumed.trim() || undefined,
        visitors: visitors.trim() || undefined,
        inspectorInstructions: inspectorInstructions.trim() || undefined,
        incidents: incidents.trim() || undefined,
        decisions: decisions.trim() || undefined,
        entryTime,
        exitTime,
      });
      setWorkersPresent("");
      setEquipmentPresent("");
      setWorkDone("");
      setMaterialsReceived("");
      setMaterialsConsumed("");
      setVisitors("");
      setInspectorInstructions("");
      setIncidents("");
      setDecisions("");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao registar entrada do diário");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(entry: SiteDiaryEntry) {
    if (!window.confirm(`Eliminar o registo de ${entry.date}? Esta acção não pode ser desfeita.`)) return;
    setError(null);
    try {
      await siteDiaryApi.delete(entry.id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao eliminar registo");
    }
  }

  async function handleUploadPhoto(entryId: string, file: File) {
    setUploadingPhotoFor(entryId);
    setError(null);
    try {
      await siteDiaryApi.uploadPhoto(entryId, file);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar fotografia");
    } finally {
      setUploadingPhotoFor(null);
    }
  }

  async function handleDeletePhoto(entryId: string, url: string) {
    setError(null);
    try {
      await siteDiaryApi.deletePhoto(entryId, url);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao remover fotografia");
    }
  }

  if (!project) {
    return <div className="min-h-screen flex items-center justify-center text-gray-400">A carregar...</div>;
  }

  return (
    <Layout
      title={`Diário de Obra — ${project.name}`}
      subtitle="Registo diário de trabalhos, materiais, presenças e ocorrências — com exportação em PDF"
      actions={
        <Link to={`/projectos/${projectId}`} className="btn btn-ghost btn-sm">
          <IconBack className="w-3.5 h-3.5" />
          Projecto
        </Link>
      }
    >
      <div className="space-y-5 max-w-7xl">
        <ProjectWorkspaceNav projectId={projectId!} />
        {error && <p className="text-sm text-red-600">{error}</p>}

        <section className="card card-pad">
          <h2 className="section-title mb-3">Novo registo</h2>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="label">Data</label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
              </div>
              <div>
                <label className="label">Condições meteorológicas</label>
                <select value={weather} onChange={(e) => setWeather(e.target.value)} className="input">
                  {WEATHER_OPTIONS.map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Nº trabalhadores presentes</label>
                <input type="number" min="0" value={workersPresent} onChange={(e) => setWorkersPresent(e.target.value)} className="input" />
              </div>
              <div>
                <label className="label">Equipamentos presentes</label>
                <input value={equipmentPresent} onChange={(e) => setEquipmentPresent(e.target.value)} className="input" placeholder="Betoneira, dumper..." />
              </div>
              <div>
                <label className="label">Hora de entrada</label>
                <input type="time" value={entryTime} onChange={(e) => setEntryTime(e.target.value)} className="input" />
              </div>
              <div>
                <label className="label">Hora de saída</label>
                <input type="time" value={exitTime} onChange={(e) => setExitTime(e.target.value)} className="input" />
              </div>
            </div>
            <div>
              <label className="label">Trabalhos executados *</label>
              <textarea required value={workDone} onChange={(e) => setWorkDone(e.target.value)} rows={2} className="input" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Materiais recebidos</label>
                <textarea value={materialsReceived} onChange={(e) => setMaterialsReceived(e.target.value)} rows={2} className="input" />
              </div>
              <div>
                <label className="label">Materiais consumidos</label>
                <textarea value={materialsConsumed} onChange={(e) => setMaterialsConsumed(e.target.value)} rows={2} className="input" />
              </div>
              <div>
                <label className="label">Visitas</label>
                <textarea value={visitors} onChange={(e) => setVisitors(e.target.value)} rows={2} className="input" />
              </div>
              <div>
                <label className="label">Instruções do fiscal</label>
                <textarea value={inspectorInstructions} onChange={(e) => setInspectorInstructions(e.target.value)} rows={2} className="input" />
              </div>
              <div>
                <label className="label">Acidentes / interrupções / problemas</label>
                <textarea value={incidents} onChange={(e) => setIncidents(e.target.value)} rows={2} className="input" />
              </div>
              <div>
                <label className="label">Decisões tomadas</label>
                <textarea value={decisions} onChange={(e) => setDecisions(e.target.value)} rows={2} className="input" />
              </div>
            </div>
            <button type="submit" disabled={saving} className="btn btn-primary">
              <IconPlus className="w-4 h-4" />
              {saving ? "A guardar..." : "Registar dia"}
            </button>
          </form>
        </section>

        <section className="space-y-3">
          {entries.map((entry) => {
            const expanded = expandedId === entry.id;
            return (
              <div key={entry.id} className="card">
                <button
                  onClick={() => setExpandedId(expanded ? null : entry.id)}
                  className="w-full flex items-center justify-between px-5 py-3 text-left"
                >
                  <span className="font-medium text-gray-900">
                    {entry.date} <span className="text-gray-400 font-normal">— {entry.weather ?? "sem condições registadas"}</span>
                  </span>
                  <span className="flex items-center gap-2 text-xs text-gray-500">
                    {entry.workersPresent != null && <span className="badge badge-gray">{entry.workersPresent} trabalhadores</span>}
                    {entry.photoUrls.length > 0 && <span className="badge badge-gray">{entry.photoUrls.length} fotos</span>}
                  </span>
                </button>
                {expanded && (
                  <div className="px-5 pb-5 border-t border-gray-100 pt-4 space-y-3 text-sm">
                    <p>
                      <span className="font-medium">Trabalhos executados:</span> {entry.workDone}
                    </p>
                    {entry.materialsReceived && (
                      <p>
                        <span className="font-medium">Materiais recebidos:</span> {entry.materialsReceived}
                      </p>
                    )}
                    {entry.materialsConsumed && (
                      <p>
                        <span className="font-medium">Materiais consumidos:</span> {entry.materialsConsumed}
                      </p>
                    )}
                    {entry.visitors && (
                      <p>
                        <span className="font-medium">Visitas:</span> {entry.visitors}
                      </p>
                    )}
                    {entry.inspectorInstructions && (
                      <p>
                        <span className="font-medium">Instruções do fiscal:</span> {entry.inspectorInstructions}
                      </p>
                    )}
                    {entry.incidents && (
                      <p className="text-red-700">
                        <span className="font-medium">Acidentes/problemas:</span> {entry.incidents}
                      </p>
                    )}
                    {entry.decisions && (
                      <p>
                        <span className="font-medium">Decisões tomadas:</span> {entry.decisions}
                      </p>
                    )}

                    {entry.photoUrls.length > 0 && (
                      <div className="flex gap-2 flex-wrap">
                        {entry.photoUrls.map((url) => (
                          <div key={url} className="relative group/photo">
                            <img src={url} alt="Foto da obra" className="w-24 h-24 object-cover rounded-md border border-gray-200" />
                            <button
                              onClick={() => handleDeletePhoto(entry.id, url)}
                              className="absolute -top-2 -right-2 bg-white rounded-full shadow p-1 opacity-0 group-hover/photo:opacity-100 transition-opacity"
                              title="Remover fotografia"
                            >
                              <IconTrash className="w-3 h-3 text-red-600" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center gap-3 pt-2 flex-wrap">
                      <label className="btn btn-secondary btn-sm cursor-pointer">
                        <IconUpload className="w-3.5 h-3.5" />
                        {uploadingPhotoFor === entry.id ? "A carregar..." : "Adicionar foto"}
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/gif"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleUploadPhoto(entry.id, file);
                            e.target.value = "";
                          }}
                        />
                      </label>
                      <a href={siteDiaryApi.exportPdfUrl(entry.id)} className="btn btn-secondary btn-sm">
                        <IconDownload className="w-3.5 h-3.5" />
                        Exportar PDF
                      </a>
                      <button onClick={() => handleDelete(entry)} className="text-red-600 text-xs font-medium hover:underline ml-auto">
                        eliminar registo
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {entries.length === 0 && <p className="text-sm text-gray-400 text-center py-6">Sem registos ainda — registe o primeiro dia acima.</p>}
        </section>
      </div>
    </Layout>
  );
}

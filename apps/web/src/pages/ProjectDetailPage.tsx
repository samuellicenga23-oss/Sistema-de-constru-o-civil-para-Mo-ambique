import { useEffect, useState, type FormEvent, type MouseEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { boqApi, type BudgetDocument, type Project } from "../api/boq";
import { measurementApi, type MeasurementCertificate } from "../api/measurement";
import { plantsApi, type Plant } from "../api/plants";
import { catalogApi, type PriceZone } from "../api/catalog";
import Layout from "../components/Layout";
import { InlineNotice, MetricCard, SectionHeader } from "../components/WorkspaceUI";
import ProjectWorkspaceNav from "../components/ProjectWorkspaceNav";
import { IconBack, IconDoc, IconClipboard, IconMap, IconPlus, IconTrash, IconUpload } from "../components/icons";

const PLANT_STATUS_BADGE: Record<Plant["processingStatus"], { label: string; cls: string }> = {
  pendente: { label: "Pendente", cls: "badge-gray" },
  processando: { label: "A processar...", cls: "badge-yellow" },
  concluido: { label: "Concluído", cls: "badge-green" },
  erro: { label: "Erro", cls: "badge-red" },
};

const DOC_STATUS_BADGE: Record<string, string> = {
  rascunho: "badge-yellow",
  submetido: "badge-brand",
  aprovado: "badge-green",
};

// Nunca usar toISOString().slice(0,10) para a data de hoje — converte para UTC e "recua"
// um dia à noite em fusos horários positivos como Moçambique (UTC+2).
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [documents, setDocuments] = useState<BudgetDocument[]>([]);
  const [certificates, setCertificates] = useState<MeasurementCertificate[]>([]);
  const [plants, setPlants] = useState<Plant[]>([]);
  const [zones, setZones] = useState<PriceZone[]>([]);
  const [savingZone, setSavingZone] = useState(false);
  const [title, setTitle] = useState("Mapa de Quantidades");
  const [template, setTemplate] = useState<"padrao" | "vazio">("padrao");
  const [selectedDocId, setSelectedDocId] = useState("");
  const [periodDate, setPeriodDate] = useState(todayStr());
  const [plantDiscipline, setPlantDiscipline] = useState<"arquitectura" | "estrutura">("arquitectura");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    if (!projectId) return;
    const [proj, docs, certs, plantList] = await Promise.all([
      boqApi.getProject(projectId),
      boqApi.listBudgetDocuments(projectId),
      measurementApi.list(projectId),
      plantsApi.list(projectId),
    ]);
    setProject(proj);
    setDocuments(docs);
    setCertificates(certs);
    setPlants(plantList);
    if (!selectedDocId && docs.length) setSelectedDocId(docs[0].id);
  }

  useEffect(() => {
    reload().catch((err) => setError(err.message));
    catalogApi.listPriceZones().then(setZones).catch(() => {});
  }, [projectId]);

  async function handleZoneChange(newZoneId: string) {
    if (!projectId) return;
    setSavingZone(true);
    setError(null);
    try {
      const updated = await boqApi.updateProject(projectId, { zoneId: newZoneId || null });
      setProject(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao actualizar a zona");
    } finally {
      setSavingZone(false);
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!projectId) return;
    setError(null);
    try {
      await boqApi.createBudgetDocument(projectId, { title, template });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar documento");
    }
  }

  async function handleUploadPlant(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!projectId) return;
    const fileInput = (e.currentTarget.elements.namedItem("plantFile") as HTMLInputElement) ?? null;
    const file = fileInput?.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      await plantsApi.upload(projectId, file, plantDiscipline);
      fileInput.value = "";
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar a planta");
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteDocument(e: MouseEvent, id: string, title: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm(`Eliminar o documento "${title}"? Isto apaga também os seus autos de medição associados. Esta acção não pode ser desfeita.`)) return;
    setError(null);
    try {
      await boqApi.deleteBudgetDocument(id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao eliminar documento");
    }
  }

  async function handleDeletePlant(e: MouseEvent, id: string, name: string | null) {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm(`Eliminar a planta "${name ?? "sem nome"}"? Os dados extraídos (compartimentos/aço) desta planta deixam de estar disponíveis no Assistente. Esta acção não pode ser desfeita.`)) return;
    setError(null);
    try {
      await plantsApi.delete(id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao eliminar planta");
    }
  }

  async function handleDeleteCertificate(e: MouseEvent, id: string, number: number) {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm(`Eliminar o Auto Nº ${number}? Esta acção não pode ser desfeita.`)) return;
    setError(null);
    try {
      await measurementApi.delete(id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao eliminar auto de medição");
    }
  }

  async function handleCreateCertificate(e: FormEvent) {
    e.preventDefault();
    if (!projectId || !selectedDocId) return;
    setError(null);
    try {
      await measurementApi.create(projectId, { budgetDocumentId: selectedDocId, periodDate });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar auto de medição");
    }
  }

  if (!project) {
    return <div className="min-h-screen flex items-center justify-center text-gray-400">A carregar...</div>;
  }

  return (
    <Layout
      title={project.name}
      actions={
          <Link to="/projectos" className="btn btn-ghost btn-sm">
            <IconBack className="w-3.5 h-3.5" />
            Todos os projectos
          </Link>
      }
    >
      <div className="grid gap-5 lg:grid-cols-2 max-w-7xl">
        <div className="lg:col-span-2"><ProjectWorkspaceNav projectId={projectId!} /></div>
        {error && <p className="text-sm text-red-600 lg:col-span-2">{error}</p>}

        <div className="lg:col-span-2">
          <InlineNotice>
            <strong>Próximo passo recomendado: </strong>
            {documents.length === 0
              ? "crie o primeiro Mapa de Quantidades para estruturar o orçamento da obra."
              : plants.length === 0
                ? "carregue as plantas do projecto para acelerar medições e manter a documentação centralizada."
                : certificates.length === 0
                  ? "quando a execução começar, crie o primeiro Auto de Medição para acompanhar o progresso."
                  : "reveja o Diário de Obra, compras pendentes e movimentos financeiros antes de actualizar a medição."}
          </InlineNotice>
        </div>

        <div className="lg:col-span-2 grid gap-3 sm:grid-cols-3">
          <MetricCard label="Mapas de quantidades" value={documents.length} note="Documentos do projecto" />
          <MetricCard label="Plantas" value={plants.length} note="Ficheiros carregados" tone="info" />
          <MetricCard label="Autos de medição" value={certificates.length} note="Registos de execução" tone="positive" />
        </div>

        {/* Zona de preço */}
        <section className="card card-pad lg:col-span-2 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="section-title mb-0.5">Zona do edifício</h2>
            <p className="text-xs text-gray-500">
              Determina que preços de material se aplicam neste projecto (quando um material tem preço próprio nessa
              zona) — geridas no Catálogo de Preços.
            </p>
          </div>
          <select
            value={project.zoneId ?? ""}
            disabled={savingZone}
            onChange={(e) => handleZoneChange(e.target.value)}
            className="input max-w-xs"
          >
            <option value="">Sem zona definida</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
        </section>

        {/* Mapas de Quantidades */}
        <section className="card">
          <SectionHeader title="Mapas de quantidades" description="Orçamentos e revisões deste projecto" actions={<IconDoc className="w-4 h-4 text-blue-700" />} />
          <ul>
            {documents.map((d) => (
              <li key={d.id} className="table-row group">
                <Link to={`/documentos/${d.id}`} className="flex items-center justify-between px-5 py-3">
                  <span className="font-medium text-gray-900">
                    {d.title} {d.revision ? <span className="text-gray-400 font-normal">rev. {d.revision}</span> : ""}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="badge badge-gray">{d.currency}</span>
                    <span className={`badge ${DOC_STATUS_BADGE[d.status] ?? "badge-gray"}`}>{d.status}</span>
                    <button
                      onClick={(e) => handleDeleteDocument(e, d.id, d.title)}
                      className="icon-btn-danger opacity-0 pointer-coarse:opacity-100 group-hover:opacity-100 transition-opacity"
                      title="Eliminar documento"
                    >
                      <IconTrash className="w-3.5 h-3.5" />
                    </button>
                  </span>
                </Link>
              </li>
            ))}
            {documents.length === 0 && <li className="px-5 py-4 text-sm text-gray-400">Sem documentos ainda — crie o primeiro abaixo.</li>}
          </ul>
          <form onSubmit={handleCreate} className="flex gap-2 items-end px-5 py-4 border-t border-gray-100 flex-wrap">
            <div className="flex-1 min-w-[150px]">
              <label className="label">Título do novo documento</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className="input" />
            </div>
            <div>
              <label className="label">Modelo</label>
              <select value={template} onChange={(e) => setTemplate(e.target.value as "padrao" | "vazio")} className="input">
                <option value="padrao">Estrutura padrão (capítulos pré-definidos)</option>
                <option value="vazio">Documento vazio</option>
              </select>
            </div>
            <button type="submit" className="btn btn-primary">
              <IconPlus className="w-4 h-4" />
              Criar
            </button>
          </form>
        </section>

        {/* Plantas */}
        <section className="card">
          <SectionHeader title="Plantas e desenhos" description="Leitura automática de arquitectura e estrutura" actions={<IconMap className="w-4 h-4 text-blue-700" />} />
          <ul>
            {plants.map((p) => (
              <li key={p.id} className="table-row group">
                {p.processingStatus === "concluido" ? (
                  <Link to={`/plantas/${p.id}`} className="flex items-center justify-between px-5 py-3">
                    <span className="font-medium text-gray-900 truncate pr-2">{p.originalFileName}</span>
                    <span className="flex items-center gap-2 shrink-0">
                      <span className={`badge ${PLANT_STATUS_BADGE[p.processingStatus].cls}`}>{PLANT_STATUS_BADGE[p.processingStatus].label}</span>
                      <button
                        onClick={(e) => handleDeletePlant(e, p.id, p.originalFileName)}
                        className="icon-btn-danger opacity-0 pointer-coarse:opacity-100 group-hover:opacity-100 transition-opacity"
                        title="Eliminar planta"
                      >
                        <IconTrash className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  </Link>
                ) : (
                  <div className="flex items-center justify-between px-5 py-3">
                    <span className="font-medium text-gray-500 truncate pr-2">{p.originalFileName}</span>
                    <span className="flex items-center gap-2 shrink-0">
                      <span className={`badge ${PLANT_STATUS_BADGE[p.processingStatus].cls}`}>{PLANT_STATUS_BADGE[p.processingStatus].label}</span>
                      <button
                        onClick={(e) => handleDeletePlant(e, p.id, p.originalFileName)}
                        className="icon-btn-danger opacity-0 pointer-coarse:opacity-100 group-hover:opacity-100 transition-opacity"
                        title="Eliminar planta"
                      >
                        <IconTrash className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  </div>
                )}
              </li>
            ))}
            {plants.length === 0 && (
              <li className="px-5 py-4 text-sm text-gray-400">
                Carregue um PDF vectorial do ArchiCAD — o sistema extrai compartimentos (áreas) e quadros de aço automaticamente.
              </li>
            )}
          </ul>
          <form onSubmit={handleUploadPlant} className="flex gap-2 items-end px-5 py-4 border-t border-gray-100 flex-wrap">
            <div>
              <label className="label">Disciplina</label>
              <select value={plantDiscipline} onChange={(e) => setPlantDiscipline(e.target.value as "arquitectura" | "estrutura")} className="input">
                <option value="arquitectura">Arquitectura</option>
                <option value="estrutura">Estrutura</option>
              </select>
            </div>
            <div className="flex-1 min-w-[180px]">
              <label className="label">Ficheiro PDF</label>
              <input type="file" name="plantFile" accept="application/pdf" required className="input py-1.5 file:mr-3 file:rounded-md file:border-0 file:bg-brand-100 file:text-brand-800 file:px-2.5 file:py-1 file:text-xs file:font-medium" />
            </div>
            <button type="submit" disabled={uploading} className="btn btn-primary">
              <IconUpload className="w-4 h-4" />
              {uploading ? "A processar..." : "Carregar"}
            </button>
          </form>
        </section>

        {/* Autos de Medição */}
        {documents.length > 0 && (
          <section className="card lg:col-span-2">
            <SectionHeader title="Autos de medição" description="Execução física e certificação dos trabalhos" actions={<IconClipboard className="w-4 h-4 text-blue-700" />} />
            <div className="grid md:grid-cols-2">
              <ul className="md:border-r border-gray-100">
                {certificates.map((c) => (
                  <li key={c.id} className="table-row group">
                    <Link to={`/autos/${c.id}`} className="flex items-center justify-between px-5 py-3">
                      <span className="font-medium text-gray-900">
                        Auto Nº {c.number} <span className="text-gray-400 font-normal">— {c.periodDate}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span className={`badge ${DOC_STATUS_BADGE[c.status] ?? "badge-gray"}`}>{c.status}</span>
                        <button
                          onClick={(e) => handleDeleteCertificate(e, c.id, c.number)}
                          className="icon-btn-danger opacity-0 pointer-coarse:opacity-100 group-hover:opacity-100 transition-opacity"
                          title="Eliminar auto de medição"
                        >
                          <IconTrash className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    </Link>
                  </li>
                ))}
                {certificates.length === 0 && <li className="px-5 py-4 text-sm text-gray-400">Sem autos de medição ainda.</li>}
              </ul>
              <form onSubmit={handleCreateCertificate} className="flex gap-2 items-end px-5 py-4 flex-wrap">
                <div className="flex-1 min-w-[160px]">
                  <label className="label">Mapa de quantidades base</label>
                  <select value={selectedDocId} onChange={(e) => setSelectedDocId(e.target.value)} className="input">
                    {documents.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Data do período</label>
                  <input type="date" value={periodDate} onChange={(e) => setPeriodDate(e.target.value)} className="input" />
                </div>
                <button type="submit" className="btn btn-primary">
                  <IconPlus className="w-4 h-4" />
                  Novo auto
                </button>
              </form>
            </div>
          </section>
        )}
      </div>
    </Layout>
  );
}

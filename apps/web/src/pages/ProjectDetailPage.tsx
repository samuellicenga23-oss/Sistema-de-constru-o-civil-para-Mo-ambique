import { useEffect, useState, type FormEvent, type MouseEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { boqApi, type BudgetDocument, type Project, type ProjectMaterialSpecification, type ProjectWorkflowStatus } from "../api/boq";
import { measurementApi, type MeasurementCertificate } from "../api/measurement";
import { plantsApi, type Plant, type PlantProcessingProgress } from "../api/plants";
import { catalogApi, type PriceZone } from "../api/catalog";
import Layout from "../components/Layout";
import PlantUploadProgress from "../components/PlantUploadProgress";
import BlockingProcessingOverlay from "../components/BlockingProcessingOverlay";
import { useConfirmDialog } from "../hooks/useConfirmDialog";
import { usePlantPolling } from "../hooks/usePlantPolling";
import { SectionHeader } from "../components/WorkspaceUI";
import ProjectWorkspaceNav, { faseQueryFor, resolveProjectFase } from "../components/ProjectWorkspaceNav";
import ProjectWorkflowBanner from "../components/ProjectWorkflowBanner";
import PublicShareModal from "../components/PublicShareModal";
import { IconClipboard, IconPlus, IconTrash, IconUpload } from "../components/icons";
import { useAuth } from "../auth/AuthContext";
import { UNITS, type Unit } from "@sigo/shared";

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

function sectionPages(startPage: number, endPage: number) {
  return startPage === endPage ? `p. ${startPage}` : `pp. ${startPage}–${endPage}`;
}

// Nunca usar toISOString().slice(0,10) para a data de hoje — converte para UTC e "recua"
// um dia à noite em fusos horários positivos como Moçambique (UTC+2).
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function ProjectDetailPage() {
  const { confirm, dialog } = useConfirmDialog();
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [showPublicShare, setShowPublicShare] = useState(false);
  const [searchParams] = useSearchParams();
  const [project, setProject] = useState<Project | null>(null);
  const [documents, setDocuments] = useState<BudgetDocument[]>([]);
  const [certificates, setCertificates] = useState<MeasurementCertificate[]>([]);
  const [plants, setPlants] = useState<Plant[]>([]);
  const [zones, setZones] = useState<PriceZone[]>([]);
  const [savingZone, setSavingZone] = useState(false);
  const [title] = useState("Mapa de Quantidades");
  const [template] = useState<"padrao" | "vazio">("padrao");
  const [selectedDocId, setSelectedDocId] = useState("");
  const [periodDate, setPeriodDate] = useState(todayStr());
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<PlantProcessingProgress | null>(null);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [preparingMeasurements, setPreparingMeasurements] = useState(false);
  const [reprocessingPlantId, setReprocessingPlantId] = useState<string | null>(null);
  const [reprocessProgress, setReprocessProgress] = useState<PlantProcessingProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [materialSpecifications, setMaterialSpecifications] = useState<ProjectMaterialSpecification[]>([]);
  const [newMaterial, setNewMaterial] = useState<{ name: string; unit: Unit; specification: string }>({ name: "", unit: "un", specification: "" });
  const [addingMaterial, setAddingMaterial] = useState(false);
  const [workflowStatus, setWorkflowStatus] = useState<ProjectWorkflowStatus | null>(null);

  async function reload() {
    if (!projectId) return;
    const [proj, docs, certs, plantList, projectMaterials] = await Promise.all([
      boqApi.getProject(projectId),
      boqApi.listBudgetDocuments(projectId),
      measurementApi.list(projectId),
      plantsApi.list(projectId),
      boqApi.listProjectMaterialSpecifications(projectId),
    ]);
    setProject(proj);
    setDocuments(docs);
    setCertificates(certs);
    setPlants(plantList);
    setMaterialSpecifications(projectMaterials);
    boqApi.getProjectWorkflow(projectId).then(setWorkflowStatus).catch(() => setWorkflowStatus(null));
    const firstBudget = docs.find((document) => document.documentType === "orcamento" && document.status === "aprovado");
    if (!selectedDocId || !docs.some((document) => document.id === selectedDocId && document.status === "aprovado")) {
      setSelectedDocId(firstBudget?.id ?? "");
    }
  }

  useEffect(() => {
    reload().catch((err) => setError(err.message));
    catalogApi.listPriceZones().then(setZones).catch(() => {});
  }, [projectId]);

  usePlantPolling(
    plants,
    (id, progress) => setPlants((current) => current.map((p) => (p.id === id ? { ...p, ...progress } : p))),
    () => void reload(),
  );

  async function handleZoneChange(newZoneId: string) {
    if (!projectId) return;
    setSavingZone(true);
    setError(null);
    try {
      const updated = await boqApi.updateProject(projectId, { zoneId: newZoneId || null });
      setProject(updated);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao actualizar a zona");
    } finally {
      setSavingZone(false);
    }
  }

  async function handleAddMaterial(e: FormEvent) {
    e.preventDefault();
    if (!projectId || !newMaterial.name.trim()) return;
    setAddingMaterial(true);
    setError(null);
    try {
      await boqApi.addProjectMaterialSpecification(projectId, {
        name: newMaterial.name.trim(),
        unit: newMaterial.unit,
        specification: newMaterial.specification.trim() || undefined,
      });
      setNewMaterial({ name: "", unit: "un", specification: "" });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível adicionar o material");
    } finally {
      setAddingMaterial(false);
    }
  }

  async function handleCreateQuickBudget() {
    if (!projectId) return;
    setError(null);
    try {
      const created = await boqApi.createBudgetDocument(projectId, {
        title: title.trim() || "Mapa de Quantidades",
        template,
        documentType: "orcamento",
      });
      navigate(`/documentos/${created.id}?fase=orcamento`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar orçamento");
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
    setUploadNotice(null);
    try {
      const uploaded = await plantsApi.upload(projectId, file, "auto", setUploadProgress, { waitForCompletion: true });
      if (uploaded.processingStatus === "erro") {
        setPlants((current) => current.some((plant) => plant.id === uploaded.id) ? current : [...current, uploaded]);
        fileInput.value = "";
        setUploadProgress(null);
        navigate(`/plantas/${uploaded.id}/completar`);
        return;
      }
      setPlants((current) => current.some((plant) => plant.id === uploaded.id) ? current : [...current, uploaded]);
      fileInput.value = "";
      setUploadProgress(null);
      navigate(`/plantas/${uploaded.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar a planta");
      await reload().catch(() => {});
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  }

  async function handlePrepareMeasurements() {
    if (!projectId) return;
    setPreparingMeasurements(true);
    setError(null);
    try {
      const { document } = await boqApi.prepareMeasurementWorkspace(projectId);
      const dest = project?.measurementMode === "importar"
        ? `/documentos/${document.id}?fase=medicao`
        : `/documentos/${document.id}?fase=medicao&assistente=1`;
      navigate(dest);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível preparar as medições");
    } finally {
      setPreparingMeasurements(false);
    }
  }

  async function handleDeleteDocument(e: MouseEvent, id: string, title: string) {
    e.preventDefault();
    e.stopPropagation();
    const ok = await confirm({
      title: "Eliminar documento?",
      message: `Eliminar “${title}”?`,
      confirmLabel: "Eliminar",
      danger: true,
      details: ["Autos de medição associados serão removidos"],
    });
    if (!ok) return;
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
    const ok = await confirm({
      title: "Eliminar planta?",
      message: `Eliminar “${name ?? "sem nome"}”?`,
      confirmLabel: "Eliminar",
      danger: true,
      details: ["Dados extraídos deixam de estar disponíveis no Assistente"],
    });
    if (!ok) return;
    setError(null);
    try {
      await plantsApi.delete(id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao eliminar planta");
    }
  }

  async function handleReprocessPlant(e: MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    setError(null);
    setReprocessingPlantId(id);
    try {
      await plantsApi.reprocess(id, (progress) => {
        setReprocessProgress(progress);
        setPlants((current) => current.map((plant) => plant.id === id ? { ...plant, ...progress } : plant));
      });
      await reload();
      navigate(`/plantas/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível reprocessar a planta");
    } finally {
      setReprocessingPlantId(null);
      setReprocessProgress(null);
    }
  }

  async function handleDeleteCertificate(e: MouseEvent, id: string, number: number) {
    e.preventDefault();
    e.stopPropagation();
    const ok = await confirm({
      title: "Eliminar auto?",
      message: `Eliminar Auto Nº ${number}?`,
      confirmLabel: "Eliminar",
      danger: true,
    });
    if (!ok) return;
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

  const completedPlants = plants.filter((plant) => plant.processingStatus === "concluido");
  const failedPlants = plants.filter((plant) => plant.processingStatus === "erro");
  const measurementDocuments = documents.filter((document) => document.documentType === "medicao");
  const budgetDocuments = documents.filter((document) => document.documentType === "orcamento");
  const approvedBudgetDocuments = budgetDocuments.filter((document) => document.status === "aprovado");
  const hasMeasuredBudget = measurementDocuments.some((document) => document.lastEstimateReport?.entries?.length);
  const latestCompletedPlant = completedPlants[completedPlants.length - 1];
  const usesPlants = project.measurementMode === "plantas";

  // O URL define o workspace. Sem `fase` → visão geral. Híbrido NÃO misture módulos.
  const fase = resolveProjectFase(searchParams.get("fase"));
  const isVisao = fase === "visao";
  const showMedicao = fase === "medicao" || isVisao;
  const showOrcamento = fase === "orcamento" || isVisao;
  const showPlantas = isVisao || (fase === "medicao" && (usesPlants || plants.length > 0));
  const showPlantasFull = isVisao || (fase === "medicao" && (!hasMeasuredBudget || plants.some((p) => p.processingStatus !== "concluido")));
  const showPrepararObra = fase === "orcamento";
  const showCertificados = fase === "gestao";
  const showControlBanner = isVisao;
  const showMetricCards = isVisao;
  const showMaterials = isVisao;

  const measurementPrepSteps = usesPlants
    ? [
        { label: "Identificar a obra", done: true },
        { label: "Carregar projectos", done: plants.length > 0 },
        { label: "Confirmar dados", done: completedPlants.length > 0 && failedPlants.length === 0 },
        { label: "Quantificar", done: hasMeasuredBudget },
        { label: "Enviar a orçamentos", done: budgetDocuments.length > 0 },
      ]
    : [
        { label: "Projecto", done: true },
        { label: "Medição", done: project.measurementMode === "importar" || hasMeasuredBudget },
        { label: "Enviar a orçamentos", done: budgetDocuments.length > 0 },
      ];
  const completedPrepSteps = measurementPrepSteps.filter((step) => step.done).length;
  const prepIncomplete = fase === "medicao" && completedPrepSteps < measurementPrepSteps.length;

  const backTo =
    fase === "gestao" ? "/gestao" : fase === "medicao" ? "/medicoes" : fase === "orcamento" ? "/orcamentos" : "/orcamentos";
  const backLabel =
    fase === "gestao" ? "Gestão" : fase === "medicao" ? "Medições" : fase === "orcamento" ? "Orçamentos" : "Obras";
  const navMode = fase === "gestao" ? "site" : fase === "medicao" ? "measurement" : "budget";
  const faseQuery = faseQueryFor(fase === "visao" ? "orcamento" : fase);

  return (
    <Layout
      title={project.name}
      back={{ label: backLabel, fallbackTo: backTo }}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {(user?.role === "admin_empresa" || user?.role === "orcamentista") && fase === "visao" && (
            <button type="button" onClick={() => setShowPublicShare(true)} className="btn btn-secondary btn-sm">
              Partilhar
            </button>
          )}
          {fase === "visao" && approvedBudgetDocuments.length > 0 && (
            <Link to={`/projectos/${projectId}?fase=gestao`} className="btn btn-primary btn-sm">
              Gestão da obra
            </Link>
          )}
        </div>
      }
    >
      <div className="mx-auto grid w-full max-w-5xl items-start gap-5">
        <div>
          <ProjectWorkspaceNav projectId={projectId!} mode={navMode} />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {uploadNotice && <p className="text-sm text-emerald-700">{uploadNotice}</p>}
        {searchParams.get("uploadErro") === "1" && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {searchParams.get("motivo") === "excel"
              ? "O projecto foi criado, mas a importação Excel falhou. Abra o mapa de quantidades e importe novamente."
              : searchParams.get("motivo") === "planta"
                ? "O projecto foi criado, mas um PDF não pôde ser analisado. Continue com medição manual ou Excel."
                : "O projecto foi criado, mas um passo falhou."}
          </div>
        )}

        {showControlBanner && <ProjectWorkflowBanner status={workflowStatus} projectId={projectId!} />}

        {/* ——— Workspace Medi��es ——— */}
        {fase === "medicao" && (
          <>
            {prepIncomplete && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
                <span className="text-sm font-semibold text-slate-800">
                  Preparação {completedPrepSteps}/{measurementPrepSteps.length}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (usesPlants && completedPlants.length === 0) {
                      document.getElementById("plantas-do-projecto")?.scrollIntoView({ behavior: "smooth" });
                      return;
                    }
                    void handlePrepareMeasurements();
                  }}
                  disabled={preparingMeasurements}
                  className="btn btn-primary btn-sm"
                >
                  {preparingMeasurements ? "A abrir..." : usesPlants && completedPlants.length === 0 ? "Carregar planta" : "Continuar"}
                </button>
              </div>
            )}
            {usesPlants && latestCompletedPlant && (
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
                <span className="truncate font-medium text-slate-800">{latestCompletedPlant.originalFileName}</span>
                <Link to={`/plantas/${latestCompletedPlant.id}`} className="shrink-0 font-semibold text-brand-700 hover:underline">
                  Ver planta
                </Link>
              </div>
            )}
            <section className="card overflow-hidden">
              <SectionHeader
                title="Medi��es"
                actions={
                  <button
                    type="button"
                    onClick={handlePrepareMeasurements}
                    disabled={preparingMeasurements}
                    className="btn btn-primary btn-sm"
                  >
                    <IconPlus className="h-4 w-4" />
                    {preparingMeasurements ? "A abrir..." : "Nova medi��o"}
                  </button>
                }
              />
              <ul>
                {measurementDocuments.map((d) => (
                  <li key={d.id} className="table-row group">
                    <Link to={`/documentos/${d.id}${faseQuery}`} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <span className="min-w-0">
                        <span className="block break-words font-medium text-gray-900">
                          {d.title}
                          {d.revision ? <span className="font-normal text-gray-400"> · rev. {d.revision}</span> : null}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-wrap items-center gap-2">
                        <span className={`badge ${DOC_STATUS_BADGE[d.status] ?? "badge-gray"}`}>{d.status}</span>
                        <span className="btn btn-secondary btn-sm pointer-events-none">Abrir</span>
                        <button onClick={(e) => handleDeleteDocument(e, d.id, d.title)} className="icon-btn-danger opacity-0 pointer-coarse:opacity-100 group-hover:opacity-100" title="Eliminar">
                          <IconTrash className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    </Link>
                  </li>
                ))}
                {measurementDocuments.length === 0 && (
                  <li className="px-5 py-10 text-center">
                    <p className="text-sm text-slate-500">Sem Medi��es</p>
                    <button type="button" onClick={handlePrepareMeasurements} disabled={preparingMeasurements} className="btn btn-primary btn-sm mt-4">
                      <IconPlus className="h-4 w-4" /> Nova medi��o
                    </button>
                  </li>
                )}
              </ul>
            </section>
            {(showPlantasFull || (fase === "medicao" && usesPlants && completedPlants.length === 0)) && (
              <section id="plantas-do-projecto" className="card scroll-mt-24">
                <SectionHeader title="Plantas em curso" />
                <ul>
                  {plants.filter((p) => p.processingStatus !== "concluido").map((p) => (
                    <li key={p.id} className="table-row px-5 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="min-w-0 break-words text-sm font-medium text-slate-700">{p.originalFileName}</span>
                        <span className={`badge ${PLANT_STATUS_BADGE[p.processingStatus].cls}`}>{PLANT_STATUS_BADGE[p.processingStatus].label}</span>
                      </div>
                      {p.processingStatus === "erro" && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Link to={`/plantas/${p.id}/completar`} className="btn btn-primary btn-sm">Completar</Link>
                          <button type="button" onClick={(e) => handleReprocessPlant(e, p.id)} disabled={reprocessingPlantId === p.id} className="btn btn-secondary btn-sm">
                            {reprocessingPlantId === p.id ? "A tentar..." : "Tentar novamente"}
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                  {plants.length === 0 && <li className="px-5 py-4 text-sm text-slate-400">Sem PDFs</li>}
                </ul>
                <form onSubmit={handleUploadPlant} className="grid items-end gap-3 border-t border-gray-100 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <input type="file" name="plantFile" accept="application/pdf" required className="input py-1.5 file:mr-3 file:rounded-md file:border-0 file:bg-brand-100 file:px-2.5 file:py-1 file:text-xs file:font-medium file:text-brand-800" />
                  <button type="submit" disabled={uploading} className="btn btn-secondary w-full sm:w-auto">
                    <IconUpload className="h-4 w-4" /> {uploading ? "A carregar..." : "Adicionar PDF"}
                  </button>
                </form>
              </section>
            )}
          </>
        )}

        {/* ——— Workspace Orçamentos ——— */}
        {fase === "orcamento" && (
          <>
            {showPrepararObra && !project.zoneId && (
              <label className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
                <span className="font-semibold text-slate-700">Zona de preços</span>
                <select value={project.zoneId ?? ""} disabled={savingZone} onChange={(e) => handleZoneChange(e.target.value)} className="input max-w-xs">
                  <option value="">Definir zona</option>
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>{z.name}</option>
                  ))}
                </select>
              </label>
            )}
            <section className="card overflow-hidden">
              <SectionHeader
                title="Orçamentos"
                actions={
                  <button type="button" onClick={() => void handleCreateQuickBudget()} className="btn btn-primary btn-sm">
                    <IconPlus className="h-4 w-4" /> Novo orçamento
                  </button>
                }
              />
              <ul>
                {budgetDocuments.map((d) => {
                  const sourceMeasurement = d.sourceMeasurementDocumentId
                    ? measurementDocuments.find((m) => m.id === d.sourceMeasurementDocumentId)
                    : undefined;
                  return (
                    <li key={d.id} className="table-row group">
                      <Link to={`/documentos/${d.id}${faseQuery}`} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <span className="min-w-0">
                          <span className="block break-words font-medium text-gray-900">
                            {d.title}
                            {d.revision ? <span className="font-normal text-gray-400"> · rev. {d.revision}</span> : null}
                          </span>
                          {sourceMeasurement && (
                            <span className="mt-0.5 block text-xs text-slate-500">Origem: {sourceMeasurement.title}</span>
                          )}
                        </span>
                        <span className="flex shrink-0 flex-wrap items-center gap-2">
                          <span className="badge badge-gray">{d.currency}</span>
                          <span className={`badge ${DOC_STATUS_BADGE[d.status] ?? "badge-gray"}`}>{d.status}</span>
                          <span className="btn btn-secondary btn-sm pointer-events-none">Abrir</span>
                          <button onClick={(e) => handleDeleteDocument(e, d.id, d.title)} className="icon-btn-danger opacity-0 pointer-coarse:opacity-100 group-hover:opacity-100" title="Eliminar">
                            <IconTrash className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      </Link>
                    </li>
                  );
                })}
                {budgetDocuments.length === 0 && (
                  <li className="px-5 py-10 text-center">
                    <p className="text-sm text-slate-500">Sem orçamentos</p>
                    <button type="button" onClick={() => void handleCreateQuickBudget()} className="btn btn-primary btn-sm mt-4">
                      <IconPlus className="h-4 w-4" /> Novo orçamento
                    </button>
                  </li>
                )}
              </ul>
            </section>
          </>
        )}

        {/* ——— Visão geral ——— */}
        {isVisao && (
          <>
            {showMetricCards && (
              <section className="card overflow-hidden">
                <div className="grid gap-px bg-slate-200 sm:grid-cols-3">
                  {[
                    ["Medi��es", measurementDocuments.length],
                    ["Orçamentos", budgetDocuments.length],
                    ["Plantas", plants.length],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="bg-white px-5 py-4">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
                      <strong className="mt-1 block text-2xl text-slate-950">{value}</strong>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {showMedicao && (
              <section className="card">
                <SectionHeader
                  title="Medi��es"
                  actions={
                    <Link to={`/projectos/${projectId}?fase=medicao`} className="btn btn-ghost btn-sm">
                      Abrir →
                    </Link>
                  }
                />
                <ul>
                  {measurementDocuments.slice(0, 5).map((d) => (
                    <li key={d.id} className="table-row">
                      <Link to={`/documentos/${d.id}?fase=medicao`} className="flex items-center justify-between gap-3 px-5 py-3">
                        <span className="truncate font-medium text-gray-900">{d.title}</span>
                        <span className={`badge ${DOC_STATUS_BADGE[d.status] ?? "badge-gray"}`}>{d.status}</span>
                      </Link>
                    </li>
                  ))}
                  {measurementDocuments.length === 0 && <li className="px-5 py-4 text-sm text-slate-400">Sem Medi��es</li>}
                </ul>
              </section>
            )}

            {showOrcamento && (
              <section className="card">
                <SectionHeader
                  title="Orçamentos"
                  actions={
                    <Link to={`/projectos/${projectId}?fase=orcamento`} className="btn btn-ghost btn-sm">
                      Abrir →
                    </Link>
                  }
                />
                <ul>
                  {budgetDocuments.slice(0, 5).map((d) => (
                    <li key={d.id} className="table-row">
                      <Link to={`/documentos/${d.id}?fase=orcamento`} className="flex items-center justify-between gap-3 px-5 py-3">
                        <span className="truncate font-medium text-gray-900">{d.title}</span>
                        <span className={`badge ${DOC_STATUS_BADGE[d.status] ?? "badge-gray"}`}>{d.status}</span>
                      </Link>
                    </li>
                  ))}
                  {budgetDocuments.length === 0 && <li className="px-5 py-4 text-sm text-slate-400">Sem orçamentos</li>}
                </ul>
              </section>
            )}

            {showPlantas && plants.length > 0 && (
              <section className="card">
                <SectionHeader title="Plantas" />
                <ul>
                  {plants.slice(0, 4).map((p) => (
                    <li key={p.id} className="table-row">
                      {p.processingStatus === "concluido" ? (
                        <Link to={`/plantas/${p.id}`} className="flex items-center justify-between gap-3 px-5 py-3">
                          <span className="truncate text-sm font-medium text-gray-900">{p.originalFileName}</span>
                          <span className={`badge ${PLANT_STATUS_BADGE[p.processingStatus].cls}`}>{PLANT_STATUS_BADGE[p.processingStatus].label}</span>
                        </Link>
                      ) : (
                        <div className="flex items-center justify-between gap-3 px-5 py-3">
                          <span className="truncate text-sm text-gray-500">{p.originalFileName}</span>
                          <span className={`badge ${PLANT_STATUS_BADGE[p.processingStatus].cls}`}>{PLANT_STATUS_BADGE[p.processingStatus].label}</span>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {showMaterials && (
              <details className="card overflow-hidden">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4">
                  <span>
                    <strong className="block text-sm text-slate-900">Materiais especificados</strong>
                    <small className="mt-0.5 block text-slate-500">{materialSpecifications.length}</small>
                  </span>
                </summary>
                <div className="flex justify-end border-t border-slate-100 px-4 py-3">
                  <Link to="/catalogo" className="btn btn-secondary btn-sm">Catálogo</Link>
                </div>
                {materialSpecifications.length > 0 && (
                  <div className="divide-y divide-slate-100 border-t border-slate-100">
                    {materialSpecifications.map((material) => (
                      <div key={material.id} className="grid gap-1 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_7rem_10rem] sm:items-center">
                        <div className="min-w-0">
                          <strong className="block truncate text-sm text-slate-900">{material.name}</strong>
                          {material.specification && <span className="block truncate text-xs text-slate-500">{material.specification}</span>}
                        </div>
                        <span className="text-sm text-slate-500">{material.unit}</span>
                        <span className={`badge w-fit ${material.pricePending ? "badge-yellow" : "badge-green"}`}>
                          {material.pricePending ? "Preço pendente" : "Com preço"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <form onSubmit={handleAddMaterial} className="grid gap-2 border-t border-slate-100 p-4 sm:grid-cols-[1fr_7rem_1.2fr_auto]">
                  <input required value={newMaterial.name} onChange={(event) => setNewMaterial({ ...newMaterial, name: event.target.value })} className="input" placeholder="Material" />
                  <select value={newMaterial.unit} onChange={(event) => setNewMaterial({ ...newMaterial, unit: event.target.value as Unit })} className="input">
                    {UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                  </select>
                  <input value={newMaterial.specification} onChange={(event) => setNewMaterial({ ...newMaterial, specification: event.target.value })} className="input" placeholder="Especificação" />
                  <button type="submit" disabled={addingMaterial} className="btn btn-secondary"><IconPlus className="h-4 w-4" /> Adicionar</button>
                </form>
              </details>
            )}
          </>
        )}

        {/* ——— Gestão ——— */}
        {fase === "gestao" && showCertificados && (
        <section id="certificados-obra" className="card scroll-mt-24">
          <SectionHeader title="Autos de medição" actions={<IconClipboard className="h-4 w-4 text-blue-700" />} />
          {approvedBudgetDocuments.length === 0 ? (
            <div className="border-t border-gray-100 px-5 py-4 text-sm text-slate-600">
              <p>Aprove um orçamento para abrir o primeiro Auto de Medição.</p>
              <Link to={`/projectos/${projectId}?fase=orcamento`} className="action-link mt-2 inline-block">Ir a orçamentos →</Link>
            </div>
          ) : (
          <div className="grid md:grid-cols-2">
            <ul className="border-gray-100 md:border-r">
              {certificates.map((c) => (
                <li key={c.id} className="table-row group">
                  <Link to={`/autos/${c.id}`} className="flex items-center justify-between px-5 py-3">
                    <span className="font-medium text-gray-900">
                      Auto n.º {c.number} <span className="font-normal text-gray-400">— {c.periodDate}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className={`badge ${DOC_STATUS_BADGE[c.status] ?? "badge-gray"}`}>{c.status}</span>
                      <button onClick={(e) => handleDeleteCertificate(e, c.id, c.number)} className="icon-btn-danger opacity-0 pointer-coarse:opacity-100 group-hover:opacity-100" title="Eliminar">
                        <IconTrash className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  </Link>
                </li>
              ))}
              {certificates.length === 0 && <li className="px-5 py-4 text-sm text-gray-400">Ainda não há autos de medição.</li>}
            </ul>
            <form onSubmit={handleCreateCertificate} className="flex flex-wrap items-end gap-2 px-5 py-4">
              <div className="min-w-[160px] flex-1">
                <label className="label">Orçamento base</label>
                <select value={selectedDocId} onChange={(e) => setSelectedDocId(e.target.value)} className="input">
                  {approvedBudgetDocuments.map((d) => (
                    <option key={d.id} value={d.id}>{d.title}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Data do período</label>
                <input type="date" value={periodDate} onChange={(e) => setPeriodDate(e.target.value)} className="input" />
              </div>
              <button type="submit" className="btn btn-primary" disabled={!selectedDocId}>
                <IconPlus className="h-4 w-4" /> Novo auto
              </button>
            </form>
          </div>
          )}
        </section>
        )}
      </div>
      {(uploading || reprocessingPlantId) && (
        <BlockingProcessingOverlay
          title={reprocessingPlantId ? "A repetir a análise" : "A analisar o projecto"}
          stage={(reprocessProgress ?? uploadProgress)?.processingStage}
          detail={(reprocessProgress ?? uploadProgress)?.processingCurrentPage && (reprocessProgress ?? uploadProgress)?.processingTotalPages
            ? `Página ${(reprocessProgress ?? uploadProgress)!.processingCurrentPage} de ${(reprocessProgress ?? uploadProgress)!.processingTotalPages}`
            : project?.name}
          percent={(reprocessProgress ?? uploadProgress)?.processingProgress ?? 1}
        />
      )}
      {dialog}
      {showPublicShare && <PublicShareModal projectId={projectId!} onClose={() => setShowPublicShare(false)} />}
    </Layout>
  );
}

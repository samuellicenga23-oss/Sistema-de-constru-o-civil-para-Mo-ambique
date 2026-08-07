import { useEffect, useState, type FormEvent, type MouseEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { boqApi, type BudgetDocument, type Project, type ProjectMaterialSpecification, type ProjectWorkflowStatus } from "../api/boq";
import { measurementApi, type MeasurementCertificate } from "../api/measurement";
import { plantsApi, type Plant, type PlantProcessingProgress } from "../api/plants";
import { catalogApi, type PriceZone } from "../api/catalog";
import { suppliersApi } from "../api/suppliers";
import Layout from "../components/Layout";
import PlantUploadProgress from "../components/PlantUploadProgress";
import { useConfirmDialog } from "../hooks/useConfirmDialog";
import { usePlantPolling } from "../hooks/usePlantPolling";
import { SectionHeader } from "../components/WorkspaceUI";
import ProjectWorkspaceNav from "../components/ProjectWorkspaceNav";
import ProjectWorkflowBanner from "../components/ProjectWorkflowBanner";
import PublicShareModal from "../components/PublicShareModal";
import { IconDoc, IconClipboard, IconMap, IconPlus, IconRuler, IconTrash, IconUpload } from "../components/icons";
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
  const [title, setTitle] = useState("Mapa de Quantidades");
  const [template, setTemplate] = useState<"padrao" | "vazio">("padrao");
  const [selectedDocId, setSelectedDocId] = useState("");
  const [periodDate, setPeriodDate] = useState(todayStr());
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<PlantProcessingProgress | null>(null);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [preparingMeasurements, setPreparingMeasurements] = useState(false);
  const [reprocessingPlantId, setReprocessingPlantId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [costReadiness, setCostReadiness] = useState({ materials: 0, quoted: 0, zonePriced: 0, suppliers: 0, compositions: 0 });
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
    const [catalogMaterials, supplierList, compositionList] = await Promise.all([
      catalogApi.listMaterials(proj.zoneId ?? undefined),
      suppliersApi.list(),
      catalogApi.listCompositions(proj.zoneId ?? undefined),
    ]);
    setCostReadiness({
      materials: catalogMaterials.length,
      quoted: catalogMaterials.filter((material) => material.marketPrice != null).length,
      zonePriced: catalogMaterials.filter((material) => proj.zoneId ? material.zonePrice != null : Number(material.baseUnitCost) > 0).length,
      suppliers: supplierList.length,
      compositions: compositionList.length,
    });
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

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!projectId) return;
    setError(null);
    try {
      await boqApi.createBudgetDocument(projectId, { title, template, documentType: "orcamento" });
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
    setUploadNotice(null);
    try {
      const uploaded = await plantsApi.upload(projectId, file, "auto", setUploadProgress);
      setPlants((current) => current.some((plant) => plant.id === uploaded.id) ? current : [...current, uploaded]);
      fileInput.value = "";
      setUploadProgress(null);
      setUploadNotice(`“${file.name}” carregado. Pode continuar a trabalhar; avisaremos quando a leitura terminar.`);
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
      navigate(project?.measurementMode === "importar" ? `/documentos/${document.id}` : `/documentos/${document.id}?assistente=1`);
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
        setPlants((current) => current.map((plant) => plant.id === id ? { ...plant, ...progress } : plant));
      });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível reprocessar a planta");
    } finally {
      setReprocessingPlantId(null);
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

  const faseParam = searchParams.get("fase");
  const fase: "medicao" | "orcamento" | "gestao" | "hibrido" =
    faseParam === "gestao"
      ? "gestao"
      : faseParam === "medicao" || faseParam === "orcamento"
        ? faseParam
        : project.projectType === "medicao"
          ? "medicao"
          : project.projectType === "orcamento"
            ? "orcamento"
            : "hibrido";
  // Em projectos híbridos, o hub deve mostrar medições E orçamentos mesmo quando
  // se entra a partir de /medicoes ou /orcamentos (fase filtrada).
  const isHibrido = project.projectType === "hibrido";
  const showMedicao = fase === "medicao" || fase === "hibrido" || fase === "gestao" || isHibrido;
  const showOrcamento = fase === "orcamento" || fase === "hibrido" || fase === "gestao" || isHibrido;
  // Plantas e preparação de preços são o ponto de partida da obra — não esconder
  // só porque se entrou por Orçamentos; em gestão mantêm-se acessíveis.
  const showPlantas = fase !== "gestao" || usesPlants || plants.length > 0;
  const showPrepararObra = fase !== "gestao";
  const showCertificados = fase === "gestao" || (fase === "orcamento" && approvedBudgetDocuments.length > 0);

  const workflowSteps = fase === "orcamento"
    ? [
        { label: "1. Projecto", detail: "Dados da obra registados", done: true },
        { label: "2. Preços", detail: project.zoneId ? "Zona definida" : "Definir zona e cotações", done: Boolean(project.zoneId) },
        { label: "3. Orçamento", detail: budgetDocuments.length ? "Mapa criado" : "Criar ou receber da medição", done: budgetDocuments.length > 0 },
        { label: "4. Aprovar", detail: approvedBudgetDocuments.length ? "Pronto para gestão" : "Submeter e aprovar", done: approvedBudgetDocuments.length > 0 },
      ]
    : usesPlants
      ? [
          { label: "1. Identificar a obra", detail: "Projecto criado", done: true },
          { label: "2. Carregar projectos", detail: plants.length ? `${plants.length} ficheiro(s)` : "Arquitectura, estrutura ou ambos", done: plants.length > 0 },
          { label: "3. Confirmar dados", detail: failedPlants.length ? `${failedPlants.length} ficheiro(s) requerem atenção` : completedPlants.length ? "Dados prontos para revisão" : "A aguardar análise", done: completedPlants.length > 0 && failedPlants.length === 0 },
          { label: "4. Medir", detail: hasMeasuredBudget ? "Quantidades prontas" : "Diagnóstico antes do cálculo", done: hasMeasuredBudget },
          ...(fase === "medicao"
            ? [{ label: "5. Enviar a orçamentos", detail: budgetDocuments.length ? "Já enviado" : "Aprovar medição e criar orçamento", done: budgetDocuments.length > 0 }]
            : [{ label: "5. Orçamentar", detail: budgetDocuments.length ? "Medição ligada ao orçamento" : "Enviar quando a medição estiver pronta", done: budgetDocuments.length > 0 }]),
        ]
      : [
          { label: "1. Projecto", detail: "Dados da obra registados", done: true },
          { label: "2. Medições", detail: project.measurementMode === "importar" ? "Quantidades importadas do Excel" : "Introdução manual no assistente", done: project.measurementMode === "importar" || hasMeasuredBudget },
          ...(fase === "medicao"
            ? [{ label: "3. Enviar a orçamentos", detail: budgetDocuments.length ? "Já enviado" : "Aprovar e criar orçamento", done: budgetDocuments.length > 0 }]
            : [{ label: "3. Orçamento", detail: "Rever quantidades, preços e percentagens", done: hasMeasuredBudget }]),
        ];
  const completedWorkflowSteps = workflowSteps.filter((step) => step.done).length;
  const workflowProgress = Math.round((completedWorkflowSteps / workflowSteps.length) * 100);

  const backTo =
    fase === "gestao" ? "/gestao" : fase === "medicao" ? "/medicoes" : fase === "orcamento" ? "/orcamentos" : project.projectType === "medicao" ? "/medicoes" : "/orcamentos";
  const backLabel = fase === "gestao" ? "Gestão" : fase === "medicao" ? "Medições" : "Orçamentos";
  const navMode = fase === "gestao" ? "site" : fase === "medicao" ? "measurement" : "budget";
  const faseQuery = fase === "gestao" ? "?fase=gestao" : `?fase=${fase === "hibrido" ? "orcamento" : fase}`;

  return (
    <Layout
      title={project.name}
      back={{ label: backLabel, fallbackTo: backTo }}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {user?.role === "admin_empresa" && (
            <button type="button" onClick={() => setShowPublicShare(true)} className="btn btn-secondary btn-sm">
              Partilhar com o dono da obra
            </button>
          )}
          {approvedBudgetDocuments.length > 0 && fase !== "gestao" && (
            <Link to={`/projectos/${projectId}?fase=gestao`} className="btn btn-primary btn-sm">
              Abrir gestão da obra
            </Link>
          )}
        </div>
      }
    >
      <div className="mx-auto grid w-full max-w-7xl items-start gap-5 xl:grid-cols-2">
        <div className="xl:col-span-2">
          <ProjectWorkspaceNav projectId={projectId!} mode={navMode} />
        </div>
        {error && <p className="text-sm text-red-600 xl:col-span-2">{error}</p>}
        {uploadNotice && <p className="text-sm text-emerald-700 xl:col-span-2">{uploadNotice}</p>}
        {searchParams.get("uploadErro") === "1" && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 xl:col-span-2">
            {searchParams.get("motivo") === "excel"
              ? "O projecto foi criado, mas a importação Excel falhou. Abra o mapa de quantidades e importe novamente — confirme os nomes das secções/folhas."
              : searchParams.get("motivo") === "planta"
                ? "O projecto foi criado, mas um PDF não pôde ser analisado. Reveja o ficheiro abaixo ou continue com medição manual / Excel."
                : "O projecto foi criado, mas um passo falhou. O registo da obra está seguro — siga as indicações abaixo."}
          </div>
        )}

        <ProjectWorkflowBanner status={workflowStatus} projectId={projectId!} />

        {(fase === "medicao" || fase === "hibrido" || (fase === "orcamento" && usesPlants && !budgetDocuments.length)) && (
        <section className="card order-2 overflow-hidden xl:col-span-2">
          <div className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-bold text-slate-950">{usesPlants ? "Preparação da obra" : project.measurementMode === "importar" ? "Medições importadas" : "Medição manual"}</h2>
                <span className="text-xs font-semibold text-slate-500">{completedWorkflowSteps}/{workflowSteps.length}</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-brand-600" style={{ width: `${workflowProgress}%` }} />
              </div>
            </div>
            <div className="shrink-0">
            {
              !usesPlants ? (
                <button onClick={handlePrepareMeasurements} disabled={preparingMeasurements} className="btn btn-primary btn-sm">
                  <IconRuler className="h-3.5 w-3.5" />
                  {preparingMeasurements ? "A abrir..." : "Abrir medições"}
                </button>
              ) : completedPlants.length > 0 ? (
                <button onClick={handlePrepareMeasurements} disabled={preparingMeasurements} className="btn btn-primary btn-sm">
                  <IconRuler className="h-3.5 w-3.5" />
                  {preparingMeasurements ? "A preparar..." : hasMeasuredBudget ? "Rever medições" : "Preparar medições"}
                </button>
              ) : (
                <a href="#plantas-do-projecto" className="btn btn-primary btn-sm">
                  <IconUpload className="h-3.5 w-3.5" /> Carregar plantas
                </a>
              )
            }
            </div>
          </div>
          <div className="flex overflow-x-auto border-t border-slate-100 px-4 py-3">
            {workflowSteps.map((step) => (
              <div key={step.label} className="flex shrink-0 items-center gap-2 pr-5 text-xs">
                <span className={`grid h-5 w-5 place-items-center rounded-full font-bold ${step.done ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{step.done ? "✓" : "·"}</span>
                <span className={step.done ? "font-semibold text-slate-700" : "text-slate-500"}>{step.label.replace(/^\d+\.\s*/, "")}</span>
              </div>
            ))}
          </div>
          {usesPlants && latestCompletedPlant && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3 text-xs text-slate-600">
              <span>Último ficheiro analisado: <strong className="text-slate-800">{latestCompletedPlant.originalFileName}</strong></span>
              <Link to={`/plantas/${latestCompletedPlant.id}`} className="font-semibold text-brand-700 hover:underline">Rever dados extraídos →</Link>
            </div>
          )}
        </section>
        )}

        {fase === "orcamento" && (
        <section className="card order-2 overflow-hidden xl:col-span-2">
          <div className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-bold text-slate-950">Fluxo de orçamento</h2>
                <span className="text-xs font-semibold text-slate-500">{completedWorkflowSteps}/{workflowSteps.length}</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-brand-600" style={{ width: `${workflowProgress}%` }} />
              </div>
            </div>
          </div>
          <div className="flex overflow-x-auto border-t border-slate-100 px-4 py-3">
            {workflowSteps.map((step) => (
              <div key={step.label} className="flex shrink-0 items-center gap-2 pr-5 text-xs">
                <span className={`grid h-5 w-5 place-items-center rounded-full font-bold ${step.done ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{step.done ? "✓" : "·"}</span>
                <span className={step.done ? "font-semibold text-slate-700" : "text-slate-500"}>{step.label.replace(/^\d+\.\s*/, "")}</span>
              </div>
            ))}
          </div>
        </section>
        )}

        <details className="card order-6 overflow-hidden xl:col-span-2">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4">
            <span>
              <strong className="block text-sm text-slate-900">Materiais especificados</strong>
              <small className="mt-0.5 block text-slate-500">{materialSpecifications.length} material(is) associado(s) ao projecto</small>
            </span>
            <span className="badge badge-gray">Ver e editar</span>
          </summary>
          <div className="flex justify-end border-t border-slate-100 px-4 py-3">
            <Link to="/catalogo" className="btn btn-secondary btn-sm">Abrir catálogo</Link>
          </div>
          {materialSpecifications.length > 0 && (
            <div className="divide-y divide-slate-100 border-t border-slate-100">
              {materialSpecifications.map((material) => (
                <div key={material.id} className="grid gap-1 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_7rem_10rem] sm:items-center">
                  <div className="min-w-0"><strong className="block truncate text-sm text-slate-900">{material.name}</strong>{material.specification && <span className="block truncate text-xs text-slate-500">{material.specification}</span>}</div>
                  <span className="text-sm text-slate-500">{material.unit}</span>
                  <span className={`badge w-fit ${material.pricePending ? "badge-yellow" : "badge-green"}`}>{material.pricePending ? "Preço pendente" : "Com preço"}</span>
                </div>
              ))}
            </div>
          )}
          <form onSubmit={handleAddMaterial} className="grid gap-2 border-t border-slate-100 p-4 sm:grid-cols-[1fr_7rem_1.2fr_auto]">
            <input required value={newMaterial.name} onChange={(event) => setNewMaterial({ ...newMaterial, name: event.target.value })} className="input" placeholder="Material" />
            <select value={newMaterial.unit} onChange={(event) => setNewMaterial({ ...newMaterial, unit: event.target.value as Unit })} className="input">
              {UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
            </select>
            <input value={newMaterial.specification} onChange={(event) => setNewMaterial({ ...newMaterial, specification: event.target.value })} className="input" placeholder="Classe, dimensões, acabamento ou norma" />
            <button type="submit" disabled={addingMaterial} className="btn btn-secondary"><IconPlus className="h-4 w-4" /> Adicionar</button>
          </form>
        </details>

        <section className="card order-1 overflow-hidden xl:col-span-2">
          <div className={`grid gap-px bg-slate-200 sm:grid-cols-3 ${showPrepararObra ? "xl:grid-cols-[0.8fr_0.8fr_0.8fr_1.8fr]" : "xl:grid-cols-3"}`}>
            {(fase === "orcamento"
              ? [
                  ["Orçamentos", budgetDocuments.length],
                  ["Aprovados", approvedBudgetDocuments.length],
                  ["Medições origem", measurementDocuments.length],
                ]
              : [
                  ["Medições", measurementDocuments.length],
                  ...(showOrcamento ? [["Orçamentos", budgetDocuments.length] as const] : [["A enviar", budgetDocuments.length ? "Sim" : "Não"] as const]),
                  ["Plantas", plants.length],
                ]
            ).map(([label, value]) => (
              <div key={String(label)} className="bg-white px-5 py-4">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
                <strong className="mt-1 block text-2xl text-slate-950">{value}</strong>
              </div>
            ))}
            {showPrepararObra && (
            <label className="bg-white px-5 py-4 sm:col-span-3 xl:col-span-1">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Zona de preços</span>
              <select
                value={project.zoneId ?? ""}
                disabled={savingZone}
                onChange={(e) => handleZoneChange(e.target.value)}
                className="input"
              >
                <option value="">Sem zona definida</option>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>{z.name}</option>
                ))}
              </select>
            </label>
            )}
          </div>
        </section>

        {showPrepararObra && (
        <details
          id="preparar-obra"
          open={!project.zoneId || costReadiness.compositions === 0 || (costReadiness.suppliers > 0 && costReadiness.quoted === 0)}
          className="card order-2 overflow-hidden xl:col-span-2"
        >
          <summary className="cursor-pointer list-none px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong className="text-slate-900">Preparar obra (antes das medições e orçamentos)</strong>
              <span className="text-xs text-slate-500">Zona · cotações · composições · capítulos com custo</span>
            </div>
          </summary>
          <div className="border-t border-slate-200 px-5 py-3 text-sm text-slate-600">
            Faça isto uma vez por obra. Depois pode criar várias medições e vários orçamentos/cenários sem repetir a preparação de preços.
          </div>
          <div className="grid gap-px border-t border-slate-200 bg-slate-200 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { n: 1, title: "Zona da obra", value: project.zoneId ? "Definida" : "Em falta", detail: project.zoneId ? zones.find((zone) => zone.id === project.zoneId)?.name ?? "Zona seleccionada" : "Defina a zona no cartão de dados da obra.", ok: Boolean(project.zoneId), href: undefined as string | undefined },
              { n: 2, title: "Cotações de materiais", value: `${costReadiness.quoted}/${costReadiness.materials}`, detail: `${costReadiness.suppliers} cotação(ões) de mercado; materiais com preço aplicável.`, ok: costReadiness.suppliers > 0 && costReadiness.quoted > 0, href: "/gestao/cotacoes" },
              { n: 3, title: "Preços adoptados", value: `${costReadiness.zonePriced}/${costReadiness.materials}`, detail: project.zoneId ? "Preços próprios da zona; restantes usam preço base." : "A aguardar zona para validar cobertura.", ok: Boolean(project.zoneId) && costReadiness.zonePriced === costReadiness.materials, href: "/catalogo" },
              { n: 4, title: "Composições / capítulos", value: String(costReadiness.compositions), detail: "Ligue capítulos a composições no Catálogo para o custo unitário entrar no orçamento.", ok: costReadiness.compositions > 0, href: "/catalogo" },
            ].map((item) => (
              <div key={item.n} className="bg-white p-4">
                <div className="flex items-center gap-2">
                  <span className={`grid h-6 w-6 place-items-center rounded-full text-xs font-bold ${item.ok ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{item.ok ? "✓" : item.n}</span>
                  <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                </div>
                <p className="mt-2 text-lg font-bold text-slate-900">{item.value}</p>
                <p className="mt-1 text-xs text-slate-500">{item.detail}</p>
                {item.href && !item.ok && (
                  <Link to={item.href} className="mt-2 inline-block text-xs font-semibold text-brand-700 hover:underline">
                    Resolver →
                  </Link>
                )}
              </div>
            ))}
          </div>
        </details>
        )}

        {/* Medições técnicas */}
        {showMedicao && (
        <section className="card order-3">
          <SectionHeader title="Medições" description="Quantidades, memória de cálculo e origem dos dados — sem preços" actions={<IconRuler className="w-4 h-4 text-blue-700" />} />
          <ul>
            {measurementDocuments.map((d) => (
              <li key={d.id} className="table-row group">
                <Link to={`/documentos/${d.id}${faseQuery}`} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <span className="min-w-0 break-words font-medium text-gray-900">{d.title} {d.revision ? <span className="font-normal text-gray-400">rev. {d.revision}</span> : ""}</span>
                  <span className="flex shrink-0 flex-wrap items-center gap-2">
                    <span className="badge badge-brand">Quantidades</span>
                    <span className={`badge ${DOC_STATUS_BADGE[d.status] ?? "badge-gray"}`}>{d.status}</span>
                    <button onClick={(e) => handleDeleteDocument(e, d.id, d.title)} className="icon-btn-danger opacity-0 pointer-coarse:opacity-100 group-hover:opacity-100" title="Eliminar medição"><IconTrash className="h-3.5 w-3.5" /></button>
                  </span>
                </Link>
              </li>
            ))}
            {measurementDocuments.length === 0 && <li className="px-5 py-4 text-sm text-gray-400">Sem medição técnica. Prepare uma a partir das plantas ou manualmente.</li>}
          </ul>
        </section>
        )}

        {/* Orçamentos */}
        {showOrcamento && (
        <section className="card order-3">
          <SectionHeader title="Orçamentos" description="Cenários comerciais a partir das medições — sem repetir quantidades" actions={<IconDoc className="w-4 h-4 text-blue-700" />} />
          <ul>
            {budgetDocuments.map((d) => {
              const sourceMeasurement = d.sourceMeasurementDocumentId
                ? measurementDocuments.find((m) => m.id === d.sourceMeasurementDocumentId)
                : undefined;
              const siblingCount = d.sourceMeasurementDocumentId
                ? budgetDocuments.filter((other) => other.sourceMeasurementDocumentId === d.sourceMeasurementDocumentId).length
                : 0;
              return (
              <li key={d.id} className="table-row group">
                <Link to={`/documentos/${d.id}${faseQuery}`} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <span className="min-w-0">
                    <span className="block break-words font-medium text-gray-900">
                      {d.title} {d.revision ? <span className="text-gray-400 font-normal">rev. {d.revision}</span> : ""}
                    </span>
                    {sourceMeasurement && (
                      <span className="mt-1 block text-xs text-slate-500">
                        A partir de «{sourceMeasurement.title}»
                        {siblingCount > 1 ? ` · ${siblingCount} cenários desta medição` : ""}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 flex-wrap items-center gap-2">
                    {siblingCount > 1 && <span className="badge badge-brand">Cenário</span>}
                    <span className="badge badge-gray">{d.currency}</span>
                    <span className={`badge ${DOC_STATUS_BADGE[d.status] ?? "badge-gray"}`}>{d.status}</span>
                    <button
                      onClick={(e) => handleDeleteDocument(e, d.id, d.title)}
                      className="icon-btn-danger opacity-0 pointer-coarse:opacity-100 group-hover:opacity-100"
                      title="Eliminar documento"
                    >
                      <IconTrash className="w-3.5 h-3.5" />
                    </button>
                  </span>
                </Link>
              </li>
              );
            })}
            {budgetDocuments.length === 0 && <li className="px-5 py-4 text-sm text-gray-400">Sem orçamento. Abra uma medição concluída e escolha “Criar orçamento”. Pode criar vários cenários a partir da mesma medição.</li>}
          </ul>
          <details className="border-t border-gray-100">
            <summary className="cursor-pointer px-5 py-3 text-xs font-semibold text-slate-600 hover:bg-slate-50">Criar outro mapa ou revisão manual</summary>
            <form onSubmit={handleCreate} className="grid gap-3 px-5 pb-5 sm:grid-cols-2">
              <div className="min-w-0">
                <label className="label">Título do novo documento</label>
                <input value={title} onChange={(e) => setTitle(e.target.value)} className="input" />
              </div>
              <div className="min-w-0">
                <label className="label">Modelo</label>
                <select value={template} onChange={(e) => setTemplate(e.target.value as "padrao" | "vazio")} className="input">
                  <option value="padrao">Estrutura SIGO ligada ao catálogo</option>
                  <option value="vazio">Documento vazio/manual</option>
                </select>
              </div>
              <button type="submit" className="btn btn-secondary w-full sm:w-fit"><IconPlus className="w-4 h-4" /> Criar</button>
            </form>
          </details>
        </section>
        )}

        {/* Plantas */}
        {showPlantas && (
        <section id="plantas-do-projecto" className="card order-4 scroll-mt-24">
          <SectionHeader title="Projectos e desenhos" description="Carregue arquitectura, estrutura ou outras disciplinas disponíveis" actions={<IconMap className="w-4 h-4 text-blue-700" />} />
          <ul>
            {plants.map((p) => (
              <li key={p.id} className="table-row group">
                {p.processingStatus === "concluido" ? (
                  <Link to={`/plantas/${p.id}`} className="flex items-center justify-between px-5 py-3">
                    <span className="min-w-0 pr-3">
                      <span className="block font-medium text-gray-900 truncate">{p.originalFileName}</span>
                      {p.documentAnalysis && (
                        <span className="mt-0.5 block text-[11px] leading-4 text-slate-500">
                          {p.documentAnalysis.isMultiDiscipline ? "Projecto completo" : p.documentAnalysis.sections[0]?.label ?? "PDF"}
                          {` · ${p.documentAnalysis.pageCount} páginas`}
                          {p.documentAnalysis.sections.map((section) => ` · ${section.label} ${sectionPages(section.startPage, section.endPage)}`).join("")}
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      {p.documentAnalysis?.isMultiDiscipline && <span className="badge badge-brand">{p.documentAnalysis.sections.length} secções</span>}
                      <span className={`badge ${PLANT_STATUS_BADGE[p.processingStatus].cls}`}>{PLANT_STATUS_BADGE[p.processingStatus].label}</span>
                      <button
                        onClick={(e) => handleDeletePlant(e, p.id, p.originalFileName)}
                        className="icon-btn-danger opacity-0 pointer-coarse:opacity-100 group-hover:opacity-100"
                        title="Eliminar planta"
                      >
                        <IconTrash className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  </Link>
                ) : (
                  <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                    <span className="min-w-0 sm:pr-2">
                      <span className="block break-words font-medium text-gray-500 sm:truncate">{p.originalFileName}</span>
                      {p.processingStatus === "processando" && (
                        <span className="block text-[11px] text-blue-700">
                          {p.processingStage ?? "A analisar"}
                          {p.processingCurrentPage && p.processingTotalPages ? ` · página ${p.processingCurrentPage}/${p.processingTotalPages}` : ""}
                        </span>
                      )}
                      {p.processingStatus === "erro" && p.errorMessage && (
                        <span className="mt-0.5 block text-[11px] leading-4 text-red-600">{p.errorMessage}</span>
                      )}
                    </span>
                    <span className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">
                      <span className={`badge ${PLANT_STATUS_BADGE[p.processingStatus].cls}`}>{p.processingStatus === "processando" ? `${p.processingProgress}%` : PLANT_STATUS_BADGE[p.processingStatus].label}</span>
                      {p.processingStatus === "erro" && (
                        <button onClick={(e) => handleReprocessPlant(e, p.id)} disabled={reprocessingPlantId === p.id} className="btn btn-secondary btn-sm">
                          {reprocessingPlantId === p.id ? "A tentar..." : "Tentar novamente"}
                        </button>
                      )}
                      <button
                        onClick={(e) => handleDeletePlant(e, p.id, p.originalFileName)}
                        className="icon-btn-danger opacity-0 pointer-coarse:opacity-100 group-hover:opacity-100"
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
                Carregue um projecto completo ou ficheiros separados. O SIGO identifica as disciplinas e organiza as páginas automaticamente antes do diagnóstico.
              </li>
            )}
          </ul>
          <form onSubmit={handleUploadPlant} className="grid items-end gap-3 border-t border-gray-100 px-4 py-4 sm:px-5 sm:grid-cols-[minmax(0,1fr)_auto]">
            {uploadProgress && <div className="sm:col-span-2"><PlantUploadProgress progress={uploadProgress} compact /></div>}
            {plants.some((p) => p.processingStatus === "processando" || p.processingStatus === "pendente") && (
              <div className="sm:col-span-2">
                {plants.filter((p) => p.processingStatus === "processando" || p.processingStatus === "pendente").map((p) => (
                  <PlantUploadProgress key={p.id} progress={p} compact />
                ))}
              </div>
            )}
            <div className="min-w-0">
              <label className="label">Ficheiro PDF</label>
              <input type="file" name="plantFile" accept="application/pdf" required className="input py-1.5 file:mr-3 file:rounded-md file:border-0 file:bg-brand-100 file:text-brand-800 file:px-2.5 file:py-1 file:text-xs file:font-medium" />
              <p className="mt-1 text-[11px] text-slate-500">Arquitectura, estrutura ou projecto completo — o SIGO detecta automaticamente.</p>
            </div>
            <button type="submit" disabled={uploading} className="btn btn-primary w-full sm:w-auto">
              <IconUpload className="w-4 h-4" />
              {uploading ? "A carregar PDF..." : plants.length > 0 ? "Adicionar PDF" : "Carregar PDF"}
            </button>
          </form>
        </section>
        )}

        {/* Certificados de obra (avanço físico — distinto das medições de projecto) */}
        {showCertificados && (
        <section id="certificados-obra" className="card order-8 xl:col-span-2 scroll-mt-24">
          <SectionHeader
            title="Certificados de obra"
            description="Execução por período ligada ao orçamento aprovado"
            actions={<IconClipboard className="w-4 h-4 text-blue-700" />}
          />
          {approvedBudgetDocuments.length === 0 ? (
            <div className="border-t border-gray-100 px-5 py-4 text-sm text-slate-600">
              <p>Aprove um orçamento para abrir o primeiro Auto de Medição.</p>
              {budgetDocuments[0] && <Link to={`/documentos/${budgetDocuments[0].id}${faseQuery}`} className="action-link mt-2 inline-block">Rever orçamento →</Link>}
              {!budgetDocuments[0] && measurementDocuments[0] && <Link to={`/documentos/${measurementDocuments[0].id}${faseQuery}`} className="action-link mt-2 inline-block">Enviar medição para orçamento →</Link>}
            </div>
          ) : (
          <div className="grid md:grid-cols-2">
            <ul className="md:border-r border-gray-100">
              {certificates.map((c) => (
                <li key={c.id} className="table-row group">
                  <Link to={`/autos/${c.id}`} className="flex items-center justify-between px-5 py-3">
                    <span className="font-medium text-gray-900">
                      Certificado Nº {c.number} <span className="text-gray-400 font-normal">— {c.periodDate}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className={`badge ${DOC_STATUS_BADGE[c.status] ?? "badge-gray"}`}>{c.status}</span>
                      <button
                        onClick={(e) => handleDeleteCertificate(e, c.id, c.number)}
                        className="icon-btn-danger opacity-0 pointer-coarse:opacity-100 group-hover:opacity-100"
                        title="Eliminar certificado"
                      >
                        <IconTrash className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  </Link>
                </li>
              ))}
              {certificates.length === 0 && <li className="px-5 py-4 text-sm text-gray-400">Sem certificados — registe o avanço do 1.º período quando a obra estiver a decorrer.</li>}
            </ul>
            <form onSubmit={handleCreateCertificate} className="flex gap-2 items-end px-5 py-4 flex-wrap">
              <div className="flex-1 min-w-[160px]">
                <label className="label">Orçamento base (contrato)</label>
                <select value={selectedDocId} onChange={(e) => setSelectedDocId(e.target.value)} className="input">
                  {approvedBudgetDocuments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title} {d.status !== "aprovado" ? "(ainda não aprovado)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Data do período</label>
                <input type="date" value={periodDate} onChange={(e) => setPeriodDate(e.target.value)} className="input" />
              </div>
              <button type="submit" className="btn btn-primary" disabled={!selectedDocId}>
                <IconPlus className="w-4 h-4" />
                Novo certificado
              </button>
            </form>
          </div>
          )}
        </section>
        )}
      </div>
      {dialog}
      {showPublicShare && <PublicShareModal projectId={projectId!} onClose={() => setShowPublicShare(false)} />}
    </Layout>
  );
}

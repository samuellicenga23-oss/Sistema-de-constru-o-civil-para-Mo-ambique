import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { boqApi, type BudgetDocumentSummary, type BudgetRepriceResult, type LineItemNode, type MeasurementImportPreview, type MeasurementImportResult, type Project, type ProjectMaterialSpecification } from "../api/boq";
import { catalogApi, type CostComposition } from "../api/catalog";
import { measurementApi, type MeasurementDashboard } from "../api/measurement";
import { plantsApi, type Plant, type ExtractedOpening, type ExtractedRoom } from "../api/plants";
import LineItemRow, { AddChildForm, BoqHeaderRow, BoqTableHead } from "../components/LineItemRow";
import QuickEstimateWizard from "../components/QuickEstimateWizard";
import CalculationReportView from "../components/CalculationReportView";
import MaterialsByPhaseModal from "../components/MaterialsByPhaseModal";
import MeasurementImportReviewModal from "../components/MeasurementImportReviewModal";
import ImportCompositionReviewWizard from "../components/ImportCompositionReviewWizard";
import ConfirmDialog from "../components/ConfirmDialog";
import BudgetRevisionDiffModal from "../components/BudgetRevisionDiffModal";
import ModalPortal from "../components/ModalPortal";
import DocumentReviewModal from "../components/DocumentReviewModal";
import DocumentReviewCommentsPanel from "../components/DocumentReviewCommentsPanel";
import LineItemSidePanel from "../components/LineItemSidePanel";
import Layout from "../components/Layout";
import ProjectWorkspaceNav from "../components/ProjectWorkspaceNav";
import PageSearch from "../components/PageSearch";
import LoadingState from "../components/LoadingState";
import AlertBanner from "../components/AlertBanner";
import ActionMenu from "../components/ActionMenu";
import { useConfirmDialog } from "../hooks/useConfirmDialog";
import { useBoqEditSession } from "../hooks/useBoqEditSession";
import { SectionHeader } from "../components/WorkspaceUI";
import { IconChart, IconClipboard, IconDoc, IconDownload, IconPencil, IconPlus, IconRefresh, IconRuler, IconTrash } from "../components/icons";
import { useAuth } from "../auth/AuthContext";
import { can } from "../permissions";
import { practiceApi } from "../api/practice";
import { companiesApi } from "../api/companies";
import { planUsesDirectDocumentApproval } from "@sigo/shared";
import { collectUnpricedItems, filterTreeToUnpricedOnly } from "../utils/boqHelpers";
import { consumeAssistantSearchParams, documentHasBoqContent, shouldShowPrimaryMeasurementImport } from "../utils/measurementWorkspace";
import { ApiError } from "../api/http";

function money(value: number, currency: string) {
  return `${value.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function ImportCreatedCompositionsNotice({
  result,
  onReviewInsumos,
}: {
  result: MeasurementImportResult;
  onReviewInsumos?: () => void;
}) {
  const created = result.createdCompositions ?? [];
  if (!created.length && !(result.compositionsCreated ?? 0)) return null;
  return (
    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-950">
      <p className="font-semibold text-amber-950">
        {(result.compositionsCreated ?? created.length)} composição(ões) nova(s) — verifique insumos
      </p>
      <p className="mt-1 text-amber-900/90">
        Confirme rendimentos, materiais e preços antes de usar estes valores em orçamento.
      </p>
      {created.length > 0 && (
        <ul className="mt-2.5 max-h-40 space-y-1.5 overflow-y-auto">
          {created.map((comp) => (
            <li key={comp.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <Link to={`/catalogo/composicoes/${comp.id}`} className="font-medium text-brand-800 hover:underline">
                {comp.name}
              </Link>
              {comp.itemCodes.length > 0 ? (
                <span className="text-amber-800/80">item(ns) {comp.itemCodes.join(", ")}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap gap-3">
        {created.length > 0 && onReviewInsumos && (
          <button type="button" onClick={onReviewInsumos} className="text-xs font-semibold text-brand-800 hover:underline">
            Rever insumos agora →
          </button>
        )}
        <Link to="/catalogo" className="text-xs font-semibold text-brand-800 hover:underline">
          Abrir Catálogo de Preços →
        </Link>
      </div>
    </div>
  );
}

function MeasurementImportResultCard({
  result,
  onDismiss,
  onReviewInsumos,
}: {
  result: MeasurementImportResult;
  onDismiss?: () => void;
  onReviewInsumos?: () => void;
}) {
  return (
    <div className="mt-4 space-y-3">
      <AlertBanner tone="success" onDismiss={onDismiss}>
        <p className="font-medium">
          {result.itemsUpdated} actualizado(s), {result.itemsCreated} criado(s) — {result.rowsRead} linha(s) processadas
          {(result.compositionsLinked ?? 0) > 0 ? ` · ${result.compositionsLinked} composição(ões)` : ""}
          {(result.compositionsCreated ?? 0) > 0 ? ` (${result.compositionsCreated} nova(s))` : ""}.
        </p>
      </AlertBanner>
      <ImportCreatedCompositionsNotice result={result} onReviewInsumos={onReviewInsumos} />
      {result.unmatched.length > 0 && (
        <AlertBanner tone="warning">
          <p className="font-medium">{result.unmatched.length} linha(s) não foram aplicadas</p>
          <ul className="mt-1.5 max-h-32 space-y-0.5 overflow-y-auto text-xs">
            {result.unmatched.map((u, i) => (
              <li key={`${u.sheet}-${u.rowNumber}-${i}`}>
                Folha &quot;{u.sheet}&quot;, linha {u.rowNumber}: código &quot;{u.code}&quot;, quantidade {u.quantity} — {u.reason}.
              </li>
            ))}
          </ul>
        </AlertBanner>
      )}
    </div>
  );
}

function countCompositionItems(items: LineItemNode[]): number {
  return items.reduce(
    (total, item) => total + (item.compositionId ? 1 : 0) + countCompositionItems(item.children),
    0,
  );
}

function MeasurementImportForm({
  importing,
  result,
  onSubmit,
  onDismissResult,
  onReviewInsumos,
}: {
  importing: boolean;
  result: MeasurementImportResult | null;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onDismissResult: () => void;
  onReviewInsumos?: () => void;
}) {
  return (
    <div className="px-4 py-4 sm:px-5">
      <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <label className="label">Mapa (Excel ou PDF)</label>
          <input
            type="file"
            name="measurementsFile"
            accept=".xlsx,.xls,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            required
            className="input py-1.5 file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-2.5 file:py-1 file:text-xs file:font-medium file:text-brand-800"
          />
        </div>
        <button type="submit" disabled={importing} className="btn btn-primary shrink-0">
          <IconDownload className="h-3.5 w-3.5" />
          {importing ? "A enviar…" : "Importar mapa"}
        </button>
      </form>
      {result && (
        <MeasurementImportResultCard
          result={result}
          onDismiss={onDismissResult}
          onReviewInsumos={onReviewInsumos}
        />
      )}
    </div>
  );
}

function countTechnicalSpecs(items: LineItemNode[]): number {
  return items.reduce(
    (total, item) => total + (item.technicalSpecification ? 1 : 0) + countTechnicalSpecs(item.children),
    0,
  );
}

function containsBudgetMatch(items: LineItemNode[], needle: string): boolean {
  return items.some((item) =>
    `${item.code ?? ""} ${item.description ?? ""} ${item.unit ?? ""}`.toLocaleLowerCase("pt").includes(needle)
    || containsBudgetMatch(item.children, needle),
  );
}

function normalizePlantKey(value: string | null | undefined) {
  return (value ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLocaleLowerCase("pt");
}

function mergePlantRooms(groups: ExtractedRoom[][]): ExtractedRoom[] {
  const seen = new Set<string>();
  return groups.flat().filter((room) => {
    const key = [normalizePlantKey(room.floor), normalizePlantKey(room.name), normalizePlantKey(room.number), Number(room.areaM2).toFixed(2)].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergePlantOpenings(groups: ExtractedOpening[][]): ExtractedOpening[] {
  const seen = new Set<string>();
  return groups.flat().filter((opening) => {
    const key = opening.code?.trim()
      ? [opening.kind, normalizePlantKey(opening.floor), normalizePlantKey(opening.code)].join("|")
      : `uncoded:${opening.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default function BudgetDocumentPage() {
  const { user } = useAuth();
  const canManageCommercial = can(user, "escritorio.gerir");
  const { documentId } = useParams<{ documentId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { confirm, dialog } = useConfirmDialog();
  const [summary, setSummary] = useState<BudgetDocumentSummary | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [compositions, setCompositions] = useState<CostComposition[]>([]);
  const [dashboard, setDashboard] = useState<MeasurementDashboard | null>(null);
  const [newSectionName, setNewSectionName] = useState("");
  const [addingIn, setAddingIn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorBlockers, setErrorBlockers] = useState<string[]>([]);
  const [showWizard, setShowWizard] = useState(false);
  const [showImportPanel, setShowImportPanel] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showMaterialsByPhase, setShowMaterialsByPhase] = useState(false);
  const [structuralPlant, setStructuralPlant] = useState<Plant | null>(null);
  const [architecturePlant, setArchitecturePlant] = useState<Plant | null>(null);
  const [architectureRooms, setArchitectureRooms] = useState<ExtractedRoom[]>([]);
  const [architectureOpenings, setArchitectureOpenings] = useState<ExtractedOpening[]>([]);
  const [importingMeasurements, setImportingMeasurements] = useState(false);
  const [importResult, setImportResult] = useState<MeasurementImportResult | null>(null);
  const [importPreview, setImportPreview] = useState<MeasurementImportPreview | null>(null);
  const [importJobId, setImportJobId] = useState<string | null>(null);
  const [applyingImport, setApplyingImport] = useState(false);
  const [showImportInsumosWizard, setShowImportInsumosWizard] = useState(false);
  const [showRepriceConfirm, setShowRepriceConfirm] = useState(false);
  const [repricing, setRepricing] = useState(false);
  const [repriceResult, setRepriceResult] = useState<BudgetRepriceResult | null>(null);
  const [plantContextLoading, setPlantContextLoading] = useState(true);
  const [preparingAutomaticDocument, setPreparingAutomaticDocument] = useState(false);
  const [showFinancialSettings, setShowFinancialSettings] = useState(false);
  const [showFinancialSummary, setShowFinancialSummary] = useState(false);
  const [savingFinancialSettings, setSavingFinancialSettings] = useState(false);
  const [itemQuery, setItemQuery] = useState("");
  const [showOnlyUnpriced, setShowOnlyUnpriced] = useState(searchParams.get("semPreco") === "1");
  const [submittingToBudget, setSubmittingToBudget] = useState(false);
  const [revisingDocument, setRevisingDocument] = useState(false);
  const [duplicatingMeasurement, setDuplicatingMeasurement] = useState(false);
  const [materialSpecs, setMaterialSpecs] = useState<ProjectMaterialSpecification[]>([]);
  const [applyingSpecs, setApplyingSpecs] = useState(false);
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [sectionNameDraft, setSectionNameDraft] = useState("");
  const [showCommercialProposal, setShowCommercialProposal] = useState(false);
  const [showRevisionDiff, setShowRevisionDiff] = useState(false);
  const [proposalAttachMode, setProposalAttachMode] = useState<"nada" | "resumo" | "mapa">("resumo");
  const [creatingProposal, setCreatingProposal] = useState(false);
  const [directApproval, setDirectApproval] = useState(false);

  useEffect(() => {
    companiesApi
      .me()
      .then((data) => setDirectApproval(planUsesDirectDocumentApproval(data.subscription?.plan ?? data.company.subscription?.plan)))
      .catch(() => setDirectApproval(false));
  }, []);

  async function handleGenerateCommercialProposal() {
    if (!documentId) return;
    setCreatingProposal(true);
    setError(null);
    try {
      const quote = await practiceApi.createQuoteFromBudget({
        documentId,
        attachMode: proposalAttachMode,
        assignNumber: true,
      });
      setShowCommercialProposal(false);
      navigate(`/escritorio?tab=propostas&quote=${quote.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao gerar proposta comercial");
    } finally {
      setCreatingProposal(false);
    }
  }

  async function reload() {
    if (!documentId) return;
    const s = await boqApi.getBudgetDocumentSummary(documentId);
    setSummary(s);
    setDashboard(await measurementApi.dashboard(s.document.projectId, documentId));
    boqApi.listProjectMaterialSpecifications(s.document.projectId).then(setMaterialSpecs).catch(() => setMaterialSpecs([]));
  }

  const canDraftEdit = Boolean(summary) && user?.role !== "visualizador" && summary?.document.status === "rascunho";
  const editSession = useBoqEditSession({
    documentId,
    summary,
    enabled: canDraftEdit,
    onSaved: (next) => {
      setSummary(next);
      void reload();
    },
    onReload: reload,
    onError: setError,
  });

  useEffect(() => {
    if (!documentId) return;
    setPlantContextLoading(true);
    setStructuralPlant(null);
    setArchitecturePlant(null);
    setArchitectureRooms([]);
    setArchitectureOpenings([]);
    boqApi
      .getBudgetDocumentSummary(documentId)
      .then(async (s) => {
        setSummary(s);
        const projectData = await boqApi.getProject(s.document.projectId);
        setProject(projectData);
        const [c, d, plantDetails] = await Promise.all([
          catalogApi.listCompositions(projectData.zoneId ?? undefined),
          measurementApi.dashboard(s.document.projectId, documentId),
          plantsApi.listDetails(s.document.projectId),
        ]);
        setCompositions(c);
        setDashboard(d);
        const processedDetails = plantDetails.filter(({ plant: p }) =>
          p.processingStatus === "concluido"
          && (!p.documentAnalysis?.requiresIdentityConfirmation || p.documentAnalysis.identityConfirmed),
        );
        const newestFirst = [...processedDetails].reverse();

        // A planta estrutural é escolhida pelo que ela TEM (resumo estrutural real), não só
        // pela etiqueta de disciplina escolhida ao carregar — o extractor lê o que encontrar no
        // ficheiro independentemente da etiqueta (ver Ronda 12), por isso um ficheiro estrutural
        // com a disciplina trocada por engano (ex: carregado como "arquitectura") não pode
        // deixar de alimentar o Assistente só por causa da etiqueta errada.
        const structural =
          newestFirst.find(({ plant: p }) => p.discipline === "estrutura" && p.structuralSummary) ??
          newestFirst.find(({ plant: p }) => p.structuralSummary);
        setStructuralPlant(structural?.plant ?? null);

        // Um projecto pode distribuir pisos e mapas de vãos por vários PDFs. Consolidar todos
        // os ficheiros válidos evita que o primeiro PDF com salas esconda portas/janelas que só
        // aparecem noutra prancha ou num mapa separado.
        const architectural = newestFirst.filter(({ rooms, openings }) => rooms.length > 0 || openings.length > 0);
        const needsOpeningReview = architectural.find(({ openings }) => openings.some((opening) =>
          opening.needsConfirmation || !opening.widthM || !opening.heightM || opening.location === "desconhecida",
        ));
        setArchitecturePlant(needsOpeningReview?.plant ?? architectural[0]?.plant ?? null);
        setArchitectureRooms(mergePlantRooms(architectural.map(({ rooms }) => rooms)));
        setArchitectureOpenings(mergePlantOpenings(architectural.map(({ openings }) => openings)));
      })
      .catch((err) => setError(err.message))
      .finally(() => setPlantContextLoading(false));
  }, [documentId]);

  useEffect(() => {
    if (searchParams.get("semPreco") === "1") setShowOnlyUnpriced(true);
  }, [searchParams]);

  useEffect(() => {
    if (!summary || searchParams.get("semPreco") !== "1") return;
    const first = summary.sections.flatMap((s) => collectUnpricedItems(s.items, s.name))[0];
    if (!first) return;
    requestAnimationFrame(() => {
      globalThis.document.getElementById(`line-item-${first.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [summary, searchParams]);

  useEffect(() => {
    if (!summary || plantContextLoading) return;
    const { openWizard, next } = consumeAssistantSearchParams(searchParams);
    if (!openWizard) return;
    setShowWizard(true);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, summary, plantContextLoading]);

  function closeWizard() {
    setShowWizard(false);
    reload();
    requestAnimationFrame(() => {
      globalThis.document.getElementById("mapa-quantidades")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  async function handleAddSection(e: FormEvent) {
    e.preventDefault();
    if (!documentId) return;
    setError(null);
    try {
      if (editSession.editing) {
        editSession.addSection(newSectionName, (editSession.sections ?? summary?.sections ?? []).length);
        setNewSectionName("");
        return;
      }
      await boqApi.createSection(documentId, { name: newSectionName, sortOrder: summary?.sections.length ?? 0 });
      setNewSectionName("");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar secção");
    }
  }

  async function handleDeleteDocument() {
    if (!documentId || !summary) return;
    const ok = await confirm({
      title: "Eliminar documento?",
      message: `Eliminar “${summary.document.title}”?`,
      confirmLabel: "Eliminar",
      danger: true,
      details: ["Autos de medição associados", "Secções e linhas do mapa", "Acção irreversível"],
    });
    if (!ok) return;
    try {
      await boqApi.deleteBudgetDocument(documentId);
      navigate(`/projectos/${summary.document.projectId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao eliminar documento");
    }
  }

  async function handleRenameSection(e: FormEvent, sectionId: string) {
    e.preventDefault();
    if (!sectionNameDraft.trim()) return;
    setError(null);
    try {
      if (editSession.editing) {
        editSession.renameSection(sectionId, sectionNameDraft.trim());
        setEditingSectionId(null);
        return;
      }
      await boqApi.updateSection(sectionId, { name: sectionNameDraft.trim() });
      setEditingSectionId(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao renomear secção");
    }
  }

  async function handleDeleteSection(sectionId: string, name: string) {
    const ok = await confirm({
      title: "Eliminar secção?",
      message: `Eliminar “${name}” e todos os capítulos/itens dentro?`,
      confirmLabel: "Eliminar",
      danger: true,
    });
    if (!ok) return;
    setError(null);
    try {
      if (editSession.editing) {
        editSession.deleteSection(sectionId);
        return;
      }
      await boqApi.deleteSection(sectionId);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao eliminar secção");
    }
  }

  async function handleImportMeasurements(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!documentId) return;
    const fileInput = e.currentTarget.elements.namedItem("measurementsFile") as HTMLInputElement | null;
    const file = fileInput?.files?.[0];
    if (!file) return;
    setError(null);
    setImportResult(null);
    setImportingMeasurements(true);
    try {
      const { beginImportProcessingTask } = await import("../services/importProcessingTracker");
      const job = await boqApi.startMeasurementImportJob(documentId, file);
      beginImportProcessingTask({
        jobId: job.id,
        documentId,
        projectId: project?.id,
        fileName: file.name,
      });
      fileInput.value = "";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao enviar mapa");
    } finally {
      setImportingMeasurements(false);
    }
  }

  useEffect(() => {
    function onImportReady(event: Event) {
      const detail = (event as CustomEvent<{ jobId: string; documentId: string; preview: MeasurementImportPreview }>).detail;
      if (!detail || detail.documentId !== documentId || !detail.preview) return;
      setImportJobId(detail.jobId);
      setImportPreview(detail.preview);
      setError(null);
    }
    window.addEventListener("sigo:import-ready", onImportReady as EventListener);
    return () => window.removeEventListener("sigo:import-ready", onImportReady as EventListener);
  }, [documentId]);

  useEffect(() => {
    const jobId = searchParams.get("importJob");
    if (!documentId || !jobId) return;
    let active = true;
    void (async () => {
      try {
        const { getImportTask, consumeImportReview, updateImportProcessingTask } = await import("../services/importProcessingTracker");
        const cached = getImportTask(jobId);
        let preview = cached?.preview ?? null;
        if (!preview) {
          const job = await boqApi.getMeasurementImportJob(documentId, jobId);
          if (!active) return;
          updateImportProcessingTask(job);
          if (job.status === "erro") {
            setError(job.errorMessage ?? "Erro ao analisar o mapa");
            return;
          }
          preview = job.preview;
        }
        if (!active || !preview) return;
        setImportJobId(jobId);
        setImportPreview(preview);
        consumeImportReview(jobId);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Erro ao abrir revisão");
      } finally {
        if (!active) return;
        const next = new URLSearchParams(window.location.search);
        if (next.has("importJob")) {
          next.delete("importJob");
          setSearchParams(next, { replace: true });
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [documentId, searchParams, setSearchParams]);

  async function applyImportReview(decisions: Parameters<typeof boqApi.applyMeasurementImport>[2], saveToCompanyTemplate: boolean) {
    if (!documentId) throw new Error("Documento não encontrado.");
    if (!importJobId) throw new Error("A análise expirou. Volte a carregar o mapa e aguarde a conclusão.");
    const jobId = importJobId;
    setApplyingImport(true);
    setError(null);
    try {
      const result = await boqApi.applyMeasurementImport(documentId, { jobId }, decisions, saveToCompanyTemplate);
      setImportResult(result);
      setImportPreview(null);
      setImportJobId(null);
      if ((result.createdCompositions?.length ?? 0) > 0) {
        setShowImportInsumosWizard(true);
      }
      const { dismissImportProcessingTask } = await import("../services/importProcessingTracker");
      dismissImportProcessingTask(jobId);
      await reload();
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro ao aplicar medições";
      setError(message);
      throw err instanceof Error ? err : new Error(message);
    } finally {
      setApplyingImport(false);
    }
  }

  async function handleReprice() {
    if (!documentId) return;
    setError(null);
    setRepriceResult(null);
    setRepricing(true);
    try {
      const result = await boqApi.repriceBudgetDocument(documentId);
      setRepriceResult(result);
      setShowRepriceConfirm(false);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao actualizar os preços do orçamento");
      setShowRepriceConfirm(false);
    } finally {
      setRepricing(false);
    }
  }

  async function handleReviseBudget() {
    if (!documentId || !summary) return;
    const ok = await confirm({
      title: "Criar revisão?",
      message: "Será criado um novo orçamento em rascunho a partir deste documento. O original permanece intacto.",
      confirmLabel: "Criar revisão",
      details: ["Pode editar quantidades e preços na nova revisão", "O documento actual continua protegido"],
    });
    if (!ok) return;
    setRevisingDocument(true);
    setError(null);
    try {
      const { document } = await boqApi.reviseBudgetDocument(documentId);
      navigate(`/documentos/${document.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar revisão do orçamento");
    } finally {
      setRevisingDocument(false);
    }
  }

  async function handleDuplicateMeasurement() {
    if (!documentId) return;
    const ok = await confirm({
      title: "Duplicar medição?",
      message: "Será criada uma cópia independente em rascunho, com as mesmas quantidades. A medição original permanece aprovada e protegida.",
      confirmLabel: "Duplicar",
      details: ["Pode editar quantidades livremente na cópia", "A cópia não fica ligada aos orçamentos já criados a partir do original"],
    });
    if (!ok) return;
    setDuplicatingMeasurement(true);
    setError(null);
    try {
      const { document } = await boqApi.duplicateMeasurement(documentId);
      navigate(`/documentos/${document.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao duplicar a medição");
    } finally {
      setDuplicatingMeasurement(false);
    }
  }

  const [changingStatus, setChangingStatus] = useState(false);
  const [reviewAction, setReviewAction] = useState<"submit" | "approve" | "return" | null>(null);
  const [activeLineEditId, setActiveLineEditId] = useState<string | null>(null);
  const [showDocumentComments, setShowDocumentComments] = useState(false);

  async function handleRequestLineEdit(id: string | null, _dirty: boolean) {
    if (id === activeLineEditId) return true;
    if (activeLineEditId && id !== null && id !== activeLineEditId) {
      const ok = await confirm({
        title: "Trocar de linha?",
        message: "Guarde ou cancele a linha que está a editar antes de abrir outra.",
        confirmLabel: "Descartar e continuar",
        danger: true,
      });
      if (!ok) return false;
    }
    setActiveLineEditId(id);
    return true;
  }

  async function handleStatusChange(status: "rascunho" | "submetido" | "aprovado", decisionNote?: string) {
    if (!documentId || !summary) return;
    if (status === "rascunho" && !decisionNote?.trim()) return;
    setChangingStatus(true);
    setError(null);
    setErrorBlockers([]);
    try {
      await boqApi.updateBudgetDocumentStatus(documentId, status, decisionNote);
      setReviewAction(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao actualizar o estado do documento");
      setErrorBlockers(err instanceof ApiError ? err.details?.blockers ?? [] : []);
    } finally {
      setChangingStatus(false);
    }
  }

  async function handlePrepareAutomaticDocument() {
    if (!summary) return;
    setPreparingAutomaticDocument(true);
    setError(null);
    try {
      const { document } = await boqApi.prepareMeasurementWorkspace(summary.document.projectId);
      if (document.id === summary.document.id) {
        setShowWizard(true);
      } else {
        navigate(`/documentos/${document.id}?assistente=1`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível preparar o mapa automático");
    } finally {
      setPreparingAutomaticDocument(false);
    }
  }

  async function handleFinancialSettings(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!documentId) return;
    const form = new FormData(e.currentTarget);
    const percentage = (name: string) => Math.max(0, Math.min(100, Number(form.get(name) ?? 0))) / 100;
    setSavingFinancialSettings(true);
    setError(null);
    try {
      await boqApi.updateBudgetDocument(documentId, {
        siteCostsRate: percentage("siteCostsRate"),
        indirectCostsRate: percentage("indirectCostsRate"),
        contingenciasRate: percentage("contingenciasRate"),
        profitMarginRate: percentage("profitMarginRate"),
        ivaRate: percentage("ivaRate"),
      });
      await reload();
      setShowFinancialSettings(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível actualizar as percentagens");
    } finally {
      setSavingFinancialSettings(false);
    }
  }

  async function handleApplySpecifications() {
    if (!documentId) return;
    setApplyingSpecs(true);
    setError(null);
    try {
      const { updated } = await boqApi.applySpecifications(documentId);
      await reload();
      if (updated > 0) setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível aplicar as especificações");
    } finally {
      setApplyingSpecs(false);
    }
  }

  async function handleSubmitToBudget(createScenario = false) {
    if (!documentId) return;
    setSubmittingToBudget(true);
    setError(null);
    try {
      const result = await boqApi.createBudgetFromMeasurement(documentId, { createScenario });
      if (!result.created && !createScenario) {
        const makeScenario = await confirm({
          title: "Já existe orçamento desta medição",
          message: "Pode abrir o orçamento existente ou criar outro cenário comercial com os preços actuais do catálogo/zona — sem repetir as quantidades.",
          confirmLabel: "Criar outro cenário",
          details: ["As quantidades vêm da mesma medição", "Os preços são recalculados agora", "O orçamento anterior mantém-se"],
        });
        if (makeScenario) {
          const scenario = await boqApi.createBudgetFromMeasurement(documentId, { createScenario: true });
          navigate(`/documentos/${scenario.document.id}`);
          return;
        }
      }
      navigate(`/documentos/${result.document.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === "MEASUREMENT_CHANGED") {
        const createRevision = await confirm({
          title: "A medição foi alterada",
          message: "Existem capítulos, itens ou quantidades diferentes do último orçamento.",
          confirmLabel: "Criar nova revisão",
          details: ["O orçamento anterior permanece intacto", "Os preços serão recalculados pelas cotações actuais"],
        });
        if (createRevision) {
          try {
            const { document } = await boqApi.createBudgetFromMeasurement(documentId, { createRevision: true });
            navigate(`/documentos/${document.id}`);
            return;
          } catch (revisionError) {
            setError(revisionError instanceof Error ? revisionError.message : "Não foi possível criar a revisão");
            return;
          }
        }
        return;
      }
      setError(err instanceof Error ? err.message : "Não foi possível enviar a medição para orçamento");
    } finally {
      setSubmittingToBudget(false);
    }
  }

  const unpricedItems = useMemo(() => {
    if (!summary || summary.document.documentType === "medicao") return [];
    return summary.sections.flatMap((section) => collectUnpricedItems(section.items, section.name));
  }, [summary]);

  const visibleSections = useMemo(() => {
    let sections = (editSession.editing && editSession.sections) ? editSession.sections : summary?.sections ?? [];
    const isMedicao = summary?.document.documentType === "medicao";
    if (showOnlyUnpriced && !isMedicao) {
      sections = sections
        .map((section) => ({ ...section, items: filterTreeToUnpricedOnly(section.items) }))
        .filter((section) => section.items.length > 0);
    }
    const needle = itemQuery.trim().toLocaleLowerCase("pt");
    if (!needle) return sections;
    return sections.filter((section) =>
      section.name.toLocaleLowerCase("pt").includes(needle) || containsBudgetMatch(section.items, needle),
    );
  }, [editSession.editing, editSession.sections, summary?.sections, summary?.document.documentType, itemQuery, showOnlyUnpriced]);

  if (!summary) {
    return <LoadingState fullScreen label="A carregar documento..." />;
  }

  const { document, sections, subtotal1, siteCosts, indirectCosts, sellingSubtotal, contingencias, profitMargin, subtotal2, iva, total } = summary;
  const currency = document.currency;
  const isClientView = user?.role === "visualizador";
  const isMeasurementDocument = document.documentType === "medicao";
  const isReadOnly = isClientView || document.status !== "rascunho";
  // Edição por linha no rascunho — a sessão «Lote» continua opcional para undo/redo em massa.
  const mapReadOnly = isReadOnly;
  const compositionLinkedCount = sections.reduce((count, section) => count + countCompositionItems(section.items), 0);
  const technicalSpecCount = sections.reduce((count, section) => count + countTechnicalSpecs(section.items), 0);
  const hasBoqContent = documentHasBoqContent(sections);
  const showPrimaryImport = shouldShowPrimaryMeasurementImport({
    isMeasurementDocument,
    isReadOnly: isReadOnly || editSession.editing,
    hasContent: hasBoqContent,
  });
  const importForm = (
    <MeasurementImportForm
      importing={importingMeasurements}
      result={importResult}
      onSubmit={handleImportMeasurements}
      onDismissResult={() => setImportResult(null)}
      onReviewInsumos={
        (importResult?.createdCompositions?.length ?? 0) > 0
          ? () => setShowImportInsumosWizard(true)
          : undefined
      }
    />
  );
  const pendingOpenings = architectureOpenings.filter((opening) => opening.needsConfirmation || !opening.widthM || !opening.heightM || opening.location === "desconhecida");
  const openingsMissingDimensions = pendingOpenings.filter((opening) => !opening.widthM || !opening.heightM).length;
  const openingsMissingLocation = pendingOpenings.filter((opening) => opening.location === "desconhecida").length;

  const projectBackTo = `/projectos/${document.projectId}${
    searchParams.get("fase")
      ? `?fase=${searchParams.get("fase")}`
      : isMeasurementDocument
        ? "?fase=medicao"
        : "?fase=orcamento"
  }`;

  return (
    <Layout
      title={document.title}
      back={{ label: "Projecto", fallbackTo: projectBackTo }}
      subtitle={isMeasurementDocument
        ? `Medição · rev. ${document.revision ?? "-"} · ${document.status}`
        : `Orçamento · rev. ${document.revision ?? "-"} · ${currency} · ${document.status}`}
      actions={
        <>
          {!isClientView && (
            <button type="button" onClick={() => setShowDocumentComments(true)} className="btn btn-ghost btn-sm">
              Comentários
            </button>
          )}
          {!isClientView && document.status === "rascunho" && directApproval && user?.role === "admin_empresa" && (
            <button onClick={() => setReviewAction("approve")} disabled={changingStatus} className="btn btn-success btn-sm">
              Aprovar
            </button>
          )}
          {!isClientView && document.status === "rascunho" && !directApproval && (
            <button onClick={() => setReviewAction("submit")} disabled={changingStatus || editSession.editing} className="btn btn-primary btn-sm">
              Submeter
            </button>
          )}
          {!isClientView && document.status === "rascunho" && !editSession.editing && (
            <button type="button" onClick={editSession.begin} className="btn btn-ghost btn-sm" title="Sessão com undo/redo em lote">
              <IconPencil className="w-3.5 h-3.5" /> Lote
            </button>
          )}
          {!isReadOnly && !editSession.editing && compositionLinkedCount > 0 && (
            <button
              onClick={() => setShowWizard(true)}
              className="btn btn-secondary btn-sm"
            >
              <IconRuler className="w-3.5 h-3.5" /> Memória
            </button>
          )}
          {isMeasurementDocument && !isClientView && document.status === "aprovado" && (
            <button type="button" onClick={() => handleSubmitToBudget(false)} disabled={submittingToBudget} className="btn btn-primary btn-sm">
              <IconDoc className="w-3.5 h-3.5" />
              {submittingToBudget ? "A enviar..." : "Criar orçamento"}
            </button>
          )}
          {isMeasurementDocument && !isClientView && document.status === "aprovado" && (
            <button
              type="button"
              onClick={() => handleDuplicateMeasurement()}
              disabled={duplicatingMeasurement}
              className="btn btn-secondary btn-sm"
            >
              <IconRefresh className="w-3.5 h-3.5" />
              {duplicatingMeasurement ? "A duplicar..." : "Duplicar"}
            </button>
          )}
          {!isMeasurementDocument && document.status !== "rascunho" && !isClientView && (
            <button
              type="button"
              onClick={() => handleReviseBudget()}
              disabled={revisingDocument}
              className="btn btn-secondary btn-sm"
            >
              <IconRefresh className="w-3.5 h-3.5" />
              {revisingDocument ? "A criar..." : "Criar revisão"}
            </button>
          )}
          {!isMeasurementDocument && document.status === "aprovado" && !isClientView && (
            <Link to={`/projectos/${document.projectId}?fase=gestao`} className="btn btn-primary btn-sm">
              Abrir gestão da obra
            </Link>
          )}
          {document.status === "aprovado" && !isClientView && canManageCommercial && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setShowCommercialProposal(true)}
            >
              <IconDoc className="w-3.5 h-3.5" /> Gerar Proposta Comercial
            </button>
          )}
          <ActionMenu
            items={[
              {
                id: "scenario",
                label: "Criar outro cenário de orçamento",
                icon: <IconDoc className="w-3.5 h-3.5" />,
                onClick: () => handleSubmitToBudget(true),
                hidden: !isMeasurementDocument || isClientView || document.status !== "aprovado",
              },
              {
                id: "revision-diff",
                label: "Comparar revisão",
                icon: <IconChart className="w-3.5 h-3.5" />,
                onClick: () => setShowRevisionDiff(true),
                hidden: isMeasurementDocument || isClientView,
              },
              {
                id: "materials",
                label: "Materiais por fase",
                icon: <IconClipboard className="w-3.5 h-3.5" />,
                onClick: () => setShowMaterialsByPhase(true),
                hidden: isMeasurementDocument,
              },
              {
                id: "report",
                label: "Relatório de cálculos",
                icon: <IconChart className="w-3.5 h-3.5" />,
                onClick: () => setShowReport(true),
                hidden: isMeasurementDocument || !document.lastEstimateReport,
              },
              {
                id: "import-map",
                label: "Importar mapa",
                icon: <IconDownload className="w-3.5 h-3.5" />,
                onClick: () => setShowImportPanel(true),
                hidden: !isMeasurementDocument || isReadOnly || editSession.editing || !hasBoqContent,
              },
              {
                id: "excel",
                label: isMeasurementDocument ? "Exportar Excel" : "Excel",
                icon: <IconDownload className="w-3.5 h-3.5" />,
                href: isMeasurementDocument ? boqApi.measurementExcelUrl(document.id) : `/api/budget-documents/${document.id}/export.xlsx`,
              },
              {
                id: "pdf",
                label: isMeasurementDocument ? "Exportar PDF" : "PDF",
                icon: <IconDownload className="w-3.5 h-3.5" />,
                href: isMeasurementDocument ? boqApi.measurementPdfUrl(document.id) : `/api/budget-documents/${document.id}/export.pdf`,
              },
              {
                id: "delete",
                label: "Eliminar documento",
                icon: <IconTrash className="w-3.5 h-3.5" />,
                onClick: handleDeleteDocument,
                danger: true,
                hidden: isReadOnly || editSession.editing,
              },
            ]}
          />
        </>
      }
    >
      <div className="space-y-5">
        <ProjectWorkspaceNav
          projectId={document.projectId}
          mode={
            searchParams.get("fase") === "gestao"
              ? "site"
              : isMeasurementDocument
                ? "measurement"
                : "budget"
          }
        />
        {!isClientView && document.status === "submetido" && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm">
            <span className="font-medium text-brand-950">Aguarda a sua revisão</span>
            <span className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowDocumentComments(true)}>Comentários</button>
              <button type="button" className="btn btn-secondary btn-sm" disabled={changingStatus} onClick={() => setReviewAction("return")}>Devolver</button>
              {user?.role === "admin_empresa" && (
                <button type="button" className="btn btn-success btn-sm" disabled={changingStatus} onClick={() => setReviewAction("approve")}>Aprovar</button>
              )}
            </span>
          </div>
        )}
        {!isClientView && document.status === "rascunho" && document.approvalNote && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            <p className="font-semibold">Devolvido</p>
            <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed">{document.approvalNote}</p>
          </div>
        )}
        {!isClientView && document.status === "aprovado" && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
            <span className="font-medium text-slate-700">Documento aprovado e protegido</span>
            <span className="badge badge-green">aprovado</span>
          </div>
        )}
        {!isMeasurementDocument && document.status === "rascunho" && !isClientView && (
          <section className="card overflow-hidden">
            <SectionHeader
              title="Especificações técnicas"
              actions={
                <button type="button" onClick={handleApplySpecifications} disabled={applyingSpecs} className="btn btn-secondary btn-sm">
                  {applyingSpecs ? "A aplicar..." : "Actualizar no mapa"}
                </button>
              }
            />
            <div className="border-t border-slate-100 px-5 py-4">
              <div className="mb-3 flex flex-wrap gap-2 text-xs">
                <span className="badge badge-brand">{technicalSpecCount} item(ns) com especificação</span>
                <span className="badge badge-gray">{materialSpecs.length} material(is) no projecto</span>
                <span className="badge badge-gray">{compositionLinkedCount} com composição</span>
              </div>
              {materialSpecs.length > 0 ? (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {materialSpecs.slice(0, 8).map((m) => (
                    <li key={m.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                      <strong className="text-slate-900">{m.name}</strong>
                      {m.specification && <p className="mt-0.5 text-slate-600 line-clamp-2">{m.specification}</p>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-500">Sem especificações no projecto.</p>
              )}
              {materialSpecs.length > 8 && <p className="mt-2 text-xs text-slate-400">+ {materialSpecs.length - 8} materiais — ver ficha completa no projecto</p>}
            </div>
          </section>
        )}
        {!isMeasurementDocument && <section className="card flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Valor do projecto</p>
            <strong className="mt-0.5 block truncate text-xl text-slate-950">{money(total, currency)}</strong>
          </div>
          <button type="button" onClick={() => setShowFinancialSummary(true)} className="btn btn-secondary w-full sm:w-auto">
            <IconChart className="h-4 w-4" />
            Resumo financeiro
          </button>
        </section>}
        {isMeasurementDocument && (
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium text-slate-700">Medição técnica</span>
            <span className="badge badge-brand">
              {sections.some((section) => section.templateKey?.startsWith("sigo_adaptativo")) ? "Adaptado às plantas" : "Sem preços"}
            </span>
          </div>
        )}
        {isMeasurementDocument && architecturePlant && pendingOpenings.length > 0 && (
          <section className="card flex flex-col gap-3 border-l-4 border-l-amber-500 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="min-w-0">
              <strong className="text-sm text-slate-950">Portas e janelas aguardam confirmação</strong>
              <p className="mt-1 text-xs text-slate-600">
                {pendingOpenings.length} vão(s) lido(s)
                {openingsMissingDimensions > 0 ? ` · ${openingsMissingDimensions} sem dimensão completa` : ""}
                {openingsMissingLocation > 0 ? ` · ${openingsMissingLocation} sem classificação interior/exterior` : ""}.
                As quantidades serão actualizadas automaticamente depois da confirmação.
              </p>
            </div>
            <Link to={`/plantas/${architecturePlant.id}#portas-janelas`} className="btn btn-primary shrink-0">Confirmar vãos</Link>
          </section>
        )}

        {/* Coluna principal: secções e itens */}
        <div className="min-w-0 space-y-5">
          {editSession.editing && (
            <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2">
              <button type="button" className="btn btn-secondary btn-sm" disabled={!editSession.canUndo} onClick={editSession.undo}>Desfazer</button>
              <button type="button" className="btn btn-secondary btn-sm" disabled={!editSession.canRedo} onClick={editSession.redo}>Refazer</button>
              <span className="text-xs font-medium tabular-nums text-slate-700">{editSession.changeCount} alteração(ões)</span>
              <span className="ml-auto flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={editSession.saving}
                  onClick={async () => {
                    if (editSession.changeCount > 0) {
                      const ok = await confirm({
                        title: "Descartar alterações?",
                        message: "As edições não guardadas serão perdidas.",
                        confirmLabel: "Descartar",
                        danger: true,
                      });
                      if (!ok) return;
                    }
                    await editSession.discard();
                  }}
                >
                  Descartar
                </button>
                <button type="button" className="btn btn-primary btn-sm" disabled={editSession.saving || editSession.changeCount === 0} onClick={() => void editSession.save()}>
                  {editSession.saving ? "A guardar…" : "Guardar"}
                </button>
              </span>
            </div>
          )}
          {error && (
            <AlertBanner tone="error" onDismiss={() => { setError(null); setErrorBlockers([]); }}>
              <div>
                <p className="font-semibold">{error}</p>
                {errorBlockers.length > 0 && (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                    {errorBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
                  </ul>
                )}
              </div>
            </AlertBanner>
          )}

          {(showPrimaryImport || (showImportPanel && isMeasurementDocument && !isReadOnly && !editSession.editing)) && (
            <section className="card overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
                <h2 className="text-sm font-semibold text-slate-900">Importar mapa</h2>
                {!showPrimaryImport && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowImportPanel(false)}>Fechar</button>
                )}
              </div>
              <div className="border-t border-slate-100">{importForm}</div>
            </section>
          )}

          {!isMeasurementDocument && !isClientView && <section className={`card card-pad border-l-4 ${compositionLinkedCount > 0 ? "border-l-brand-500" : "border-l-slate-300"}`}>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${compositionLinkedCount > 0 ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-500"}`}>
                  {compositionLinkedCount > 0 ? <IconRefresh className="h-4 w-4" /> : <IconDoc className="h-4 w-4" />}
                </span>
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    {compositionLinkedCount > 0 ? "Preços ligados ao catálogo" : "Documento com preços próprios"}
                  </h2>
                  <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">
                    {compositionLinkedCount > 0
                      ? "Quantidades e preços manuais não mudam."
                      : "Preços próprios — valores recebidos preservados."}
                  </p>
                  <p className="mt-2 text-xs font-medium text-slate-700">
                    {compositionLinkedCount > 0
                      ? `${compositionLinkedCount} item(ns) deste documento estão ligados a composições.`
                      : "A medição por plantas usa um mapa automático separado."}
                  </p>
                  {compositionLinkedCount > 0 && document.status !== "rascunho" && (
                    <p className="mt-2 text-xs font-medium text-amber-700">
                      Documento protegido ({document.status}). Crie uma nova revisão para recalcular preços.
                    </p>
                  )}
                </div>
              </div>
              {compositionLinkedCount > 0 && document.status !== "rascunho" ? (
                <button
                  type="button"
                  onClick={() => handleReviseBudget()}
                  disabled={revisingDocument}
                  className="btn btn-secondary btn-sm shrink-0"
                >
                  <IconRefresh className="h-3.5 w-3.5" />
                  {revisingDocument ? "A criar..." : "Criar revisão"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => compositionLinkedCount > 0 ? setShowRepriceConfirm(true) : handlePrepareAutomaticDocument()}
                  disabled={compositionLinkedCount > 0 ? document.status !== "rascunho" || repricing : preparingAutomaticDocument}
                  className="btn btn-secondary btn-sm shrink-0"
                >
                  {compositionLinkedCount > 0 ? <IconRefresh className="h-3.5 w-3.5" /> : <IconRuler className="h-3.5 w-3.5" />}
                  {compositionLinkedCount > 0 ? "Actualizar preços" : preparingAutomaticDocument ? "A preparar..." : "Preparar medição pelas plantas"}
                </button>
              )}
            </div>
            {repriceResult && (
              <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                <span className="font-semibold">Actualização concluída:</span>{" "}
                {repriceResult.processed === 0
                  ? "não existem itens ligados a composições neste documento."
                  : `${repriceResult.updated} de ${repriceResult.processed} item(ns) alterado(s). Total: ${money(repriceResult.previousTotal, currency)} → ${money(repriceResult.newTotal, currency)}.`}
              </div>
            )}
          </section>}

          {!isMeasurementDocument && unpricedItems.length > 0 && (
            <section className="card overflow-hidden border-l-4 border-l-amber-500">
              <div className="border-b border-amber-100 bg-amber-50 px-4 py-3 sm:px-5">
                <h2 className="text-sm font-semibold text-amber-950">
                  {unpricedItems.length} item(ns) sem preço — precisa de atenção
                </h2>
                <p className="mt-1 text-xs text-amber-800">
                  Ligue ao catálogo ou preencha o preço unitário antes de submeter.
                </p>
              </div>
              <ul className="divide-y divide-amber-100">
                {unpricedItems.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => {
                        requestAnimationFrame(() => {
                          globalThis.document.getElementById(`line-item-${item.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
                        });
                      }}
                      className="flex w-full flex-wrap items-baseline gap-x-2 px-4 py-2.5 text-left text-sm text-amber-950 hover:bg-amber-50 sm:px-5"
                    >
                      {item.code ? (
                        <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs font-semibold text-amber-900">{item.code}</span>
                      ) : (
                        <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">sem código</span>
                      )}
                      <span className="min-w-0 flex-1 font-medium">{item.description}</span>
                      <span className="shrink-0 text-xs text-amber-700">{item.sectionName}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2 border-t border-amber-100 bg-amber-50/50 px-4 py-3 sm:px-5">
                <button
                  type="button"
                  onClick={() => {
                    setShowOnlyUnpriced(true);
                    setSearchParams({ semPreco: "1" }, { replace: true });
                  }}
                  className="btn btn-secondary btn-sm"
                >
                  Ver só estes {unpricedItems.length} item(ns)
                </button>
                <Link to="/catalogo" className="btn btn-ghost btn-sm">Abrir catálogo</Link>
              </div>
            </section>
          )}

          <div id="mapa-quantidades" className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <PageSearch
              value={itemQuery}
              onChange={setItemQuery}
              placeholder="Pesquisar código, descrição, unidade ou secção…"
              resultLabel={
                showOnlyUnpriced
                  ? `${visibleSections.length} secção(ões) · filtro sem preço`
                  : `${visibleSections.length} secção(ões)`
              }
            />
            {!isMeasurementDocument && unpricedItems.length > 0 && (
              <label className="flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                <input
                  type="checkbox"
                  checked={showOnlyUnpriced}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setShowOnlyUnpriced(on);
                    setSearchParams(on ? { semPreco: "1" } : {}, { replace: true });
                  }}
                  className="rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                />
                Só sem preço ({unpricedItems.length})
              </label>
            )}
          </div>

          {visibleSections.map((section) => (
            <section key={section.id} className="card overflow-hidden">
              <div className="flex flex-col gap-2 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                {editingSectionId === section.id ? (
                  <form onSubmit={(e) => handleRenameSection(e, section.id)} className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                    <input
                      required
                      value={sectionNameDraft}
                      onChange={(e) => setSectionNameDraft(e.target.value)}
                      className="input input-sm min-w-[200px] flex-1"
                      autoFocus
                    />
                    <button type="submit" className="btn btn-primary btn-sm">Guardar</button>
                    <button type="button" onClick={() => setEditingSectionId(null)} className="btn btn-ghost btn-sm">Cancelar</button>
                  </form>
                ) : (
                  <>
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-slate-950">{section.name}</h3>
                      <p className="text-xs text-slate-500">{section.items.length} item(ns)</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {!isMeasurementDocument && !isClientView && (
                        <span className="text-sm font-bold text-slate-900 tabular-nums">{money(section.sellingTotal, currency)}</span>
                      )}
                      {!mapReadOnly && (
                        <>
                          <button
                            type="button"
                            onClick={() => { setEditingSectionId(section.id); setSectionNameDraft(section.name); }}
                            className="icon-btn"
                            title="Renomear secção"
                          >
                            <IconPencil className="w-4 h-4" />
                          </button>
                          <button type="button" onClick={() => handleDeleteSection(section.id, section.name)} className="icon-btn-danger" title="Eliminar secção">
                            <IconTrash className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>

              <div className="px-3 py-2 overflow-x-auto">
                {section.items.length === 0 ? (
                  <div className="py-8 text-center">
                    <p className="text-sm font-medium text-slate-700">Sem itens</p>
                    {!mapReadOnly && (
                      addingIn === section.id ? (
                        <div className="mt-4 text-left">
                          <AddChildForm
                            sectionId={section.id}
                            parentId={null}
                            compositions={compositions}
                            measurementOnly={isMeasurementDocument}
                            mutations={editSession.editing ? editSession.mutations : undefined}
                            onDone={() => {
                              setAddingIn(null);
                              if (!editSession.editing) void reload();
                            }}
                          />
                        </div>
                      ) : (
                        <div className="mt-4 flex flex-wrap justify-center gap-2">
                          {isMeasurementDocument && !editSession.editing && <button type="button" onClick={() => setShowWizard(true)} className="btn btn-primary btn-sm"><IconRuler className="h-3.5 w-3.5" />Assistente</button>}
                          <button type="button" onClick={() => setAddingIn(section.id)} className="btn btn-secondary btn-sm"><IconPlus className="h-3.5 w-3.5" />Adicionar</button>
                        </div>
                      )
                    )}
                  </div>
                ) : (
                  <table className="w-full min-w-[500px] border-collapse sm:min-w-[720px]">
                    <BoqHeaderRow measurementOnly={isMeasurementDocument} />
                    <BoqTableHead readOnly={mapReadOnly} measurementOnly={isMeasurementDocument} />
                    <tbody>
                      {section.items.map((item) => (
                        <LineItemRow
                          key={item.id}
                          node={item}
                          depth={0}
                          sectionId={section.id}
                          compositions={compositions}
                          onChange={editSession.editing ? () => undefined : reload}
                          readOnly={mapReadOnly}
                          measurementOnly={isMeasurementDocument}
                          hasPlantRooms={architectureRooms.length > 0}
                          allowLivePersistence={!editSession.editing}
                          mutations={editSession.editing ? editSession.mutations : undefined}
                          activeEditId={editSession.editing ? null : activeLineEditId}
                          onRequestEdit={editSession.editing ? undefined : handleRequestLineEdit}
                          documentId={documentId}
                        />
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {!mapReadOnly && section.items.length > 0 && <div className="px-3 pb-3">
                {addingIn === section.id ? (
                  <AddChildForm
                    sectionId={section.id}
                    parentId={null}
                    compositions={compositions}
                    measurementOnly={isMeasurementDocument}
                    mutations={editSession.editing ? editSession.mutations : undefined}
                    onDone={() => {
                      setAddingIn(null);
                      if (!editSession.editing) void reload();
                    }}
                  />
                ) : (
                  <button onClick={() => setAddingIn(section.id)} className="btn btn-secondary btn-sm">
                    <IconPlus className="w-3.5 h-3.5" />
                    Adicionar capítulo / item
                  </button>
                )}
              </div>}
            </section>
          ))}
          {visibleSections.length === 0 && (
            <div className="card px-5 py-12 text-center text-sm text-slate-500">
              {showOnlyUnpriced
                ? "Nenhum item sem preço neste orçamento."
                : "Nenhum item do mapa corresponde à pesquisa."}
            </div>
          )}

          {!mapReadOnly && (
            <details className="card overflow-hidden">
              <summary className="cursor-pointer px-5 py-4 hover:bg-slate-50">
                <span className="text-sm font-semibold text-slate-900">Adicionar secção</span>
              </summary>
              <section className="border-t border-slate-200">
                <form onSubmit={handleAddSection} className="flex gap-2 items-end p-5">
                  <input
                    required
                    placeholder="Nome da secção"
                    value={newSectionName}
                    onChange={(e) => setNewSectionName(e.target.value)}
                    className="input flex-1"
                  />
                  <button type="submit" className="btn btn-primary">
                    <IconPlus className="w-4 h-4" />
                    Adicionar
                  </button>
                </form>
              </section>
            </details>
          )}
        </div>

      </div>

      {!isMeasurementDocument && showFinancialSummary && (
        <ModalPortal>
          <div className="fixed inset-0 z-[90] grid place-items-center overflow-y-auto bg-slate-950/55 p-3 sm:p-6">
            <button type="button" aria-label="Fechar resumo financeiro" onClick={() => setShowFinancialSummary(false)} className="absolute inset-0" />
            <section className="relative my-auto w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl">
              <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
                <div>
                  <h2 className="font-semibold text-slate-950">Resumo financeiro</h2>
                  <p className="text-xs text-slate-500">{document.title}</p>
                </div>
                <button type="button" onClick={() => setShowFinancialSummary(false)} className="btn btn-ghost btn-sm">Fechar</button>
              </header>
              <div className="max-h-[78vh] overflow-y-auto p-5">
                {!isReadOnly && (
                  <button type="button" onClick={() => setShowFinancialSettings((value) => !value)} className="btn btn-secondary btn-sm mb-4 w-full">
                    {showFinancialSettings ? "Ocultar formação do preço" : "Editar formação do preço"}
                  </button>
                )}
                {showFinancialSettings && (
                  <form onSubmit={handleFinancialSettings} className="mb-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="text-xs text-slate-600">Estaleiro (%)
                        <input name="siteCostsRate" type="number" min="0" max="100" step="0.01" defaultValue={Number(document.siteCostsRate) * 100} className="input mt-1" />
                      </label>
                      <label className="text-xs text-slate-600">Indirectos (%)
                        <input name="indirectCostsRate" type="number" min="0" max="100" step="0.01" defaultValue={Number(document.indirectCostsRate) * 100} className="input mt-1" />
                      </label>
                      <label className="text-xs text-slate-600">Margem (%)
                        <input name="profitMarginRate" type="number" min="0" max="100" step="0.01" defaultValue={Number(document.profitMarginRate) * 100} className="input mt-1" />
                      </label>
                      <label className="text-xs text-slate-600">Contingências (%)
                        <input name="contingenciasRate" type="number" min="0" max="100" step="0.01" defaultValue={Number(document.contingenciasRate) * 100} className="input mt-1" />
                      </label>
                      <label className="text-xs text-slate-600 sm:col-span-2">IVA (%)
                        <input name="ivaRate" type="number" min="0" max="100" step="0.01" defaultValue={Number(document.ivaRate) * 100} className="input mt-1" />
                      </label>
                    </div>
                    <button type="submit" disabled={savingFinancialSettings} className="btn btn-primary btn-sm mt-3 w-full">
                      {savingFinancialSettings ? "A guardar..." : "Aplicar ao total"}
                    </button>
                  </form>
                )}
                <dl className="space-y-2 text-sm">
                  {sections.map((s) => (
                    <div key={s.id} className="flex justify-between gap-4 text-slate-600">
                      <dt className="truncate">{s.name}</dt>
                      <dd className="shrink-0 tabular-nums">{money(s.sellingTotal, "")}</dd>
                    </div>
                  ))}
                  <div className="mt-2 flex justify-between border-t border-slate-200 pt-3 text-slate-700">
                    <dt>{isClientView ? "Trabalhos" : "Custos directos"}</dt>
                    <dd className="tabular-nums">{money(isClientView ? sellingSubtotal : subtotal1, "")}</dd>
                  </div>
                  {!isClientView && <div className="flex justify-between text-slate-500"><dt>Estaleiro ({(Number(document.siteCostsRate) * 100).toFixed(2)}%)</dt><dd className="tabular-nums">{money(siteCosts, "")}</dd></div>}
                  {!isClientView && <div className="flex justify-between text-slate-500"><dt>Indirectos ({(Number(document.indirectCostsRate) * 100).toFixed(2)}%)</dt><dd className="tabular-nums">{money(indirectCosts, "")}</dd></div>}
                  {!isClientView && <div className="flex justify-between text-slate-500"><dt>Margem ({(Number(document.profitMarginRate) * 100).toFixed(2)}%)</dt><dd className="tabular-nums">{money(profitMargin, "")}</dd></div>}
                  {!isClientView && <div className="flex justify-between font-medium text-slate-700"><dt>Preço de venda</dt><dd className="tabular-nums">{money(sellingSubtotal, "")}</dd></div>}
                  <div className="flex justify-between text-slate-500"><dt>Contingências ({(Number(document.contingenciasRate) * 100).toFixed(2)}%)</dt><dd className="tabular-nums">{money(contingencias, "")}</dd></div>
                  <div className="flex justify-between text-slate-700"><dt>Base tributável</dt><dd className="tabular-nums">{money(subtotal2, "")}</dd></div>
                  <div className="flex justify-between text-slate-500"><dt>IVA ({(Number(document.ivaRate) * 100).toFixed(2)}%)</dt><dd className="tabular-nums">{money(iva, "")}</dd></div>
                </dl>
                <div className="mt-4 flex flex-col gap-1 border-t border-slate-300 pt-4 sm:flex-row sm:items-baseline sm:justify-between">
                  <span className="text-sm font-semibold text-slate-700">Valor total</span>
                  <span className="text-2xl font-bold tabular-nums text-slate-950">{money(total, currency)}</span>
                </div>
                {dashboard?.hasCertificates && (
                  <div className="mt-5 rounded-xl bg-slate-50 p-4">
                    <div className="mb-2 flex justify-between gap-3 text-sm">
                      <span className="text-slate-500">Execução · Auto Nº {dashboard.latestCertificateNumber}</span>
                      <strong className="tabular-nums text-slate-900">{dashboard.percentExecutado.toFixed(2)}%</strong>
                    </div>
                    <div className="h-2 w-full rounded-full bg-slate-200">
                      <div className="h-2 rounded-full bg-brand-600" style={{ width: `${Math.min(100, dashboard.percentExecutado).toFixed(2)}%` }} />
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>
        </ModalPortal>
      )}

      {!isReadOnly && !editSession.editing && showWizard && documentId && (
        <QuickEstimateWizard
          documentId={documentId}
          structuralSummary={structuralPlant?.structuralSummary}
          structuralPlantName={structuralPlant?.originalFileName}
          structuralPlantId={structuralPlant?.id}
          architectureRooms={architectureRooms}
          architectureOpenings={architectureOpenings}
          architecturePlantName={architecturePlant?.originalFileName}
          architecturePlantId={architecturePlant?.id}
          zoneId={project?.zoneId}
          documentCurrency={document.currency}
          onClose={closeWizard}
          onApplied={reload}
        />
      )}

      {showMaterialsByPhase && documentId && (
        <MaterialsByPhaseModal documentId={documentId} onClose={() => setShowMaterialsByPhase(false)} />
      )}

      {showReport && document.lastEstimateReport && (
        <ModalPortal>
          <div className="fixed inset-0 z-50 bg-gray-900/50 flex items-center justify-center p-4">
            <div className="w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex justify-end mb-2">
              <button onClick={() => setShowReport(false)} className="btn btn-ghost btn-sm !text-white hover:!bg-white/10">
                Fechar ✕
              </button>
            </div>
            <div className="overflow-y-auto">
              <CalculationReportView entries={document.lastEstimateReport.entries} generatedAt={document.lastEstimateReport.generatedAt} />
            </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {showRepriceConfirm && (
        <ConfirmDialog
          title="Actualizar preços do orçamento?"
          message="Recalcula só os itens ligados a composições, com os preços da zona actual. Quantidades e preços manuais permanecem iguais."
          confirmLabel="Actualizar preços"
          busy={repricing}
          onConfirm={handleReprice}
          onCancel={() => setShowRepriceConfirm(false)}
        />
      )}

      {showCommercialProposal && (
        <ModalPortal>
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 p-4">
            <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl">
              <h2 className="text-lg font-semibold text-slate-900">Gerar Proposta Comercial</h2>
              {error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
              <p className="mt-1 text-sm text-slate-600">
                Cria uma proposta de execução no Comercial a partir deste documento aprovado. As quantidades não são recalculadas.
              </p>
              {isMeasurementDocument && (
                <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  Medição técnica: se ainda não tiver preços de venda, prefira gerar a partir do orçamento aprovado.
                </p>
              )}
              <div className="mt-4 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Anexar ao escopo</p>
                {(
                  [
                    ["nada", "Nada — uma linha com o total"],
                    ["resumo", "Resumo — capítulos + contingências/IVA"],
                    ["mapa", "Mapa completo — itens com qtd. e PU"],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value} className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
                    <input
                      type="radio"
                      className="mt-0.5"
                      name="attachMode"
                      checked={proposalAttachMode === value}
                      onChange={() => setProposalAttachMode(value)}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <button type="button" className="btn btn-secondary" onClick={() => setShowCommercialProposal(false)} disabled={creatingProposal}>
                  Cancelar
                </button>
                <button type="button" className="btn btn-primary" disabled={creatingProposal} onClick={handleGenerateCommercialProposal}>
                  {creatingProposal ? "A gerar…" : "Gerar proposta"}
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {showRevisionDiff && documentId && (
        <BudgetRevisionDiffModal documentId={documentId} onClose={() => setShowRevisionDiff(false)} />
      )}

      {importPreview && importJobId && (
        <MeasurementImportReviewModal
          preview={importPreview}
          applying={applyingImport}
          onClose={() => {
            if (applyingImport) return;
            setImportPreview(null);
            setImportJobId(null);
          }}
          onApply={applyImportReview}
        />
      )}

      {showImportInsumosWizard && (importResult?.createdCompositions?.length ?? 0) > 0 && (
        <ImportCompositionReviewWizard
          compositions={importResult!.createdCompositions!}
          onClose={() => setShowImportInsumosWizard(false)}
        />
      )}

      {reviewAction && (
        <DocumentReviewModal
          action={reviewAction}
          documentLabel={isMeasurementDocument ? "medição" : "orçamento"}
          busy={changingStatus}
          onClose={() => setReviewAction(null)}
          onConfirm={async (note) => {
            if (reviewAction === "submit") await handleStatusChange("submetido", note || undefined);
            else if (reviewAction === "approve") await handleStatusChange("aprovado", note || undefined);
            else await handleStatusChange("rascunho", note);
          }}
        />
      )}

      {showDocumentComments && documentId && (
        <LineItemSidePanel
          open
          kind="comments"
          title={document.title}
          subtitle={isMeasurementDocument ? "Medição" : "Orçamento"}
          onClose={() => setShowDocumentComments(false)}
        >
          <DocumentReviewCommentsPanel documentId={documentId} targetType="document" canWrite={!isClientView} />
        </LineItemSidePanel>
      )}

      {dialog}
    </Layout>
  );
}

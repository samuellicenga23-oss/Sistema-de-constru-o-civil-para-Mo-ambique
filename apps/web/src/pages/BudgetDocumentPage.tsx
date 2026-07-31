import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { boqApi, type BudgetDocumentSummary, type BudgetRepriceResult, type LineItemNode, type MeasurementImportResult, type Project } from "../api/boq";
import { catalogApi, type CostComposition } from "../api/catalog";
import { measurementApi, type MeasurementDashboard } from "../api/measurement";
import { plantsApi, type Plant, type ExtractedRoom } from "../api/plants";
import LineItemRow, { AddChildForm, BoqHeaderRow, BoqTableHead } from "../components/LineItemRow";
import QuickEstimateWizard from "../components/QuickEstimateWizard";
import CalculationReportView from "../components/CalculationReportView";
import MaterialsByPhaseModal from "../components/MaterialsByPhaseModal";
import ConfirmDialog from "../components/ConfirmDialog";
import ModalPortal from "../components/ModalPortal";
import Layout from "../components/Layout";
import ProjectWorkspaceNav from "../components/ProjectWorkspaceNav";
import PageSearch from "../components/PageSearch";
import { SectionHeader } from "../components/WorkspaceUI";
import { IconBack, IconChart, IconClipboard, IconDoc, IconDownload, IconPlus, IconRefresh, IconRuler, IconTrash } from "../components/icons";
import { useAuth } from "../auth/AuthContext";

function money(value: number, currency: string) {
  return `${value.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function countCompositionItems(items: LineItemNode[]): number {
  return items.reduce(
    (total, item) => total + (item.compositionId ? 1 : 0) + countCompositionItems(item.children),
    0,
  );
}

function containsBudgetMatch(items: LineItemNode[], needle: string): boolean {
  return items.some((item) =>
    `${item.code ?? ""} ${item.description ?? ""} ${item.unit ?? ""}`.toLocaleLowerCase("pt").includes(needle)
    || containsBudgetMatch(item.children, needle),
  );
}

export default function BudgetDocumentPage() {
  const { user } = useAuth();
  const { documentId } = useParams<{ documentId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [summary, setSummary] = useState<BudgetDocumentSummary | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [compositions, setCompositions] = useState<CostComposition[]>([]);
  const [dashboard, setDashboard] = useState<MeasurementDashboard | null>(null);
  const [newSectionName, setNewSectionName] = useState("");
  const [addingIn, setAddingIn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showMaterialsByPhase, setShowMaterialsByPhase] = useState(false);
  const [structuralPlant, setStructuralPlant] = useState<Plant | null>(null);
  const [architecturePlant, setArchitecturePlant] = useState<Plant | null>(null);
  const [architectureRooms, setArchitectureRooms] = useState<ExtractedRoom[]>([]);
  const [importingMeasurements, setImportingMeasurements] = useState(false);
  const [importResult, setImportResult] = useState<MeasurementImportResult | null>(null);
  const [showRepriceConfirm, setShowRepriceConfirm] = useState(false);
  const [repricing, setRepricing] = useState(false);
  const [repriceResult, setRepriceResult] = useState<BudgetRepriceResult | null>(null);
  const [plantContextLoading, setPlantContextLoading] = useState(true);
  const [preparingAutomaticDocument, setPreparingAutomaticDocument] = useState(false);
  const [showFinancialSettings, setShowFinancialSettings] = useState(false);
  const [showFinancialSummary, setShowFinancialSummary] = useState(false);
  const [savingFinancialSettings, setSavingFinancialSettings] = useState(false);
  const [itemQuery, setItemQuery] = useState("");
  const [submittingToBudget, setSubmittingToBudget] = useState(false);
  async function reload() {
    if (!documentId) return;
    const s = await boqApi.getBudgetDocumentSummary(documentId);
    setSummary(s);
    setDashboard(await measurementApi.dashboard(s.document.projectId, documentId));
  }

  useEffect(() => {
    if (!documentId) return;
    setPlantContextLoading(true);
    setStructuralPlant(null);
    setArchitecturePlant(null);
    setArchitectureRooms([]);
    boqApi
      .getBudgetDocumentSummary(documentId)
      .then(async (s) => {
        setSummary(s);
        const projectData = await boqApi.getProject(s.document.projectId);
        setProject(projectData);
        const [c, d, plants] = await Promise.all([
          catalogApi.listCompositions(projectData.zoneId ?? undefined),
          measurementApi.dashboard(s.document.projectId, documentId),
          plantsApi.list(s.document.projectId),
        ]);
        setCompositions(c);
        setDashboard(d);
        const processed = plants.filter((p) => p.processingStatus === "concluido");
        const newestFirst = [...processed].reverse();

        // A planta estrutural é escolhida pelo que ela TEM (resumo estrutural real), não só
        // pela etiqueta de disciplina escolhida ao carregar — o extractor lê o que encontrar no
        // ficheiro independentemente da etiqueta (ver Ronda 12), por isso um ficheiro estrutural
        // com a disciplina trocada por engano (ex: carregado como "arquitectura") não pode
        // deixar de alimentar o Assistente só por causa da etiqueta errada.
        const structural =
          newestFirst.find((p) => p.discipline === "estrutura" && p.structuralSummary) ??
          newestFirst.find((p) => p.structuralSummary);
        setStructuralPlant(structural ?? null);

        // Idem para compartimentos: procura em TODAS as plantas processadas (não só nas
        // etiquetadas "arquitectura") a primeira que realmente tenha compartimentos extraídos —
        // evita que uma planta sem compartimentos (ex: um projecto estrutural mal etiquetado,
        // que o `.find` anterior escolhia por ser a primeira "arquitectura" da lista) bloqueie a
        // procura antes de chegar à planta que os tem mesmo.
        for (const p of newestFirst) {
          const detail = await plantsApi.detail(p.id);
          if (detail.rooms.length > 0) {
            setArchitecturePlant(p);
            setArchitectureRooms(detail.rooms);
            break;
          }
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setPlantContextLoading(false));
  }, [documentId]);

  useEffect(() => {
    if (searchParams.get("assistente") !== "1" || !summary || plantContextLoading) return;
    setShowWizard(true);
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams, summary, plantContextLoading]);

  async function handleAddSection(e: FormEvent) {
    e.preventDefault();
    if (!documentId) return;
    setError(null);
    try {
      await boqApi.createSection(documentId, { name: newSectionName, sortOrder: summary?.sections.length ?? 0 });
      setNewSectionName("");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar secção");
    }
  }

  async function handleDeleteDocument() {
    if (!documentId || !summary) return;
    if (!window.confirm(`Eliminar o documento "${summary.document.title}"? Isto apaga também os seus autos de medição associados. Esta acção não pode ser desfeita.`)) return;
    try {
      await boqApi.deleteBudgetDocument(documentId);
      navigate(`/projectos/${summary.document.projectId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao eliminar documento");
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
      const result = await boqApi.importMeasurements(documentId, file);
      setImportResult(result);
      fileInput.value = "";
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao importar medições");
    } finally {
      setImportingMeasurements(false);
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

  const [changingStatus, setChangingStatus] = useState(false);

  async function handleStatusChange(status: "rascunho" | "submetido" | "aprovado") {
    if (!documentId) return;
    const confirmation = status === "aprovado"
      ? "Aprovar este orçamento? Fica protegido contra novo cálculo automático e passa a ser a referência do cronograma e dos Autos de Medição."
      : status === "submetido"
        ? "Submeter este orçamento para aprovação?"
        : "Devolver este orçamento a rascunho?";
    if (!window.confirm(confirmation)) return;
    setChangingStatus(true);
    setError(null);
    try {
      await boqApi.updateBudgetDocumentStatus(documentId, status);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao actualizar o estado do documento");
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

  async function handleSubmitToBudget() {
    if (!documentId) return;
    setSubmittingToBudget(true);
    setError(null);
    try {
      const { document } = await boqApi.createBudgetFromMeasurement(documentId);
      navigate(`/documentos/${document.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível enviar a medição para orçamento");
    } finally {
      setSubmittingToBudget(false);
    }
  }

  const visibleSections = useMemo(() => {
    const sections = summary?.sections ?? [];
    const needle = itemQuery.trim().toLocaleLowerCase("pt");
    if (!needle) return sections;
    return sections.filter((section) =>
      section.name.toLocaleLowerCase("pt").includes(needle) || containsBudgetMatch(section.items, needle),
    );
  }, [summary?.sections, itemQuery]);

  if (!summary) {
    return <div className="min-h-screen flex items-center justify-center text-gray-400">A carregar...</div>;
  }

  const { document, sections, subtotal1, siteCosts, indirectCosts, sellingSubtotal, contingencias, profitMargin, subtotal2, iva, total } = summary;
  const currency = document.currency;
  const isClientView = user?.role === "visualizador";
  const isMeasurementDocument = document.documentType === "medicao";
  const compositionLinkedCount = sections.reduce((count, section) => count + countCompositionItems(section.items), 0);

  return (
    <Layout
      title={document.title}
      subtitle={isMeasurementDocument
        ? `Medição técnica · revisão ${document.revision ?? "-"} · ${document.status}`
        : `Orçamento · revisão ${document.revision ?? "-"} · ${currency} · ${document.status}`}
      actions={
        <>
          {!isClientView && document.status === "rascunho" && (
            <button onClick={() => handleStatusChange("submetido")} disabled={changingStatus} className="btn btn-secondary btn-sm">
              <IconChart className="w-3.5 h-3.5" /> Submeter para aprovação
            </button>
          )}
          {!isClientView && document.status === "submetido" && (
            <>
              <button onClick={() => handleStatusChange("rascunho")} disabled={changingStatus} className="btn btn-secondary btn-sm">Devolver</button>
              <button onClick={() => handleStatusChange("aprovado")} disabled={changingStatus} className="btn btn-sm bg-emerald-600 text-white hover:bg-emerald-500">
                <IconChart className="w-3.5 h-3.5" /> Aprovar
              </button>
            </>
          )}
          {!isClientView && <button
            onClick={() => compositionLinkedCount > 0 ? setShowWizard(true) : handlePrepareAutomaticDocument()}
            disabled={preparingAutomaticDocument}
            className="btn btn-secondary btn-sm"
          >
            <IconRuler className="w-3.5 h-3.5" />
            {compositionLinkedCount > 0 ? "Assistente de Medições" : preparingAutomaticDocument ? "A preparar..." : "Medir pelas plantas"}
          </button>}
          {!isMeasurementDocument && <button onClick={() => setShowMaterialsByPhase(true)} className="btn btn-secondary btn-sm">
            <IconClipboard className="w-3.5 h-3.5" />
            Materiais por Fase
          </button>}
          {!isMeasurementDocument && document.lastEstimateReport && (
            <button onClick={() => setShowReport(true)} className="btn btn-secondary btn-sm">
              <IconChart className="w-3.5 h-3.5" />
              Relatório de Cálculos
            </button>
          )}
          <a href={isMeasurementDocument ? boqApi.measurementExcelUrl(document.id) : `/api/budget-documents/${document.id}/export.xlsx`} className="btn btn-secondary btn-sm">
            <IconDownload className="w-3.5 h-3.5" />
            {isMeasurementDocument ? "Quantidades Excel" : "Excel"}
          </a>
          <a href={isMeasurementDocument ? boqApi.measurementPdfUrl(document.id) : `/api/budget-documents/${document.id}/export.pdf`} className="btn btn-secondary btn-sm">
            <IconDownload className="w-3.5 h-3.5" />
            {isMeasurementDocument ? "Quantidades PDF" : "PDF"}
          </a>
          {isMeasurementDocument && !isClientView && <button type="button" onClick={handleSubmitToBudget} disabled={submittingToBudget} className="btn btn-primary btn-sm">
            <IconDoc className="w-3.5 h-3.5" />
            {submittingToBudget ? "A enviar..." : "Enviar para orçamento"}
          </button>}
          <Link to={`/projectos/${document.projectId}`} className="btn btn-ghost btn-sm">
            <IconBack className="w-3.5 h-3.5" />
            Projecto
          </Link>
          {!isClientView && <button onClick={handleDeleteDocument} className="icon-btn-danger" title="Eliminar documento">
            <IconTrash className="w-3.5 h-3.5" />
          </button>}
        </>
      }
    >
      <div className="space-y-5">
        <ProjectWorkspaceNav projectId={document.projectId} measurementOnly={isMeasurementDocument && project?.projectType === "medicao"} />
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
        {isMeasurementDocument && <section className="card flex flex-col gap-3 border-l-4 border-l-blue-600 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div><strong className="text-sm text-slate-950">Documento técnico de medição</strong><p className="mt-1 text-xs text-slate-500">Aqui trabalham-se apenas quantidades e memória de cálculo. Os preços são aplicados depois, no orçamento.</p></div>
          <span className="badge badge-brand shrink-0">Sem preços</span>
        </section>}

        {/* Coluna principal: secções e itens */}
        <div className="min-w-0 space-y-5">
          {error && <p className="text-sm text-red-600">{error}</p>}

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
                      ? "Actualize os preços depois de alterar cotações ou a zona da obra. Quantidades e preços manuais não mudam."
                      : "Este mapa usa preços próprios; o SIGO preserva os valores recebidos."}
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
              <button
                type="button"
                onClick={() => compositionLinkedCount > 0 ? setShowRepriceConfirm(true) : handlePrepareAutomaticDocument()}
                disabled={compositionLinkedCount > 0 ? document.status !== "rascunho" || repricing : preparingAutomaticDocument}
                className="btn btn-secondary btn-sm shrink-0"
              >
                {compositionLinkedCount > 0 ? <IconRefresh className="h-3.5 w-3.5" /> : <IconRuler className="h-3.5 w-3.5" />}
                {compositionLinkedCount > 0 ? "Actualizar preços" : preparingAutomaticDocument ? "A preparar..." : "Preparar medição pelas plantas"}
              </button>
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

          <PageSearch value={itemQuery} onChange={setItemQuery} placeholder="Pesquisar código, descrição, unidade ou secção…" resultLabel={`${visibleSections.length} secção(ões)`} />

          {visibleSections.map((section) => (
            <section key={section.id} className="card overflow-hidden">
              <SectionHeader title={section.name} description={`${section.items.length} capítulo(s) ou item(ns)`} actions={
                isMeasurementDocument
                  ? undefined
                  : <span className="text-sm font-bold text-slate-900 tabular-nums">{money(section.sellingTotal, currency)}</span>
              } />

              <div className="px-3 py-2 overflow-x-auto">
                {section.items.length === 0 ? (
                  <p className="text-sm text-gray-400 py-4 text-center">Secção vazia — adicione o primeiro capítulo abaixo.</p>
                ) : (
                  <table className="w-full min-w-[500px] border-collapse sm:min-w-[720px]">
                    <BoqHeaderRow measurementOnly={isMeasurementDocument} />
                    <BoqTableHead readOnly={isClientView} measurementOnly={isMeasurementDocument} />
                    <tbody>
                      {section.items.map((item) => (
                        <LineItemRow key={item.id} node={item} depth={0} sectionId={section.id} compositions={compositions} onChange={reload} readOnly={isClientView} measurementOnly={isMeasurementDocument} />
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {!isClientView && <div className="px-3 pb-3">
                {addingIn === section.id ? (
                  <AddChildForm
                    sectionId={section.id}
                    parentId={null}
                    compositions={compositions}
                    measurementOnly={isMeasurementDocument}
                    onDone={() => {
                      setAddingIn(null);
                      reload();
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
          {visibleSections.length === 0 && <div className="card px-5 py-12 text-center text-sm text-slate-500">Nenhum item do mapa corresponde à pesquisa.</div>}

          {!isClientView && <details className="card overflow-hidden">
            <summary className="cursor-pointer px-5 py-4 hover:bg-slate-50">
              <span className="text-sm font-semibold text-slate-900">Opções manuais e importações</span>
              <span className="ml-2 text-xs font-normal text-slate-500">Adicionar secções ou usar medições já preparadas em Excel</span>
            </summary>
          <section className="border-t border-slate-200">
            <SectionHeader title="Estrutura do orçamento" description="Adicione uma nova secção, edifício ou área da obra" />
            <form onSubmit={handleAddSection} className="flex gap-2 items-end p-5">
              <input
                required
                placeholder="ex: Edifício Principal, Preliminares e Gerais, Arranjos Exteriores"
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

          <section className="border-t border-slate-200">
            <SectionHeader title="Importar medições" description="Actualize quantidades a partir de um ficheiro Excel" />
            <div className="p-5">
            <p className="text-xs text-gray-500 mb-3 max-w-3xl">
              O Excel deve conter “Item”/“Código” e “Quant.”. Apenas as quantidades são actualizadas.
            </p>
            <form onSubmit={handleImportMeasurements} className="flex gap-2 items-end flex-wrap">
              <div className="flex-1 min-w-[180px]">
                <input
                  type="file"
                  name="measurementsFile"
                  accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  required
                  className="input py-1.5 file:mr-3 file:rounded-md file:border-0 file:bg-brand-100 file:text-brand-800 file:px-2.5 file:py-1 file:text-xs file:font-medium"
                />
              </div>
              <button type="submit" disabled={importingMeasurements} className="btn btn-primary">
                <IconDownload className="w-3.5 h-3.5" />
                {importingMeasurements ? "A importar..." : "Importar"}
              </button>
            </form>
            {importResult && (
              <div className="mt-3 rounded-lg bg-green-50 border border-green-200 p-3 text-sm">
                <p className="font-medium text-green-800">
                  {importResult.itemsUpdated} de {importResult.rowsRead} linha(s) do Excel aplicadas com sucesso.
                </p>
                {importResult.unmatched.length > 0 && (
                  <>
                    <p className="text-amber-700 mt-2 font-medium">
                      {importResult.unmatched.length} linha(s) não foram aplicadas:
                    </p>
                    <ul className="text-xs text-amber-800 mt-1 space-y-0.5 max-h-32 overflow-y-auto">
                      {importResult.unmatched.map((u, i) => (
                        <li key={`${u.sheet}-${u.rowNumber}-${i}`}>
                          Folha "{u.sheet}", linha {u.rowNumber}: código "{u.code}", quantidade {u.quantity} — {u.reason}.
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
            </div>
          </section>
          </details>}
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
                {!isClientView && (
                  <button type="button" onClick={() => setShowFinancialSettings((value) => !value)} className="btn btn-secondary btn-sm mb-4 w-full">
                    {showFinancialSettings ? "Ocultar formação do preço" : "Editar formação do preço"}
                  </button>
                )}
                {showFinancialSettings && (
                  <form onSubmit={handleFinancialSettings} className="mb-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="text-xs text-slate-600">Estaleiro (%)
                        <input name="siteCostsRate" type="number" min="0" max="100" step="0.1" defaultValue={Number(document.siteCostsRate) * 100} className="input mt-1" />
                      </label>
                      <label className="text-xs text-slate-600">Indirectos (%)
                        <input name="indirectCostsRate" type="number" min="0" max="100" step="0.1" defaultValue={Number(document.indirectCostsRate) * 100} className="input mt-1" />
                      </label>
                      <label className="text-xs text-slate-600">Margem (%)
                        <input name="profitMarginRate" type="number" min="0" max="100" step="0.1" defaultValue={Number(document.profitMarginRate) * 100} className="input mt-1" />
                      </label>
                      <label className="text-xs text-slate-600">Contingências (%)
                        <input name="contingenciasRate" type="number" min="0" max="100" step="0.1" defaultValue={Number(document.contingenciasRate) * 100} className="input mt-1" />
                      </label>
                      <label className="text-xs text-slate-600 sm:col-span-2">IVA (%)
                        <input name="ivaRate" type="number" min="0" max="100" step="0.1" defaultValue={Number(document.ivaRate) * 100} className="input mt-1" />
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
                  {!isClientView && <div className="flex justify-between text-slate-500"><dt>Estaleiro ({(Number(document.siteCostsRate) * 100).toFixed(1)}%)</dt><dd className="tabular-nums">{money(siteCosts, "")}</dd></div>}
                  {!isClientView && <div className="flex justify-between text-slate-500"><dt>Indirectos ({(Number(document.indirectCostsRate) * 100).toFixed(1)}%)</dt><dd className="tabular-nums">{money(indirectCosts, "")}</dd></div>}
                  {!isClientView && <div className="flex justify-between text-slate-500"><dt>Margem ({(Number(document.profitMarginRate) * 100).toFixed(1)}%)</dt><dd className="tabular-nums">{money(profitMargin, "")}</dd></div>}
                  {!isClientView && <div className="flex justify-between font-medium text-slate-700"><dt>Preço de venda</dt><dd className="tabular-nums">{money(sellingSubtotal, "")}</dd></div>}
                  <div className="flex justify-between text-slate-500"><dt>Contingências ({(Number(document.contingenciasRate) * 100).toFixed(0)}%)</dt><dd className="tabular-nums">{money(contingencias, "")}</dd></div>
                  <div className="flex justify-between text-slate-700"><dt>Base tributável</dt><dd className="tabular-nums">{money(subtotal2, "")}</dd></div>
                  <div className="flex justify-between text-slate-500"><dt>IVA ({(Number(document.ivaRate) * 100).toFixed(0)}%)</dt><dd className="tabular-nums">{money(iva, "")}</dd></div>
                </dl>
                <div className="mt-4 flex flex-col gap-1 border-t border-slate-300 pt-4 sm:flex-row sm:items-baseline sm:justify-between">
                  <span className="text-sm font-semibold text-slate-700">Valor total</span>
                  <span className="text-2xl font-bold tabular-nums text-slate-950">{money(total, currency)}</span>
                </div>
                {dashboard?.hasCertificates && (
                  <div className="mt-5 rounded-xl bg-slate-50 p-4">
                    <div className="mb-2 flex justify-between gap-3 text-sm">
                      <span className="text-slate-500">Execução · Auto Nº {dashboard.latestCertificateNumber}</span>
                      <strong className="tabular-nums text-slate-900">{dashboard.percentExecutado.toFixed(1)}%</strong>
                    </div>
                    <div className="h-2 w-full rounded-full bg-slate-200">
                      <div className="h-2 rounded-full bg-brand-600" style={{ width: `${Math.min(100, dashboard.percentExecutado).toFixed(1)}%` }} />
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>
        </ModalPortal>
      )}

      {!isClientView && showWizard && documentId && (
        <QuickEstimateWizard
          documentId={documentId}
          structuralSummary={structuralPlant?.structuralSummary}
          structuralPlantName={structuralPlant?.originalFileName}
          architectureRooms={architectureRooms}
          architecturePlantName={architecturePlant?.originalFileName}
          zoneId={project?.zoneId}
          documentCurrency={document.currency}
          onClose={() => {
            setShowWizard(false);
            reload();
          }}
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
          message="O SIGO recalculará apenas os itens ligados a composições, usando os preços adoptados para a zona actual da obra. Quantidades e preços manuais permanecem iguais."
          confirmLabel="Actualizar preços"
          busy={repricing}
          onConfirm={handleReprice}
          onCancel={() => setShowRepriceConfirm(false)}
        />
      )}

    </Layout>
  );
}

import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { boqApi, type BudgetDocumentSummary, type BudgetRepriceResult, type LineItemNode, type MeasurementImportResult } from "../api/boq";
import { catalogApi, type CostComposition } from "../api/catalog";
import { measurementApi, type MeasurementDashboard } from "../api/measurement";
import { plantsApi, type Plant, type ExtractedRoom } from "../api/plants";
import LineItemRow, { AddChildForm, BoqHeaderRow, BoqTableHead } from "../components/LineItemRow";
import QuickEstimateWizard from "../components/QuickEstimateWizard";
import CalculationReportView from "../components/CalculationReportView";
import MaterialsByPhaseModal from "../components/MaterialsByPhaseModal";
import ConfirmDialog from "../components/ConfirmDialog";
import Layout from "../components/Layout";
import { SectionHeader } from "../components/WorkspaceUI";
import { IconBack, IconChart, IconClipboard, IconDownload, IconPlus, IconRefresh, IconTrash, IconWand } from "../components/icons";

function money(value: number, currency: string) {
  return `${value.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function countCompositionItems(items: LineItemNode[]): number {
  return items.reduce(
    (total, item) => total + (item.compositionId ? 1 : 0) + countCompositionItems(item.children),
    0,
  );
}

export default function BudgetDocumentPage() {
  const { documentId } = useParams<{ documentId: string }>();
  const navigate = useNavigate();
  const [summary, setSummary] = useState<BudgetDocumentSummary | null>(null);
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

  async function reload() {
    if (!documentId) return;
    const s = await boqApi.getBudgetDocumentSummary(documentId);
    setSummary(s);
    setDashboard(await measurementApi.dashboard(s.document.projectId, documentId));
  }

  useEffect(() => {
    if (!documentId) return;
    boqApi
      .getBudgetDocumentSummary(documentId)
      .then(async (s) => {
        setSummary(s);
        const [c, d, plants] = await Promise.all([
          catalogApi.listCompositions(),
          measurementApi.dashboard(s.document.projectId, documentId),
          plantsApi.list(s.document.projectId),
        ]);
        setCompositions(c);
        setDashboard(d);
        const processed = plants.filter((p) => p.processingStatus === "concluido");

        // A planta estrutural é escolhida pelo que ela TEM (resumo estrutural real), não só
        // pela etiqueta de disciplina escolhida ao carregar — o extractor lê o que encontrar no
        // ficheiro independentemente da etiqueta (ver Ronda 12), por isso um ficheiro estrutural
        // com a disciplina trocada por engano (ex: carregado como "arquitectura") não pode
        // deixar de alimentar o Assistente só por causa da etiqueta errada.
        const structural =
          processed.find((p) => p.discipline === "estrutura" && p.structuralSummary) ??
          processed.find((p) => p.structuralSummary);
        setStructuralPlant(structural ?? null);

        // Idem para compartimentos: procura em TODAS as plantas processadas (não só nas
        // etiquetadas "arquitectura") a primeira que realmente tenha compartimentos extraídos —
        // evita que uma planta sem compartimentos (ex: um projecto estrutural mal etiquetado,
        // que o `.find` anterior escolhia por ser a primeira "arquitectura" da lista) bloqueie a
        // procura antes de chegar à planta que os tem mesmo.
        for (const p of processed) {
          const detail = await plantsApi.detail(p.id);
          if (detail.rooms.length > 0) {
            setArchitecturePlant(p);
            setArchitectureRooms(detail.rooms);
            break;
          }
        }
      })
      .catch((err) => setError(err.message));
  }, [documentId]);

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

  if (!summary) {
    return <div className="min-h-screen flex items-center justify-center text-gray-400">A carregar...</div>;
  }

  const { document, sections, subtotal1, contingencias, subtotal2, iva, total } = summary;
  const currency = document.currency;
  const compositionLinkedCount = sections.reduce((count, section) => count + countCompositionItems(section.items), 0);

  return (
    <Layout
      title={document.title}
      subtitle={`Revisão ${document.revision ?? "-"} · ${currency} · IVA ${(Number(document.ivaRate) * 100).toFixed(0)}% · Contingências ${(Number(document.contingenciasRate) * 100).toFixed(0)}%`}
      actions={
        <>
          <button onClick={() => setShowWizard(true)} className="btn btn-secondary btn-sm">
            <IconWand className="w-3.5 h-3.5" />
            Assistente de Medições
          </button>
          <button onClick={() => setShowMaterialsByPhase(true)} className="btn btn-secondary btn-sm">
            <IconClipboard className="w-3.5 h-3.5" />
            Materiais por Fase
          </button>
          {document.lastEstimateReport && (
            <button onClick={() => setShowReport(true)} className="btn btn-secondary btn-sm">
              <IconChart className="w-3.5 h-3.5" />
              Relatório de Cálculos
            </button>
          )}
          <a href={`/api/budget-documents/${document.id}/export.xlsx`} className="btn btn-secondary btn-sm">
            <IconDownload className="w-3.5 h-3.5" />
            Excel
          </a>
          <a href={`/api/budget-documents/${document.id}/export.pdf`} className="btn btn-secondary btn-sm">
            <IconDownload className="w-3.5 h-3.5" />
            PDF
          </a>
          <Link to={`/projectos/${document.projectId}`} className="btn btn-ghost btn-sm">
            <IconBack className="w-3.5 h-3.5" />
            Projecto
          </Link>
          <button onClick={handleDeleteDocument} className="icon-btn-danger" title="Eliminar documento">
            <IconTrash className="w-3.5 h-3.5" />
          </button>
        </>
      }
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        {/* Coluna principal: secções e itens */}
        <div className="space-y-5 min-w-0">
          {error && <p className="text-sm text-red-600">{error}</p>}

          <section className="card card-pad border-l-4 border-l-brand-500">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                  <IconRefresh className="h-4 w-4" />
                </span>
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Preços ligados ao catálogo</h2>
                  <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">
                    Os itens com composição guardam o preço do momento em que foram criados. Actualize-os quando adoptar novas
                    cotações ou alterar a zona; quantidades e preços introduzidos manualmente não serão modificados.
                  </p>
                  <p className={`mt-2 text-xs font-medium ${compositionLinkedCount > 0 ? "text-slate-700" : "text-amber-700"}`}>
                    {compositionLinkedCount > 0
                      ? `${compositionLinkedCount} item(ns) deste documento estão ligados a composições.`
                      : "Este documento usa apenas preços manuais; associe composições aos itens para receber actualizações do catálogo."}
                  </p>
                  {document.status !== "rascunho" && (
                    <p className="mt-2 text-xs font-medium text-amber-700">
                      Documento protegido ({document.status}). Crie uma nova revisão para recalcular preços.
                    </p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowRepriceConfirm(true)}
                disabled={document.status !== "rascunho" || repricing || compositionLinkedCount === 0}
                className="btn btn-secondary btn-sm shrink-0"
              >
                <IconRefresh className="h-3.5 w-3.5" />
                Actualizar preços
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
          </section>

          {sections.map((section) => (
            <section key={section.id} className="card overflow-hidden">
              <SectionHeader title={section.name} description={`${section.items.length} capítulo(s) ou item(ns)`} actions={
                <span className="text-sm font-bold text-slate-900 tabular-nums">{money(section.total, currency)}</span>
              } />

              <div className="px-3 py-2 overflow-x-auto">
                {section.items.length === 0 ? (
                  <p className="text-sm text-gray-400 py-4 text-center">Secção vazia — adicione o primeiro capítulo abaixo.</p>
                ) : (
                  <table className="w-full min-w-[720px] border-collapse">
                    <BoqHeaderRow />
                    <BoqTableHead />
                    <tbody>
                      {section.items.map((item) => (
                        <LineItemRow key={item.id} node={item} depth={0} sectionId={section.id} compositions={compositions} onChange={reload} />
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="px-3 pb-3">
                {addingIn === section.id ? (
                  <AddChildForm
                    sectionId={section.id}
                    parentId={null}
                    compositions={compositions}
                    onDone={() => {
                      setAddingIn(null);
                      reload();
                    }}
                  />
                ) : (
                  <button onClick={() => setAddingIn(section.id)} className="btn btn-ghost btn-sm">
                    <IconPlus className="w-3.5 h-3.5" />
                    Adicionar capítulo / item
                  </button>
                )}
              </div>
            </section>
          ))}

          <section className="card overflow-hidden">
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

          <section className="card overflow-hidden">
            <SectionHeader title="Importar medições" description="Actualize quantidades a partir de um ficheiro Excel" />
            <div className="p-5">
            <p className="text-xs text-gray-500 mb-3 max-w-3xl">
              Já tem as quantidades medidas à mão (ex: pelo técnico da obra)? Carregue o ficheiro — o sistema lê a coluna
              "Item"/"Código" e "Quant." e aplica as quantidades directamente aos itens-padrão existentes (pelo código),
              sem criar itens novos nem passar pelo Assistente. Os preços continuam a vir do catálogo.
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
        </div>

        {/* Coluna lateral: RESUMO fixo + execução */}
        <div className="space-y-5">
          <section className="card overflow-hidden xl:sticky xl:top-24 border-t-4 border-t-[#e86f25]">
            <div className="bg-white p-5">
              <h2 className="font-semibold mb-4 text-sm text-slate-900">Resumo do orçamento</h2>
              <dl className="space-y-1.5 text-sm">
                {sections.map((s) => (
                  <div key={s.id} className="flex justify-between text-slate-600">
                    <dt className="truncate pr-2">{s.name}</dt>
                    <dd className="tabular-nums shrink-0">{money(s.total, "")}</dd>
                  </div>
                ))}
                <div className="flex justify-between border-t border-slate-200 pt-2 mt-2 text-slate-700">
                  <dt>Subtotal</dt>
                  <dd className="tabular-nums">{money(subtotal1, "")}</dd>
                </div>
                <div className="flex justify-between text-slate-500">
                  <dt>Contingências ({(Number(document.contingenciasRate) * 100).toFixed(0)}%)</dt>
                  <dd className="tabular-nums">{money(contingencias, "")}</dd>
                </div>
                <div className="flex justify-between text-slate-700">
                  <dt>Subtotal 2</dt>
                  <dd className="tabular-nums">{money(subtotal2, "")}</dd>
                </div>
                <div className="flex justify-between text-slate-500">
                  <dt>IVA ({(Number(document.ivaRate) * 100).toFixed(0)}%)</dt>
                  <dd className="tabular-nums">{money(iva, "")}</dd>
                </div>
              </dl>
              <div className="flex justify-between items-baseline border-t border-slate-300 pt-3 mt-3">
                <span className="text-sm font-semibold text-slate-700">Valor total</span>
                <span className="text-xl font-bold tabular-nums text-slate-950">{money(total, currency)}</span>
              </div>
            </div>

            {dashboard?.hasCertificates && (
              <div className="p-5">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
                  Execução — Auto Nº {dashboard.latestCertificateNumber}
                </h3>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-500">Executado</span>
                  <span className="font-semibold text-gray-900 tabular-nums">{money(dashboard.executadoTotal, currency)}</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2">
                  <div
                    className="bg-brand-600 h-2 rounded-full transition-all"
                    style={{ width: `${Math.min(100, dashboard.percentExecutado).toFixed(1)}%` }}
                  />
                </div>
                <p className="muted text-right mt-1">{dashboard.percentExecutado.toFixed(1)}% do previsto</p>
              </div>
            )}
          </section>

          <div className="card card-pad text-xs text-gray-500 leading-relaxed">
            <p className="font-medium text-gray-700 mb-1">Dicas</p>
            <p>• Passe o rato sobre uma linha para ver as acções (medições, adicionar, eliminar).</p>
            <p>• A régua abre as medições dimensionais — a quantidade passa a ser calculada por Nº × Comp. × Larg. × Alt.</p>
            <p>• Ao escolher uma composição no lugar do preço manual, o preço unitário vem do catálogo.</p>
          </div>
        </div>
      </div>

      {showWizard && documentId && (
        <QuickEstimateWizard
          documentId={documentId}
          structuralSummary={structuralPlant?.structuralSummary}
          structuralPlantName={structuralPlant?.originalFileName}
          architectureRooms={architectureRooms}
          architecturePlantName={architecturePlant?.originalFileName}
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
      )}

      {showRepriceConfirm && (
        <ConfirmDialog
          title="Actualizar preços do orçamento?"
          message="O SIGA recalculará apenas os itens ligados a composições, usando os preços adoptados para a zona actual da obra. Quantidades e preços manuais permanecem iguais."
          confirmLabel="Actualizar preços"
          busy={repricing}
          onConfirm={handleReprice}
          onCancel={() => setShowRepriceConfirm(false)}
        />
      )}
    </Layout>
  );
}

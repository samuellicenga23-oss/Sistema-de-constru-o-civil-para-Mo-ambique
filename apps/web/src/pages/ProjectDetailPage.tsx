import { useEffect, useState, type FormEvent, type MouseEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { boqApi, type BudgetDocument, type Project } from "../api/boq";
import { measurementApi, type MeasurementCertificate } from "../api/measurement";
import { plantsApi, type Plant, type PlantProcessingProgress, type PlantUploadDiscipline } from "../api/plants";
import { catalogApi, type PriceZone } from "../api/catalog";
import { suppliersApi } from "../api/suppliers";
import Layout from "../components/Layout";
import { MetricCard, SectionHeader } from "../components/WorkspaceUI";
import ProjectWorkspaceNav from "../components/ProjectWorkspaceNav";
import { IconBack, IconDoc, IconClipboard, IconMap, IconPlus, IconTrash, IconUpload, IconWand } from "../components/icons";

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
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
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
  const [plantDiscipline, setPlantDiscipline] = useState<PlantUploadDiscipline>("auto");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<PlantProcessingProgress | null>(null);
  const [preparingMeasurements, setPreparingMeasurements] = useState(false);
  const [reprocessingPlantId, setReprocessingPlantId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [costReadiness, setCostReadiness] = useState({ materials: 0, quoted: 0, zonePriced: 0, suppliers: 0, compositions: 0 });

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
      const uploaded = await plantsApi.upload(projectId, file, plantDiscipline, setUploadProgress);
      fileInput.value = "";
      await reload();
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
      navigate(`/documentos/${document.id}?assistente=1`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível preparar as medições");
    } finally {
      setPreparingMeasurements(false);
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

  const completedPlants = plants.filter((plant) => plant.processingStatus === "concluido");
  const failedPlants = plants.filter((plant) => plant.processingStatus === "erro");
  const hasMeasuredBudget = documents.some((document) => document.lastEstimateReport?.entries?.length);
  const latestCompletedPlant = completedPlants[completedPlants.length - 1];

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
        {searchParams.get("uploadErro") === "1" && (
          <div className="lg:col-span-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            O projecto foi criado, mas um dos ficheiros não pôde ser analisado. O registo da obra está seguro; reveja abaixo o ficheiro com falha ou carregue-o novamente.
          </div>
        )}

        <section className="card lg:col-span-2 overflow-hidden border-t-4 border-t-brand-600">
          <SectionHeader
            title="Da planta ao orçamento"
            description="Um percurso único: carregar, confirmar o que foi lido, completar dados em falta e gerar as medições"
            actions={
              completedPlants.length > 0 ? (
                <button onClick={handlePrepareMeasurements} disabled={preparingMeasurements} className="btn btn-primary btn-sm">
                  <IconWand className="h-3.5 w-3.5" />
                  {preparingMeasurements ? "A preparar..." : hasMeasuredBudget ? "Rever medições" : "Preparar medições"}
                </button>
              ) : (
                <a href="#plantas-do-projecto" className="btn btn-primary btn-sm">
                  <IconUpload className="h-3.5 w-3.5" /> Carregar plantas
                </a>
              )
            }
          />
          <div className="grid gap-px bg-slate-200 sm:grid-cols-4">
            {[
              { label: "1. Identificar a obra", detail: "Projecto criado", done: true },
              { label: "2. Carregar projectos", detail: plants.length ? `${plants.length} ficheiro(s)` : "Arquitectura, estrutura ou ambos", done: plants.length > 0 },
              { label: "3. Confirmar dados", detail: failedPlants.length ? `${failedPlants.length} ficheiro(s) requerem atenção` : completedPlants.length ? "Dados prontos para revisão" : "A aguardar análise", done: completedPlants.length > 0 && failedPlants.length === 0 },
              { label: "4. Medir e orçamentar", detail: hasMeasuredBudget ? "Medições geradas" : "Diagnóstico antes do cálculo", done: hasMeasuredBudget },
            ].map((step) => (
              <div key={step.label} className="bg-white p-4">
                <div className="flex items-center gap-2">
                  <span className={`grid h-6 w-6 place-items-center rounded-full text-xs font-bold ${step.done ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{step.done ? "✓" : "·"}</span>
                  <p className="text-sm font-semibold text-slate-900">{step.label}</p>
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-500">{step.detail}</p>
              </div>
            ))}
          </div>
          {latestCompletedPlant && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3 text-xs text-slate-600">
              <span>Último ficheiro analisado: <strong className="text-slate-800">{latestCompletedPlant.originalFileName}</strong></span>
              <Link to={`/plantas/${latestCompletedPlant.id}`} className="font-semibold text-brand-700 hover:underline">Rever dados extraídos →</Link>
            </div>
          )}
        </section>

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

        <section className="card lg:col-span-2 overflow-hidden">
          <SectionHeader title="Cadeia de custos da obra" description="A ordem usada pelo SIGO para transformar cotações de mercado em preços de orçamento" actions={<Link to="/catalogo" className="btn btn-secondary btn-sm">Abrir catálogo</Link>} />
          <div className="grid gap-px bg-slate-200 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { n: 1, title: "Zona da obra", value: project.zoneId ? "Definida" : "Em falta", detail: project.zoneId ? zones.find((zone) => zone.id === project.zoneId)?.name ?? "Zona seleccionada" : "Defina a zona antes de validar preços.", ok: Boolean(project.zoneId) },
              { n: 2, title: "Fornecedores e cotações", value: `${costReadiness.quoted}/${costReadiness.materials}`, detail: `${costReadiness.suppliers} fornecedor(es); materiais com cotação aplicável.`, ok: costReadiness.suppliers > 0 && costReadiness.quoted > 0 },
              { n: 3, title: "Preços adoptados", value: `${costReadiness.zonePriced}/${costReadiness.materials}`, detail: project.zoneId ? "Preços próprios da zona; restantes usam preço base." : "A aguardar zona para validar cobertura.", ok: Boolean(project.zoneId) && costReadiness.zonePriced === costReadiness.materials },
              { n: 4, title: "Composições", value: String(costReadiness.compositions), detail: "Mão-de-obra + materiais + máquinas alimentam o orçamento.", ok: costReadiness.compositions > 0 },
            ].map((item) => (
              <div key={item.n} className="bg-white p-4">
                <div className="flex items-center gap-2"><span className={`grid h-6 w-6 place-items-center rounded-full text-xs font-bold ${item.ok ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{item.ok ? "✓" : item.n}</span><p className="text-sm font-semibold text-slate-900">{item.title}</p></div>
                <p className="mt-3 text-lg font-bold text-slate-900">{item.value}</p><p className="mt-1 text-xs leading-5 text-slate-500">{item.detail}</p>
              </div>
            ))}
          </div>
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
          <details className="border-t border-gray-100">
            <summary className="cursor-pointer px-5 py-3 text-xs font-semibold text-slate-600 hover:bg-slate-50">Criar outro mapa ou revisão manual</summary>
            <form onSubmit={handleCreate} className="flex gap-2 items-end px-5 pb-4 flex-wrap">
              <div className="flex-1 min-w-[150px]">
                <label className="label">Título do novo documento</label>
                <input value={title} onChange={(e) => setTitle(e.target.value)} className="input" />
              </div>
              <div>
                <label className="label">Modelo</label>
                <select value={template} onChange={(e) => setTemplate(e.target.value as "padrao" | "vazio")} className="input">
                  <option value="padrao">Estrutura SIGO ligada ao catálogo</option>
                  <option value="vazio">Documento vazio/manual</option>
                </select>
              </div>
              <button type="submit" className="btn btn-secondary"><IconPlus className="w-4 h-4" /> Criar</button>
            </form>
          </details>
        </section>

        {/* Plantas */}
        <section id="plantas-do-projecto" className="card scroll-mt-24">
          <SectionHeader title="Projectos e desenhos" description="Carregue arquitectura, estrutura ou outras disciplinas disponíveis" actions={<IconMap className="w-4 h-4 text-blue-700" />} />
          <ul>
            {plants.map((p) => (
              <li key={p.id} className="table-row group">
                {p.processingStatus === "concluido" ? (
                  <Link to={`/plantas/${p.id}`} className="flex items-center justify-between px-5 py-3">
                    <span className="min-w-0 pr-3">
                      <span className="block font-medium text-gray-900 truncate">{p.originalFileName}</span>
                      {p.documentAnalysis && (
                        <span className="mt-0.5 block truncate text-[11px] text-slate-500">
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
                        className="icon-btn-danger opacity-0 pointer-coarse:opacity-100 group-hover:opacity-100 transition-opacity"
                        title="Eliminar planta"
                      >
                        <IconTrash className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  </Link>
                ) : (
                  <div className="flex items-center justify-between px-5 py-3">
                    <span className="min-w-0 pr-2"><span className="block font-medium text-gray-500 truncate">{p.originalFileName}</span>{p.processingStatus === "processando" && <span className="block text-[11px] text-blue-700">{p.processingStage ?? "A analisar"}{p.processingCurrentPage && p.processingTotalPages ? ` · página ${p.processingCurrentPage}/${p.processingTotalPages}` : ""}</span>}</span>
                    <span className="flex items-center gap-2 shrink-0">
                      <span className={`badge ${PLANT_STATUS_BADGE[p.processingStatus].cls}`}>{p.processingStatus === "processando" ? `${p.processingProgress}%` : PLANT_STATUS_BADGE[p.processingStatus].label}</span>
                      {p.processingStatus === "erro" && (
                        <button onClick={(e) => handleReprocessPlant(e, p.id)} disabled={reprocessingPlantId === p.id} className="btn btn-secondary btn-sm">
                          {reprocessingPlantId === p.id ? "A tentar..." : "Tentar novamente"}
                        </button>
                      )}
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
                Carregue um projecto completo ou ficheiros separados. O SIGO identifica as disciplinas e organiza as páginas automaticamente antes do diagnóstico.
              </li>
            )}
          </ul>
          <form onSubmit={handleUploadPlant} className="flex gap-2 items-end px-5 py-4 border-t border-gray-100 flex-wrap">
            {uploading && uploadProgress && <div className="w-full rounded-xl border border-blue-100 bg-blue-50/70 p-4 mb-2" aria-live="polite"><div className="flex justify-between gap-4"><div><p className="text-sm font-semibold text-blue-950">{uploadProgress.processingStage ?? "A analisar o PDF"}</p><p className="text-xs text-blue-800/70">{uploadProgress.processingCurrentPage && uploadProgress.processingTotalPages ? `Página ${uploadProgress.processingCurrentPage} de ${uploadProgress.processingTotalPages}` : "O ficheiro está a ser preparado para leitura."}</p></div><strong className="text-xl tabular-nums text-blue-950">{uploadProgress.processingProgress}%</strong></div><div className="mt-3 h-2.5 overflow-hidden rounded-full bg-blue-100" role="progressbar" aria-valuenow={uploadProgress.processingProgress} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full bg-blue-600 transition-[width] duration-300" style={{ width: `${uploadProgress.processingProgress}%` }} /></div></div>}
            <div>
              <label className="label">Modo de leitura</label>
              <select value={plantDiscipline} onChange={(e) => setPlantDiscipline(e.target.value as PlantUploadDiscipline)} className="input">
                <option value="auto">Detectar automaticamente</option>
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
              {uploading ? `${uploadProgress?.processingProgress ?? 0}% analisado` : plants.length > 0 ? "Adicionar projecto" : "Carregar e analisar"}
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

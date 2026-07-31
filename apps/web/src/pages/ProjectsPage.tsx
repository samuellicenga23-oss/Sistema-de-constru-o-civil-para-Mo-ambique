import { useEffect, useState, type FormEvent, type MouseEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { boqApi, type Project } from "../api/boq";
import { catalogApi, type PriceZone } from "../api/catalog";
import { plantsApi, type PlantProcessingProgress, type PlantUploadDiscipline } from "../api/plants";
import Layout from "../components/Layout";
import Modal from "../components/Modal";
import ConfirmDialog from "../components/ConfirmDialog";
import LoadingState from "../components/LoadingState";
import EmptyState from "../components/EmptyState";
import AlertBanner from "../components/AlertBanner";
import { IconFolder, IconPlus, IconTrash } from "../components/icons";
import { UNITS, type Unit } from "@sigo/shared";

type ProjectStartMode = "plantas" | "manual" | "importar";
type MaterialSpecificationDraft = { name: string; unit: Unit; specification: string };

export default function ProjectsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const workspace = location.pathname.startsWith("/medicoes") ? "medicoes" : "orcamentos";
  const [projects, setProjects] = useState<Project[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [currency, setCurrency] = useState<"MZN" | "USD">("MZN");
  const [startMode, setStartMode] = useState<ProjectStartMode>("plantas");
  const [materialSpecifications, setMaterialSpecifications] = useState<MaterialSpecificationDraft[]>([]);
  const [zoneId, setZoneId] = useState("");
  const [zones, setZones] = useState<PriceZone[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createProgress, setCreateProgress] = useState("");
  const [analysisProgress, setAnalysisProgress] = useState<{
    percent: number;
    filePercent: number;
    stage: string;
    fileName: string;
    currentFile: number;
    totalFiles: number;
    currentPage: number | null;
    totalPages: number | null;
  } | null>(null);
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

  useEffect(() => {
    setStartMode(workspace === "medicoes" ? "plantas" : "manual");
    setShowForm(false);
    setQuery("");
  }, [workspace]);

  const zoneName = (id: string | null) => zones.find((z) => z.id === id)?.name;
  const workspaceProjects = projects.filter((project) =>
    workspace === "medicoes"
      ? project.projectType === "medicao" || project.projectType === "hibrido"
      : project.projectType === "orcamento" || project.projectType === "hibrido",
  );
  const filteredProjects = workspaceProjects.filter((project) =>
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
    const completeFile = workspace === "medicoes" && startMode === "plantas" ? (form.elements.namedItem("completeProjectFile") as HTMLInputElement | null)?.files?.[0] : undefined;
    const architectureFile = workspace === "medicoes" && startMode === "plantas" ? (form.elements.namedItem("architectureFile") as HTMLInputElement | null)?.files?.[0] : undefined;
    const structuralFile = workspace === "medicoes" && startMode === "plantas" ? (form.elements.namedItem("structuralFile") as HTMLInputElement | null)?.files?.[0] : undefined;
    const measurementsFile = workspace === "orcamentos" && startMode === "importar" ? (form.elements.namedItem("measurementsFile") as HTMLInputElement | null)?.files?.[0] : undefined;
    setError(null);
    if (completeFile && (architectureFile || structuralFile)) {
      setError("Escolha o projecto completo ou os ficheiros separados — não é necessário enviar os dois formatos ao mesmo tempo.");
      return;
    }
    if (startMode === "importar" && !measurementsFile) {
      setError("Seleccione o ficheiro Excel com as medições.");
      return;
    }
    setCreating(true);
    setCreateProgress(workspace === "medicoes" ? "A criar medição..." : "A criar orçamento...");
    const technicalFiles: { file: File; discipline: PlantUploadDiscipline; label: string }[] = completeFile
      ? [{ file: completeFile, discipline: "auto", label: "projecto completo" }]
      : [
          architectureFile ? { file: architectureFile, discipline: "arquitectura" as const, label: "planta de arquitectura" } : null,
          structuralFile ? { file: structuralFile, discipline: "estrutura" as const, label: "projecto estrutural" } : null,
        ].filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    if (technicalFiles.length) setAnalysisProgress({ percent: 1, filePercent: 0, stage: "A criar o projecto", fileName: technicalFiles[0].file.name, currentFile: 1, totalFiles: technicalFiles.length, currentPage: null, totalPages: null });
    let createdProjectId: string | null = null;
    try {
      const created = await boqApi.createProject({
        name,
        client: client || undefined,
        currency,
        zoneId: zoneId || undefined,
        projectType: workspace === "medicoes" ? "medicao" : "orcamento",
        measurementMode: startMode,
        materialSpecifications: materialSpecifications
          .filter((item) => item.name.trim())
          .map((item) => ({ ...item, name: item.name.trim(), specification: item.specification.trim() || undefined })),
      });
      createdProjectId = created.id;

      const uploadedPlants = [];
      for (let index = 0; index < technicalFiles.length; index++) {
        const entry = technicalFiles[index];
        setCreateProgress(`A enviar ${entry.label}...`);
        const updateProgress = (progress: PlantProcessingProgress) => {
          const filePercent = progress.processingProgress;
          const overall = Math.round(((index + filePercent / 100) / technicalFiles.length) * 100);
          setAnalysisProgress({
            percent: overall,
            filePercent,
            stage: progress.processingStage ?? "A analisar o PDF",
            fileName: entry.file.name,
            currentFile: index + 1,
            totalFiles: technicalFiles.length,
            currentPage: progress.processingCurrentPage,
            totalPages: progress.processingTotalPages,
          });
        };
        uploadedPlants.push(await plantsApi.upload(created.id, entry.file, entry.discipline, updateProgress));
      }

      if (startMode === "importar" && measurementsFile && created.defaultDocumentId) {
        setCreateProgress("A importar medições...");
        await boqApi.importMeasurements(created.defaultDocumentId, measurementsFile);
        navigate(`/documentos/${created.defaultDocumentId}`);
      } else if (startMode === "manual" && created.defaultDocumentId) {
        navigate(workspace === "medicoes" ? `/documentos/${created.defaultDocumentId}?assistente=1` : `/documentos/${created.defaultDocumentId}`);
      } else {
        navigate(`/projectos/${created.id}#plantas-do-projecto`);
      }
    } catch (err) {
      if (createdProjectId) {
        const motivo = startMode === "importar" ? "excel" : startMode === "plantas" ? "planta" : "geral";
        navigate(`/projectos/${createdProjectId}?uploadErro=1&motivo=${motivo}`);
      } else {
        setError(err instanceof Error ? err.message : "Erro ao criar projecto");
      }
    } finally {
      setCreating(false);
      setCreateProgress("");
      setAnalysisProgress(null);
    }
  }

  return (
    <Layout
      title={workspace === "medicoes" ? "Medições" : "Orçamentos"}
      subtitle={workspace === "medicoes"
        ? `${workspaceProjects.length} obra(s) · quantidades e plantas`
        : `${workspaceProjects.length} obra(s) · preços e composições`}
      actions={
        <button onClick={() => setShowForm((s) => !s)} className="btn btn-primary btn-sm">
          <IconPlus className="w-3.5 h-3.5" />
          {workspace === "medicoes" ? "Nova medição" : "Novo orçamento"}
        </button>
      }
    >
      <div className="mx-auto w-full max-w-6xl space-y-5">
        {error && <AlertBanner tone="error" onDismiss={() => setError(null)}>{error}</AlertBanner>}

        {showForm && (
          <Modal
            title={workspace === "medicoes" ? "Nova medição" : "Novo orçamento"}
            subtitle={workspace === "medicoes" ? "Identifique a obra e escolha como obter as quantidades." : "Crie o orçamento ou importe medições já concluídas."}
            onClose={() => !creating && setShowForm(false)}
            maxWidth="max-w-2xl"
          >
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
              <div className="sm:col-span-2">
                <label className="label">{workspace === "medicoes" ? "Como deseja medir?" : "Origem das quantidades"}</label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(workspace === "medicoes"
                    ? ([
                        ["plantas", "Ler plantas", "PDF técnico"],
                        ["manual", "Medir manualmente", "Sem plantas"],
                      ] as const)
                    : ([
                        ["manual", "Criar orçamento", "Introduzir quantidades"],
                        ["importar", "Importar medições", "Excel externo"],
                      ] as const)
                  ).map(([value, label, hint]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setStartMode(value)}
                      className={`rounded-lg border px-3 py-3 text-left ${startMode === value ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600" : "border-slate-200 bg-white hover:border-slate-300"}`}
                    >
                      <strong className="block text-sm text-slate-900">{label}</strong>
                      <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>
                    </button>
                  ))}
                </div>
              </div>
              {workspace === "orcamentos" && (
                <div className="sm:col-span-2 flex flex-col gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 sm:flex-row sm:items-center sm:justify-between">
                  <span>Já mediu esta obra no SIGO?</span>
                  <Link to="/medicoes" onClick={() => setShowForm(false)} className="font-semibold text-blue-800 hover:underline">Abrir Medições e enviar para orçamento →</Link>
                </div>
              )}
              {workspace === "medicoes" && startMode === "plantas" && <div className="sm:col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3">
                  <p className="text-sm font-semibold text-slate-900">Projectos técnicos</p>
                  <p className="mt-0.5 text-xs text-slate-500">Envie o conjunto completo ou as especialidades separadas.</p>
                </div>
                <div className="mb-4 rounded-lg border border-blue-200 bg-white p-3">
                  <label className="label">Projecto completo ou conjunto de especialidades (PDF)</label>
                  <input type="file" name="completeProjectFile" accept="application/pdf" disabled={creating} className="input py-1.5 file:mr-2 file:rounded-md file:border-0 file:bg-blue-50 file:px-2 file:py-1 file:text-xs file:text-blue-800" />
                </div>
                <div className="mb-3 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400"><span className="h-px flex-1 bg-slate-200" /><span>ou carregue separadamente</span><span className="h-px flex-1 bg-slate-200" /></div>
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
              </div>}
              {startMode === "manual" && (
                <div className="sm:col-span-2 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                  {workspace === "medicoes"
                    ? "A medição abrirá sem preços para introduzir áreas, comprimentos e quantidades."
                    : "O orçamento abrirá com a estrutura de trabalhos para introduzir quantidades e aplicar preços."}
                </div>
              )}
              {startMode === "importar" && (
                <div className="sm:col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <label className="label">Medições em Excel *</label>
                  <input type="file" name="measurementsFile" accept=".xlsx,.xls" disabled={creating} className="input py-1.5 file:mr-2 file:rounded-md file:border-0 file:bg-white file:px-2 file:py-1 file:text-xs" />
                  <p className="mt-1.5 text-xs text-slate-500">O sistema associa as quantidades aos códigos do Mapa de Quantidades.</p>
                </div>
              )}
              <details className="sm:col-span-2 rounded-lg border border-slate-200 bg-white">
                <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-800">Materiais definidos nas especificações</summary>
                <div className="space-y-3 border-t border-slate-100 p-4">
                  {materialSpecifications.map((item, index) => (
                    <div key={index} className="grid gap-2 sm:grid-cols-[1fr_7rem_1.2fr_auto]">
                      <input aria-label="Material" value={item.name} onChange={(event) => setMaterialSpecifications((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, name: event.target.value } : row))} className="input" placeholder="Material" />
                      <select aria-label="Unidade" value={item.unit} onChange={(event) => setMaterialSpecifications((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, unit: event.target.value as Unit } : row))} className="input">
                        {UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                      </select>
                      <input aria-label="Especificação" value={item.specification} onChange={(event) => setMaterialSpecifications((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, specification: event.target.value } : row))} className="input" placeholder="Classe, marca ou norma" />
                      <button type="button" onClick={() => setMaterialSpecifications((rows) => rows.filter((_, rowIndex) => rowIndex !== index))} className="icon-btn-danger" aria-label="Remover material"><IconTrash className="h-4 w-4" /></button>
                    </div>
                  ))}
                  <button type="button" onClick={() => setMaterialSpecifications((rows) => [...rows, { name: "", unit: "un", specification: "" }])} className="btn btn-secondary btn-sm">
                    <IconPlus className="h-3.5 w-3.5" /> Adicionar material
                  </button>
                  <p className="text-xs text-slate-500">Materiais existentes são reutilizados. Os novos entram no Catálogo com preço pendente de cotação.</p>
                </div>
              </details>
              <div className="sm:col-span-2 flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
              {creating && analysisProgress && (
                <div className="w-full rounded-xl border border-blue-100 bg-blue-50/70 p-4 mb-1" aria-live="polite">
                  <div className="flex items-start justify-between gap-4"><div><p className="text-sm font-semibold text-blue-950">{analysisProgress.stage}</p><p className="mt-0.5 text-xs text-blue-800/70 truncate">Ficheiro {analysisProgress.currentFile} de {analysisProgress.totalFiles} · {analysisProgress.fileName}{analysisProgress.currentPage && analysisProgress.totalPages ? ` · página ${analysisProgress.currentPage} de ${analysisProgress.totalPages}` : ""}</p></div><strong className="text-2xl tabular-nums text-blue-950">{analysisProgress.percent}%</strong></div>
                  <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-blue-100" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={analysisProgress.percent}><div className="h-full rounded-full bg-blue-600" style={{ width: `${analysisProgress.percent}%` }} /></div>
                  {analysisProgress.totalFiles > 1 && <p className="mt-2 text-[11px] text-blue-800/65">Este ficheiro: {analysisProgress.filePercent}% · progresso total considera os {analysisProgress.totalFiles} ficheiros.</p>}
                </div>
              )}
              <button type="button" onClick={() => setShowForm(false)} disabled={creating} className="btn btn-secondary">Cancelar</button>
              <button type="submit" disabled={creating} className="btn btn-primary min-w-44">
                {creating ? analysisProgress ? `${analysisProgress.percent}% concluído` : createProgress : workspace === "medicoes" ? "Criar medição" : "Criar orçamento"}
              </button>
              </div>
            </form>
          </Modal>
        )}

        {!loading && workspaceProjects.length > 0 && (
          <div className="toolbar flex-col items-stretch gap-4 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <label className="label">Pesquisar</label>
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} className="input w-full" placeholder="Nome, cliente ou zona" />
            </div>
            <div className="kpi-strip shrink-0 sm:max-w-sm">
              <div className="kpi-chip"><span className="block text-[10px] text-slate-400">Total</span><strong className="text-sm tabular-nums">{workspaceProjects.length}</strong></div>
              <div className="kpi-chip"><span className="block text-[10px] text-slate-400">MZN</span><strong className="text-sm tabular-nums">{workspaceProjects.filter((p) => p.currency === "MZN").length}</strong></div>
              <div className="kpi-chip"><span className="block text-[10px] text-slate-400">USD</span><strong className="text-sm tabular-nums">{workspaceProjects.filter((p) => p.currency === "USD").length}</strong></div>
            </div>
          </div>
        )}

        {loading ? (
          <LoadingState />
        ) : workspaceProjects.length === 0 && !showForm ? (
          <div className="card">
            <EmptyState
              title={workspace === "medicoes" ? "Ainda não há medições." : "Ainda não há orçamentos."}
              description={workspace === "medicoes" ? "Crie a primeira obra para obter quantidades." : "Crie um orçamento ou envie uma medição concluída."}
              icon={<IconFolder className="h-6 w-6" />}
              action={
                <button onClick={() => setShowForm(true)} className="btn btn-primary">
                  <IconPlus className="w-4 h-4" />
                  {workspace === "medicoes" ? "Criar medição" : "Criar orçamento"}
                </button>
              }
            />
          </div>
        ) : (
          <div className="card overflow-hidden">
            <div className="hidden sm:grid grid-cols-[minmax(0,1fr)_minmax(10rem,0.7fr)_10rem_6rem] gap-4 px-5 py-2.5 table-head-row border-x-0 border-t-0">
              <span>Projecto</span><span>Dono da obra</span><span>Zona</span><span>Moeda</span>
            </div>
            {filteredProjects.map((p) => (
              <div key={p.id} className="group clickable-row grid grid-cols-[minmax(0,1fr)_auto] items-center border-b border-slate-100 last:border-0">
                <Link to={`/projectos/${p.id}`} className="grid min-w-0 gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,0.7fr)_10rem_6rem] sm:items-center sm:gap-4 sm:px-5">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700"><IconFolder className="h-4.5 w-4.5" /></div>
                    <div className="min-w-0"><p className="truncate font-semibold text-slate-900 group-hover:text-blue-700">{p.name}</p><p className="mt-0.5 truncate text-xs text-slate-500 sm:hidden">{[p.client, zoneName(p.zoneId)].filter(Boolean).join(" · ") || "Sem cliente ou zona"}</p><span className="click-hint mt-1 sm:hidden">Abrir projecto →</span></div>
                  </div>
                  <span className="hidden truncate text-sm text-slate-600 sm:block">{p.client || "—"}</span>
                  <span className="hidden truncate text-sm text-slate-500 sm:block">{zoneName(p.zoneId) || "—"}</span>
                  <span className="badge badge-gray hidden w-fit sm:inline-flex">{p.currency}</span>
                </Link>
                <button onClick={(e) => handleDelete(e, p.id, p.name)} className="icon-btn-danger mr-3 sm:mr-4" title={`Eliminar ${p.name}`} aria-label={`Eliminar ${p.name}`}><IconTrash className="h-3.5 w-3.5" /></button>
              </div>
            ))}
            {workspaceProjects.length > 0 && filteredProjects.length === 0 && <p className="px-5 py-10 text-center text-sm text-slate-500">Nenhum projecto corresponde à pesquisa.</p>}
          </div>
        )}
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title="Eliminar projecto?"
          message={`Eliminar “${pendingDelete.name}”?`}
          details={[
            "Mapas de quantidades e orçamentos",
            "Plantas, autos e documentos associados",
            "Esta acção não pode ser desfeita",
          ]}
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

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { boqApi, type Project } from "../api/boq";
import { siteDiaryApi, type SiteDiaryEntry, type SiteDiaryEntryInput } from "../api/siteDiary";
import { scheduleApi, type ScheduleTask } from "../api/schedule";
import { purchasingApi, type StockSummaryLine } from "../api/purchasing";
import Layout from "../components/Layout";
import { useConfirmDialog } from "../hooks/useConfirmDialog";
import ProjectWorkspaceNav from "../components/ProjectWorkspaceNav";
import Modal from "../components/Modal";
import PageSearch from "../components/PageSearch";
import { SectionHeader } from "../components/WorkspaceUI";
import { IconBack, IconPlus, IconTrash, IconDownload, IconUpload, IconPencil } from "../components/icons";
import SiteDiaryCompleteForm from "../components/SiteDiaryCompleteForm";

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const WEATHER_OPTIONS = ["Sol", "Nublado", "Chuva", "Chuva forte (obra parada)"];

function diaryRecordName(date: string) {
  const label = new Intl.DateTimeFormat("pt-MZ", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(`${date}T12:00:00`));
  return `Relatório diário · ${label}`;
}

export default function ProjectSiteDiaryPage() {
  const { confirm, dialog } = useConfirmDialog();
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();
  const [project, setProject] = useState<Project | null>(null);
  const [entries, setEntries] = useState<SiteDiaryEntry[]>([]);
  const [tasks, setTasks] = useState<ScheduleTask[]>([]);
  const [stock, setStock] = useState<StockSummaryLine[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingPhotoFor, setUploadingPhotoFor] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingEntry, setEditingEntry] = useState<SiteDiaryEntry | null>(null);
  const [formMode, setFormMode] = useState<"quick" | "full">("quick");
  const [query, setQuery] = useState("");

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
  const [taskProgress, setTaskProgress] = useState<Array<{ taskId: string; progressPercent: string; notes: string }>>([]);
  const [consumptions, setConsumptions] = useState<Array<{ materialId: string; quantity: string; notes: string }>>([]);

  async function reload() {
    if (!projectId) return;
    const [proj, list, schedule, stockLines] = await Promise.all([boqApi.getProject(projectId), siteDiaryApi.list(projectId), scheduleApi.get(projectId), purchasingApi.stockSummary(projectId)]);
    setProject(proj);
    setEntries(list);
    setTasks(schedule.tasks);
    setStock(stockLines);
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
        taskProgress: taskProgress.filter((item) => item.taskId).map((item) => ({ taskId: item.taskId, progressPercent: Number(item.progressPercent), notes: item.notes || undefined })),
        consumptions: consumptions.filter((item) => item.materialId && Number(item.quantity) > 0).map((item) => ({ materialId: item.materialId, quantity: Number(item.quantity), notes: item.notes || undefined })),
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
      setTaskProgress([]);
      setConsumptions([]);
      setShowForm(false);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao registar entrada do diário");
    } finally {
      setSaving(false);
    }
  }

  async function handleCompleteCreate(input: SiteDiaryEntryInput) {
    if (!projectId) return;
    setError(null);
    setSaving(true);
    try {
      await siteDiaryApi.create(projectId, input);
      setShowForm(false);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível submeter o relatório diário");
    } finally {
      setSaving(false);
    }
  }

  async function handleCompleteUpdate(input: SiteDiaryEntryInput) {
    if (!editingEntry) return;
    setError(null);
    setSaving(true);
    try {
      await siteDiaryApi.update(editingEntry.id, input);
      setEditingEntry(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível corrigir o relatório diário");
    } finally {
      setSaving(false);
    }
  }

  const editingInput: SiteDiaryEntryInput | undefined = editingEntry ? {
    date: editingEntry.date,
    weather: editingEntry.weather ?? undefined,
    workersPresent: editingEntry.workersPresent ?? undefined,
    equipmentPresent: editingEntry.equipmentPresent ?? undefined,
    workDone: editingEntry.workDone,
    incidents: editingEntry.incidents ?? undefined,
    entryTime: editingEntry.entryTime ?? undefined,
    exitTime: editingEntry.exitTime ?? undefined,
    taskProgress: editingEntry.taskProgress.map((item) => ({ taskId: item.scheduleTaskId, progressPercent: item.progressPercent, notes: item.notes ?? undefined })),
    consumptions: editingEntry.consumptions.map((item) => ({ materialId: item.materialId, quantity: item.quantity, notes: item.notes ?? undefined })),
  } : undefined;
  const editingStock = useMemo(() => {
    if (!editingEntry) return stock;
    return stock.map((line) => ({
      ...line,
      balance: line.balance + editingEntry.consumptions.filter((item) => item.materialId === line.materialId).reduce((sum, item) => sum + item.quantity, 0),
    }));
  }, [stock, editingEntry]);

  async function handleDelete(entry: SiteDiaryEntry) {
    const ok = await confirm({
      title: "Eliminar registo?",
      message: `Eliminar o registo de ${entry.date}?`,
      confirmLabel: "Eliminar",
      danger: true,
    });
    if (!ok) return;
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

  const filteredEntries = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("pt");
    if (!needle) return entries;
    return entries.filter((entry) => [
      entry.date,
      entry.weather,
      entry.workDone,
      entry.materialsReceived,
      entry.materialsConsumed,
      entry.visitors,
      entry.inspectorInstructions,
      entry.incidents,
      entry.decisions,
    ].filter(Boolean).join(" ").toLocaleLowerCase("pt").includes(needle));
  }, [entries, query]);

  if (!project) {
    return <div className="min-h-screen flex items-center justify-center text-gray-400">A carregar...</div>;
  }

  return (
    <>
    <Layout
      title={`Diário de Obra — ${project.name}`}
      actions={
        <Link to={`/projectos/${projectId}${searchParams.get("fase") === "gestao" ? "?fase=gestao" : ""}`} className="btn btn-ghost btn-sm">
          <IconBack className="w-3.5 h-3.5" />
          Projecto
        </Link>
      }
    >
      <div className="mx-auto w-full max-w-7xl space-y-5">
        <ProjectWorkspaceNav projectId={projectId!} />
        {error && <p className="text-sm text-red-600">{error}</p>}

        <section className="card"><SectionHeader title="Relatórios diários" description={`${entries.length} dia(s) registado(s)`} actions={<button type="button" onClick={() => setShowForm(true)} className="btn btn-primary btn-sm"><IconPlus className="h-3.5 w-3.5" /> Novo relatório</button>} /></section>
        <PageSearch value={query} onChange={setQuery} placeholder="Pesquisar por data, trabalho, material ou ocorrência…" resultLabel={`${filteredEntries.length} registo(s)`} />
        {showForm && <SiteDiaryCompleteForm projectName={project.name} tasks={tasks} stock={stock} saving={saving} initialDate={todayStr()} onClose={() => setShowForm(false)} onSubmit={handleCompleteCreate} />}
        {editingEntry && <SiteDiaryCompleteForm projectName={project.name} tasks={tasks} stock={editingStock} saving={saving} initialDate={editingEntry.date} initialData={editingInput} onClose={() => setEditingEntry(null)} onSubmit={handleCompleteUpdate} />}
        {showForm && false && <Modal title="Novo registo do Diário" subtitle={`${date} · ${project!.name}`} onClose={() => !saving && setShowForm(false)} maxWidth={formMode === "full" ? "max-w-6xl" : "max-w-lg"}>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="flex gap-2 text-xs">
              <button type="button" className={`rounded-full px-3 py-1 font-semibold ${formMode === "quick" ? "bg-brand-700 text-white" : "bg-slate-100 text-slate-600"}`} onClick={() => setFormMode("quick")}>Registo rápido</button>
              <button type="button" className={`rounded-full px-3 py-1 font-semibold ${formMode === "full" ? "bg-brand-700 text-white" : "bg-slate-100 text-slate-600"}`} onClick={() => setFormMode("full")}>Registo completo</button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Data</label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
              </div>
              <div>
                <label className="label">Meteorologia</label>
                <select value={weather} onChange={(e) => setWeather(e.target.value)} className="input">
                  {WEATHER_OPTIONS.map((w) => (
                    <option key={w} value={w}>{w}</option>
                  ))}
                </select>
              </div>
              <div className={formMode === "quick" ? "sm:col-span-2" : ""}>
                <label className="label">Trabalhadores presentes</label>
                <input type="number" min="0" value={workersPresent} onChange={(e) => setWorkersPresent(e.target.value)} className="input" placeholder="Opcional" />
              </div>
              {formMode === "full" && (
              <>
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
              </>
              )}
            </div>
            <div>
              <label className="label">Trabalhos executados *</label>
              <textarea required value={workDone} onChange={(e) => setWorkDone(e.target.value)} rows={formMode === "quick" ? 3 : 2} className="input" placeholder="Descreva o que foi feito hoje na obra..." />
            </div>
            {formMode === "full" && (
            <>
            <div className="grid gap-4 rounded-xl border border-blue-200 bg-blue-50/50 p-4 lg:grid-cols-2">
              <div className="space-y-2"><div className="flex items-center justify-between"><div><h3 className="text-sm font-semibold text-slate-900">Progresso do cronograma</h3><p className="text-xs text-slate-500">Actualize as actividades realmente executadas hoje.</p></div><button type="button" className="btn btn-secondary btn-sm" disabled={!tasks.length} onClick={() => setTaskProgress([...taskProgress, { taskId: tasks[0]?.id ?? "", progressPercent: "", notes: "" }])}><IconPlus className="h-3.5 w-3.5" /> Actividade</button></div>{taskProgress.map((item, index) => <div key={index} className="grid grid-cols-[minmax(0,1fr)_90px_auto] gap-2"><select className="input" value={item.taskId} onChange={(event) => setTaskProgress(taskProgress.map((row, rowIndex) => rowIndex === index ? { ...row, taskId: event.target.value } : row))}>{tasks.map((task) => <option key={task.id} value={task.id}>{task.code} · {task.name}</option>)}</select><div className="relative"><input className="input pr-7" type="number" min="0" max="100" step="0.01" placeholder="%" value={item.progressPercent} onChange={(event) => setTaskProgress(taskProgress.map((row, rowIndex) => rowIndex === index ? { ...row, progressPercent: event.target.value } : row))} /><span className="absolute right-2 top-2.5 text-xs text-slate-400">%</span></div><button type="button" className="icon-btn-danger" onClick={() => setTaskProgress(taskProgress.filter((_, rowIndex) => rowIndex !== index))}><IconTrash className="h-3.5 w-3.5" /></button><input className="input col-span-2" placeholder="Trabalho executado, restrição ou evidência" value={item.notes} onChange={(event) => setTaskProgress(taskProgress.map((row, rowIndex) => rowIndex === index ? { ...row, notes: event.target.value } : row))} /></div>)}{!tasks.length && <p className="rounded-lg bg-white px-3 py-2 text-xs text-amber-700">Crie o cronograma da obra para ligar trabalhos diários a actividades.</p>}</div>
              <div className="space-y-2"><div className="flex items-center justify-between"><div><h3 className="text-sm font-semibold text-slate-900">Consumo real do armazém</h3><p className="text-xs text-slate-500">A saída é criada no stock ao guardar o diário.</p></div><button type="button" className="btn btn-secondary btn-sm" disabled={!stock.length} onClick={() => setConsumptions([...consumptions, { materialId: stock.find((item) => item.balance > 0)?.materialId ?? "", quantity: "", notes: "" }])}><IconPlus className="h-3.5 w-3.5" /> Material</button></div>{consumptions.map((item, index) => { const current = stock.find((line) => line.materialId === item.materialId); return <div key={index} className="grid grid-cols-[minmax(0,1fr)_110px_auto] gap-2"><select className="input" value={item.materialId} onChange={(event) => setConsumptions(consumptions.map((row, rowIndex) => rowIndex === index ? { ...row, materialId: event.target.value } : row))}>{stock.filter((line) => line.balance > 0).map((line) => <option key={line.materialId} value={line.materialId}>{line.materialName} · disponível {line.balance.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {line.unit}</option>)}</select><input className="input" type="number" min="0" step="0.01" placeholder={current?.unit ?? "Quant."} value={item.quantity} onChange={(event) => setConsumptions(consumptions.map((row, rowIndex) => rowIndex === index ? { ...row, quantity: event.target.value } : row))} /><button type="button" className="icon-btn-danger" onClick={() => setConsumptions(consumptions.filter((_, rowIndex) => rowIndex !== index))}><IconTrash className="h-3.5 w-3.5" /></button><input className="input col-span-2" placeholder="Frente de trabalho ou finalidade do consumo" value={item.notes} onChange={(event) => setConsumptions(consumptions.map((row, rowIndex) => rowIndex === index ? { ...row, notes: event.target.value } : row))} /></div>})}{!stock.some((item) => item.balance > 0) && <p className="rounded-lg bg-white px-3 py-2 text-xs text-amber-700">Sem material disponível. Receba primeiro uma ordem de compra no Armazém.</p>}</div>
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
            </>
            )}
            <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end"><button type="button" onClick={() => setShowForm(false)} className="btn btn-secondary">Cancelar</button><button type="submit" disabled={saving} className="btn btn-primary">
              <IconPlus className="w-4 h-4" />
              {saving ? "A guardar..." : "Registar dia"}
            </button></div>
          </form>
        </Modal>}

        <section className="space-y-3">
          {filteredEntries.map((entry) => {
            const expanded = expandedId === entry.id;
            return (
              <div key={entry.id} className="card">
                <button
                  onClick={() => setExpandedId(expanded ? null : entry.id)}
                  className="group flex w-full flex-col gap-2 px-4 py-4 text-left hover:bg-blue-50/50 sm:flex-row sm:items-center sm:justify-between sm:px-5"
                >
                  <span className="min-w-0">
                    <strong className="block truncate text-sm text-gray-900">{diaryRecordName(entry.date)}</strong>
                    <span className="mt-0.5 block text-xs font-normal text-gray-500">{entry.weather ?? "Tempo não indicado"}{entry.entryTime && entry.exitTime ? ` · ${entry.entryTime}–${entry.exitTime}` : ""}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                    <span className="badge badge-green">Submetido</span>
                    {entry.workersPresent != null && <span className="badge badge-gray">{entry.workersPresent} trabalhadores</span>}
                    {entry.photoUrls.length > 0 && <span className="badge badge-gray">{entry.photoUrls.length} fotos</span>}
                    <span className="font-bold text-brand-700">{expanded ? "Fechar ↑" : "Ver registo ↓"}</span>
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
                    {entry.taskProgress?.length > 0 && <div className="rounded-lg border border-blue-100 bg-blue-50 p-3"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-blue-700">Progresso comunicado ao cronograma</p>{entry.taskProgress.map((progress) => <div key={progress.id} className="flex justify-between text-sm"><span>{progress.taskCode} · {progress.taskName}</span><strong>{progress.progressPercent.toFixed(2)}%</strong></div>)}</div>}
                    {entry.consumptions?.length > 0 && <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">Saídas de stock</p>{entry.consumptions.map((consumption) => <div key={consumption.id} className="flex justify-between text-sm"><span>{consumption.materialName}</span><strong>{consumption.quantity.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {consumption.unit}</strong></div>)}</div>}
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
                              className="icon-btn-danger absolute -right-2 -top-2 !h-7 !w-7"
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
                          accept="image/*"
                          capture="environment"
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
                      <button type="button" onClick={() => setEditingEntry(entry)} className="btn btn-secondary btn-sm">
                        <IconPencil className="h-3.5 w-3.5" /> Corrigir
                      </button>
                      <button onClick={() => handleDelete(entry)} className="btn btn-sm ml-auto border-red-200 bg-white text-red-600 hover:bg-red-50">
                        Eliminar registo
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {filteredEntries.length === 0 && <div className="card px-5 py-10 text-center text-sm text-slate-500">{query ? "Nenhum registo corresponde à pesquisa." : "Ainda não existem registos no diário."}</div>}
          {entries.length === 0 && <p className="text-sm text-gray-400 text-center py-6">Sem registos ainda — registe o primeiro dia acima.</p>}
        </section>
      </div>
    </Layout>
    {dialog}
    </>
  );
}

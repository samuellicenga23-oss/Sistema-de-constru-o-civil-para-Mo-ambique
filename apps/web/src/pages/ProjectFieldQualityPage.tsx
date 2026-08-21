import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { boqApi, type Project } from "../api/boq";
import { fieldQualityApi, type HstRecord, type InspectionTemplate, type QualityInspection } from "../api/fieldQuality";
import Layout from "../components/Layout";
import ProjectWorkspaceNav from "../components/ProjectWorkspaceNav";
import { SectionHeader } from "../components/WorkspaceUI";
import { IconBack, IconPlus } from "../components/icons";

const HST_LABELS: Record<HstRecord["recordType"], string> = {
  toolbox_talk: "Toolbox talk",
  incidente: "Incidente / acidente",
  observacao_risco: "Observação de risco",
  ppe_check: "PPE check / issue",
};

const STATUS_LABELS: Record<QualityInspection["status"], string> = {
  rascunho: "Rascunho",
  pass: "Aprovado",
  fail: "Reprovado",
  pendente: "Pendente",
};

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function ProjectFieldQualityPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();
  const faseQuery = searchParams.get("fase") === "gestao" ? "?fase=gestao" : "";
  const [project, setProject] = useState<Project | null>(null);
  const [templates, setTemplates] = useState<InspectionTemplate[]>([]);
  const [inspections, setInspections] = useState<QualityInspection[]>([]);
  const [hstRecords, setHstRecords] = useState<HstRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"inspections" | "hst">("inspections");

  const [trade, setTrade] = useState("cofragem");
  const [location, setLocation] = useState("");
  const [inspectionDate, setInspectionDate] = useState(todayStr());
  const [status, setStatus] = useState<QualityInspection["status"]>("pendente");
  const [notes, setNotes] = useState("");

  const [hstType, setHstType] = useState<HstRecord["recordType"]>("observacao_risco");
  const [hstDate, setHstDate] = useState(todayStr());
  const [hstLocation, setHstLocation] = useState("");
  const [hstDescription, setHstDescription] = useState("");

  async function reload() {
    if (!projectId) return;
    const [proj, tpl, insp, hst] = await Promise.all([
      boqApi.getProject(projectId),
      fieldQualityApi.listTemplates(),
      fieldQualityApi.listInspections(projectId),
      fieldQualityApi.listHst(projectId),
    ]);
    setProject(proj);
    setTemplates(tpl.templates);
    setInspections(insp.inspections);
    setHstRecords(hst.records);
  }

  useEffect(() => {
    reload().catch((err) => setError(err.message));
  }, [projectId]);

  async function handleInspection(e: FormEvent) {
    e.preventDefault();
    if (!projectId) return;
    setSaving(true);
    setError(null);
    try {
      const template = templates.find((t) => t.trade === trade);
      const checklistResults = (template?.items ?? []).map((item) => ({ key: item.key, pass: status === "pass" }));
      await fieldQualityApi.createInspection(projectId, {
        trade,
        templateId: template?.id,
        location: location || undefined,
        inspectionDate,
        status,
        checklistResults,
        notes: notes || undefined,
      });
      setLocation("");
      setNotes("");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao guardar");
    } finally {
      setSaving(false);
    }
  }

  async function handleHst(e: FormEvent) {
    e.preventDefault();
    if (!projectId || !hstDescription.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await fieldQualityApi.createHst(projectId, {
        recordType: hstType,
        recordDate: hstDate,
        location: hstLocation || undefined,
        description: hstDescription.trim(),
      });
      setHstDescription("");
      setHstLocation("");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Layout>
      <div className="mx-auto max-w-5xl space-y-4 p-4">
        <div className="flex items-center gap-2">
          <Link to={`/projectos/${projectId}${faseQuery}`} className="btn btn-ghost btn-sm">
            <IconBack /> Voltar
          </Link>
          <h1 className="text-lg font-semibold text-slate-950">{project?.name ?? "Obra"} · Qualidade & HST</h1>
        </div>
        <ProjectWorkspaceNav projectId={projectId!} mode="site" />
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="flex gap-2">
          <button type="button" className={`btn btn-sm ${tab === "inspections" ? "btn-primary" : "btn-secondary"}`} onClick={() => setTab("inspections")}>
            Inspecções
          </button>
          <button type="button" className={`btn btn-sm ${tab === "hst" ? "btn-primary" : "btn-secondary"}`} onClick={() => setTab("hst")}>
            HST
          </button>
        </div>

        {tab === "inspections" ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <form onSubmit={handleInspection} className="card card-pad space-y-3">
              <SectionHeader title="Nova inspecção" subtitle="Templates internos — não substituem norma legal" />
              <label className="block text-sm">
                Especialidade
                <select className="input mt-1 w-full" value={trade} onChange={(e) => setTrade(e.target.value)}>
                  {templates.map((t) => (
                    <option key={t.id} value={t.trade}>{t.name}</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                Local
                <input className="input mt-1 w-full" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Piso / zona" />
              </label>
              <label className="block text-sm">
                Data
                <input type="date" className="input mt-1 w-full" value={inspectionDate} onChange={(e) => setInspectionDate(e.target.value)} required />
              </label>
              <label className="block text-sm">
                Resultado
                <select className="input mt-1 w-full" value={status} onChange={(e) => setStatus(e.target.value as QualityInspection["status"])}>
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                Notas
                <textarea className="input mt-1 w-full" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </label>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                <IconPlus /> Registar inspecção
              </button>
            </form>
            <div className="card card-pad space-y-2">
              <SectionHeader title="Registos" subtitle={`${inspections.length} inspecções`} />
              {inspections.length === 0 ? (
                <p className="text-sm text-slate-500">Sem inspecções registadas.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {inspections.map((row) => (
                    <li key={row.id} className="py-2 text-sm">
                      <div className="flex justify-between gap-2">
                        <span className="font-medium capitalize">{row.trade.replace("_", " ")}</span>
                        <span className={row.status === "pass" ? "text-green-700" : row.status === "fail" ? "text-red-700" : "text-slate-600"}>
                          {STATUS_LABELS[row.status]}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500">{row.inspectionDate}{row.location ? ` · ${row.location}` : ""}</p>
                      {row.diaryEntryId && <p className="text-xs text-blue-600">Ligado ao diário</p>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <form onSubmit={handleHst} className="card card-pad space-y-3">
              <SectionHeader title="Registo HST" subtitle="Inclui observações de risco em campo" />
              <label className="block text-sm">
                Tipo
                <select className="input mt-1 w-full" value={hstType} onChange={(e) => setHstType(e.target.value as HstRecord["recordType"])}>
                  {Object.entries(HST_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                Data
                <input type="date" className="input mt-1 w-full" value={hstDate} onChange={(e) => setHstDate(e.target.value)} required />
              </label>
              <label className="block text-sm">
                Local
                <input className="input mt-1 w-full" value={hstLocation} onChange={(e) => setHstLocation(e.target.value)} />
              </label>
              <label className="block text-sm">
                Descrição
                <textarea className="input mt-1 w-full" rows={4} value={hstDescription} onChange={(e) => setHstDescription(e.target.value)} required />
              </label>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                <IconPlus /> Registar HST
              </button>
            </form>
            <div className="card card-pad space-y-2">
              <SectionHeader title="Registos HST" subtitle={`${hstRecords.length} entradas`} />
              {hstRecords.length === 0 ? (
                <p className="text-sm text-slate-500">Sem registos HST.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {hstRecords.map((row) => (
                    <li key={row.id} className="py-2 text-sm">
                      <div className="font-medium">{HST_LABELS[row.recordType]}</div>
                      <p className="text-xs text-slate-500">{row.recordDate}{row.location ? ` · ${row.location}` : ""}</p>
                      <p className="mt-1 text-slate-700">{row.description}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { boqApi, type Project } from "../api/boq";
import { workforceApi, type Subcontractor, type WorkforceCrew, type WorkforceTimesheet, type WorkforceWorker } from "../api/workforce";
import Layout from "../components/Layout";
import ProjectWorkspaceNav from "../components/ProjectWorkspaceNav";
import { SectionHeader } from "../components/WorkspaceUI";
import { IconBack, IconPlus } from "../components/icons";

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function ProjectWorkforcePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();
  const faseQuery = searchParams.get("fase") === "gestao" ? "?fase=gestao" : "";
  const [project, setProject] = useState<Project | null>(null);
  const [workers, setWorkers] = useState<WorkforceWorker[]>([]);
  const [crews, setCrews] = useState<WorkforceCrew[]>([]);
  const [timesheets, setTimesheets] = useState<WorkforceTimesheet[]>([]);
  const [subcontractors, setSubcontractors] = useState<Subcontractor[]>([]);
  const [inssLabel, setInssLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [workerName, setWorkerName] = useState("");
  const [crewName, setCrewName] = useState("");
  const [subName, setSubName] = useState("");
  const [subNuit, setSubNuit] = useState("");

  async function reload() {
    if (!projectId) return;
    const [proj, w, c, t, s, inss] = await Promise.all([
      boqApi.getProject(projectId),
      workforceApi.listWorkers(projectId),
      workforceApi.listCrews(projectId),
      workforceApi.listTimesheets(projectId),
      workforceApi.listSubcontractors(projectId),
      workforceApi.inssRates(projectId),
    ]);
    setProject(proj);
    setWorkers(w.workers);
    setCrews(c.crews);
    setTimesheets(t.timesheets);
    setSubcontractors(s.subcontractors);
    const er = inss.inssEmployer?.rate != null ? `${(inss.inssEmployer.rate * 100).toFixed(1)}% emp.` : "—";
    const wr = inss.inssWorker?.rate != null ? `${(inss.inssWorker.rate * 100).toFixed(1)}% trab.` : "—";
    setInssLabel(`${er} / ${wr}`);
  }

  useEffect(() => {
    reload().catch((err) => setError(err.message));
  }, [projectId]);

  async function addWorker(e: FormEvent) {
    e.preventDefault();
    if (!projectId || !workerName.trim()) return;
    await workforceApi.createWorker(projectId, { name: workerName.trim(), kind: "employee" });
    setWorkerName("");
    await reload();
  }

  async function addCrew(e: FormEvent) {
    e.preventDefault();
    if (!projectId || !crewName.trim()) return;
    await workforceApi.createCrew(projectId, { name: crewName.trim() });
    setCrewName("");
    await reload();
  }

  async function addTimesheet() {
    if (!projectId) return;
    await workforceApi.createTimesheet(projectId, { workDate: todayStr(), hours: 8 });
    await reload();
  }

  async function addSubcontractor(e: FormEvent) {
    e.preventDefault();
    if (!projectId || !subName.trim()) return;
    await workforceApi.createSubcontractor(projectId, { name: subName.trim(), nuit: subNuit.trim() || undefined });
    setSubName("");
    setSubNuit("");
    await reload();
  }

  return (
    <Layout title="Equipas">
      <div className="mx-auto max-w-5xl space-y-4 p-4">
        <div className="flex items-center gap-2">
          <Link to={`/projectos/${projectId}${faseQuery}`} className="btn btn-ghost btn-sm"><IconBack /> Voltar</Link>
          <h1 className="text-lg font-semibold">{project?.name ?? "Obra"} · Equipas</h1>
        </div>
        <ProjectWorkspaceNav projectId={projectId!} mode="site" />
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <p className="text-sm text-slate-600">INSS (perfil fiscal): {inssLabel}</p>

        <div className="grid gap-4 lg:grid-cols-2">
          <form onSubmit={addWorker} className="card card-pad space-y-2">
            <SectionHeader title="Trabalhadores" description={`${workers.length} registados`} />
            <input className="input w-full" placeholder="Nome" value={workerName} onChange={(e) => setWorkerName(e.target.value)} />
            <button type="submit" className="btn btn-primary btn-sm"><IconPlus /> Adicionar</button>
            <ul className="text-sm">{workers.map((w) => <li key={w.id}>{w.name}{w.trade ? ` · ${w.trade}` : ""}</li>)}</ul>
          </form>

          <form onSubmit={addCrew} className="card card-pad space-y-2">
            <SectionHeader title="Equipas" description={`${crews.length} equipas`} />
            <input className="input w-full" placeholder="Nome da equipa" value={crewName} onChange={(e) => setCrewName(e.target.value)} />
            <button type="submit" className="btn btn-primary btn-sm"><IconPlus /> Criar equipa</button>
            <ul className="text-sm">{crews.map((c) => <li key={c.id}>{c.name}</li>)}</ul>
          </form>

          <div className="card card-pad space-y-2">
            <SectionHeader title="Timesheets" description="Registo diário stub" />
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void addTimesheet()}>Registar 8h hoje</button>
            <ul className="text-sm">{timesheets.map((t) => <li key={t.id}>{t.workDate}: {t.hours}h (+{t.overtimeHours}h extra)</li>)}</ul>
          </div>

          <form onSubmit={addSubcontractor} className="card card-pad space-y-2">
            <SectionHeader title="Subempreiteiros" description={`${subcontractors.length} registos`} />
            <input className="input w-full" placeholder="Nome" value={subName} onChange={(e) => setSubName(e.target.value)} />
            <input className="input w-full" placeholder="NUIT" value={subNuit} onChange={(e) => setSubNuit(e.target.value)} />
            <button type="submit" className="btn btn-primary btn-sm"><IconPlus /> Registar</button>
            <ul className="text-sm">{subcontractors.map((s) => <li key={s.id}>{s.name}{s.nuit ? ` · NUIT ${s.nuit}` : ""}</li>)}</ul>
          </form>
        </div>
      </div>
    </Layout>
  );
}

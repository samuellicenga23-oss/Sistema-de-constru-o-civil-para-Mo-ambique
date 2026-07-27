import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useAuth } from "../auth/AuthContext";
import { companiesApi, type Company } from "../api/companies";
import { dashboardApi, type AdminStats } from "../api/dashboard";
import Layout from "../components/Layout";
import { IconBuilding, IconPlus } from "../components/icons";
import { SUBSCRIPTION_PLANS, getPlanDefinition } from "@sigo/shared";

const STATUS_LABELS: Record<string, string> = { trial: "Trial", activo: "Activo", suspenso: "Suspenso" };
const STATUS_BADGE: Record<string, string> = { trial: "badge-yellow", activo: "badge-green", suspenso: "badge-red" };

function StatCard({ label, value, tint }: { label: string; value: ReactNode; tint: string }) {
  return (
    <div className="card card-pad">
      <p className={`text-2xl font-bold leading-tight ${tint}`}>{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </div>
  );
}

export default function SuperAdminPage() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [name, setName] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function reload() {
    setCompanies(await companiesApi.list());
    setStats(await dashboardApi.adminStats());
  }

  useEffect(() => {
    reload().catch((err) => setError(err.message));
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await companiesApi.create({ name, adminName, adminEmail, adminPassword });
      setName("");
      setAdminName("");
      setAdminEmail("");
      setAdminPassword("");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar empresa");
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(companyId: string, status: "trial" | "activo" | "suspenso") {
    await companiesApi.updateSubscription(companyId, { status });
    await reload();
  }

  async function handlePlanChange(companyId: string, plan: string) {
    await companiesApi.updateSubscription(companyId, { plan });
    await reload();
  }

  if (user?.role !== "super_admin") {
    return <div className="min-h-screen flex items-center justify-center text-gray-400">Sem acesso.</div>;
  }

  return (
    <Layout title="Painel da Plataforma">
      <div className="space-y-5 max-w-4xl">
        {error && <p className="text-sm text-red-600">{error}</p>}

        {stats && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard label="Empresas" value={stats.totalCompanies} tint="text-gray-900" />
              <StatCard label="Activas" value={stats.activeCompanies} tint="text-green-700" />
              <StatCard label="Em trial" value={stats.trialCompanies} tint="text-yellow-700" />
              <StatCard label="Suspensas" value={stats.suspendedCompanies} tint="text-red-700" />
              <StatCard label="Utilizadores totais" value={stats.totalUsers} tint="text-gray-900" />
              <StatCard label="Projectos totais" value={stats.totalProjects} tint="text-gray-900" />
              <StatCard
                label="API"
                value={<span className={stats.services.api ? "text-green-700" : "text-red-700"}>{stats.services.api ? "No ar" : "Em baixo"}</span>}
                tint=""
              />
              <StatCard
                label="Plant-service"
                value={
                  <span className={stats.services.plantService ? "text-green-700" : "text-red-700"}>
                    {stats.services.plantService ? "No ar" : "Em baixo"}
                  </span>
                }
                tint=""
              />
            </div>

            <section className="card card-pad">
              <h2 className="section-title mb-3">Empresas por plano</h2>
              <div className="flex gap-2 flex-wrap">
                {Object.entries(stats.planCounts).map(([plan, n]) => (
                  <span key={plan} className="badge badge-brand">
                    {getPlanDefinition(plan)?.label ?? plan}: {n}
                  </span>
                ))}
              </div>
            </section>
          </>
        )}

        <section className="card card-pad">
          <h2 className="section-title mb-3">Nova empresa</h2>
          <form onSubmit={handleCreate} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 items-end">
            <div>
              <label className="label">Nome da empresa</label>
              <input required value={name} onChange={(e) => setName(e.target.value)} className="input" />
            </div>
            <div>
              <label className="label">Nome do administrador</label>
              <input required value={adminName} onChange={(e) => setAdminName(e.target.value)} className="input" />
            </div>
            <div>
              <label className="label">Email do administrador</label>
              <input required type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} className="input" />
            </div>
            <div>
              <label className="label">Palavra-passe inicial</label>
              <input required minLength={8} type="password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} className="input" />
            </div>
            <div className="lg:col-span-4">
              <button type="submit" disabled={saving} className="btn btn-primary">
                <IconPlus className="w-4 h-4" />
                {saving ? "A criar..." : "Criar empresa"}
              </button>
            </div>
          </form>
        </section>

        <section className="card card-pad">
          <h2 className="section-title mb-3">Planos disponíveis</h2>
          <p className="text-xs text-gray-500 mb-3">
            Sem gateway de pagamento — a factura é feita fora do sistema; active o plano aqui depois de confirmar o
            pagamento. Preços de referência, ajustáveis ao lançar comercialmente.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {SUBSCRIPTION_PLANS.map((p) => (
              <div key={p.key} className="rounded-lg border border-gray-200 p-4">
                <p className="font-semibold text-gray-900">{p.label}</p>
                <p className="text-lg font-bold text-brand-800 mt-1">
                  {p.monthlyPriceMzn === null ? (
                    "Sob proposta"
                  ) : (
                    <>
                      {p.monthlyPriceMzn.toLocaleString("pt-MZ")} MT<span className="text-xs font-normal text-gray-400">/mês</span>
                    </>
                  )}
                </p>
                {p.priceNote && <p className="text-[11px] text-gray-400 mt-0.5">{p.priceNote}</p>}
                <p className="text-xs text-gray-500 mt-1">
                  {p.maxUsers ? `Até ${p.maxUsers} utilizador(es)` : "Utilizadores ilimitados/negociados"} ·{" "}
                  {p.maxProjects ? `até ${p.maxProjects} projectos` : "projectos ilimitados"}
                </p>
                <ul className="text-xs text-gray-600 mt-2 space-y-1 list-disc list-inside">
                  {p.features.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="flex items-center gap-2 px-5 pt-4 pb-2 border-b border-gray-100">
            <IconBuilding className="w-4 h-4 text-brand-700" />
            <h2 className="section-title text-base">Empresas</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="table-head-row">
                  <th className="text-left py-2 px-5 font-medium">Nome</th>
                  <th className="text-left font-medium">Moeda</th>
                  <th className="text-left font-medium">Plano</th>
                  <th className="text-left font-medium">Subscrição</th>
                  <th className="text-left font-medium pr-5">Acções</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((c) => (
                  <tr key={c.id} className="table-row">
                    <td className="py-2 px-5 font-medium text-gray-900">{c.name}</td>
                    <td className="text-gray-600">{c.defaultCurrency}</td>
                    <td>
                      <select
                        value={c.subscription?.plan ?? "free"}
                        onChange={(e) => handlePlanChange(c.id, e.target.value)}
                        className="input py-1 text-xs"
                      >
                        {SUBSCRIPTION_PLANS.map((p) => (
                          <option key={p.key} value={p.key}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <span className={`badge ${STATUS_BADGE[c.subscription?.status ?? "trial"]}`}>
                        {STATUS_LABELS[c.subscription?.status ?? "trial"]}
                      </span>
                    </td>
                    <td className="pr-5 space-x-3">
                      {c.subscription?.status !== "activo" && (
                        <button onClick={() => handleStatusChange(c.id, "activo")} className="text-green-700 text-xs font-medium hover:underline">
                          activar
                        </button>
                      )}
                      {c.subscription?.status !== "suspenso" && (
                        <button onClick={() => handleStatusChange(c.id, "suspenso")} className="text-red-600 text-xs font-medium hover:underline">
                          suspender
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {companies.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-gray-400">
                      Sem empresas ainda.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </Layout>
  );
}

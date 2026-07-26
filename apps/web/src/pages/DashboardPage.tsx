import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { dashboardApi, type DashboardData } from "../api/dashboard";
import Layout from "../components/Layout";
import { IconFolder, IconDoc, IconClipboard, IconMap, IconPlus } from "../components/icons";

function money(value: number, currency: string) {
  return `${value.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function StatCard({ label, value, icon, tint }: { label: string; value: string | number; icon: ReactNode; tint: string }) {
  return (
    <div className="card card-pad flex items-center gap-4">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${tint}`}>{icon}</div>
      <div>
        <p className="text-2xl font-bold text-gray-900 leading-tight">{value}</p>
        <p className="text-xs text-gray-500">{label}</p>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user?.role === "super_admin") return;
    dashboardApi
      .get()
      .then(setData)
      .catch((err) => setError(err.message));
  }, [user?.role]);

  if (user?.role === "super_admin") {
    return (
      <Layout title="Painel">
        <div className="card card-pad max-w-md">
          <p className="text-sm text-gray-600">
            Sessão de plataforma. Gerir empresas e subscrições em{" "}
            <Link to="/admin" className="text-brand-700 font-medium hover:underline">
              Painel da Plataforma
            </Link>
            .
          </p>
        </div>
      </Layout>
    );
  }

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";

  return (
    <Layout
      title="Painel"
      actions={
        <Link to="/projectos" className="btn btn-primary btn-sm">
          <IconPlus className="w-3.5 h-3.5" />
          Novo projecto
        </Link>
      }
    >
      <div className="space-y-6">
        {error && <p className="text-sm text-red-600">{error}</p>}

        <div>
          <p className="text-xl font-semibold text-gray-900">
            {greeting}, {user?.name?.split(" ")[0]} 👋
          </p>
          <p className="text-sm text-gray-500">Aqui está o estado das suas obras e orçamentos.</p>
        </div>

        {data && (
          <>
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
              <StatCard label="Projectos" value={data.totalProjects} tint="bg-brand-100 text-brand-700" icon={<IconFolder className="w-5 h-5" />} />
              <StatCard label="Mapas de Quantidades" value={data.totalDocuments} tint="bg-emerald-100 text-emerald-700" icon={<IconDoc className="w-5 h-5" />} />
              <StatCard label="Autos de Medição" value={data.totalCertificates} tint="bg-amber-100 text-amber-700" icon={<IconClipboard className="w-5 h-5" />} />
              <StatCard label="Plantas carregadas" value={data.totalPlants} tint="bg-sky-100 text-sky-700" icon={<IconMap className="w-5 h-5" />} />
            </div>

            <section className="card">
              <div className="flex items-center justify-between px-5 pt-4 pb-2 border-b border-gray-100">
                <h2 className="section-title text-base">Projectos por valor orçamentado</h2>
                <Link to="/projectos" className="text-sm text-brand-700 font-medium hover:underline">
                  Ver todos →
                </Link>
              </div>
              {data.projects.length === 0 ? (
                <div className="p-10 text-center">
                  <p className="text-gray-500 mb-3">Ainda não há projectos.</p>
                  <Link to="/projectos" className="btn btn-primary">
                    <IconPlus className="w-4 h-4" />
                    Criar o primeiro projecto
                  </Link>
                </div>
              ) : (
                <ul>
                  {data.projects.map((p) => {
                    const max = Math.max(...data.projects.map((x) => x.total), 1);
                    return (
                      <li key={p.id} className="table-row">
                        <Link to={`/projectos/${p.id}`} className="flex items-center gap-4 px-5 py-3">
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-gray-900 truncate">{p.name}</p>
                            <div className="mt-1.5 w-full bg-gray-100 rounded-full h-1.5">
                              <div className="bg-brand-600 h-1.5 rounded-full" style={{ width: `${((p.total / max) * 100).toFixed(1)}%` }} />
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="font-semibold text-gray-900 tabular-nums">{money(p.total, p.currency)}</p>
                            <p className="muted">{p.documentCount} documento(s)</p>
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </Layout>
  );
}

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { measurementApi, type MeasurementCertificateDetail } from "../api/measurement";
import EditablePrice from "../components/EditablePrice";
import Layout from "../components/Layout";

function money(value: number) {
  return value.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function MeasurementCertificatePage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<MeasurementCertificateDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    if (!id) return;
    setData(await measurementApi.detail(id));
  }

  useEffect(() => {
    reload().catch((err) => setError(err.message));
  }, [id]);

  async function handleUpdateLine(lineId: string, value: number) {
    await measurementApi.updateLine(lineId, value);
    await reload();
  }

  async function handleSubmit() {
    if (!id) return;
    await measurementApi.updateStatus(id, "submetido");
    await reload();
  }

  async function handleReopen() {
    if (!id) return;
    await measurementApi.updateStatus(id, "rascunho");
    await reload();
  }

  if (!data) {
    return <div className="min-h-screen flex items-center justify-center text-gray-400">A carregar...</div>;
  }

  const { certificate, lines } = data;
  const locked = certificate.status !== "rascunho";
  const totalPeriodo = lines.reduce((sum, l) => sum + l.periodValue, 0);
  const totalAcumulado = lines.reduce((sum, l) => sum + l.cumulativeValue, 0);

  return (
    <Layout
      title={`Auto de Medição Nº ${certificate.number}`}
      subtitle={`${certificate.periodDate} · ${certificate.status}`}
      actions={
        <Link to={`/projectos/${certificate.projectId}`} className="btn btn-ghost btn-sm">
          Voltar ao projecto
        </Link>
      }
    >
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem] max-w-6xl">
        {error && <p className="text-sm text-red-600 xl:col-span-2">{error}</p>}

        <section className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="table-head-row">
                  <th className="text-left py-2 px-4 font-medium">Item</th>
                  <th className="text-left font-medium">Descrição</th>
                  <th className="text-left font-medium">Un</th>
                  <th className="text-right font-medium">Orçamento</th>
                  <th className="text-right font-medium">Acumulado</th>
                  <th className="text-right font-medium">% Exec.</th>
                  <th className="text-right font-medium">Período</th>
                  <th className="text-right font-medium pr-4">Valor período</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} className="table-row">
                    <td className="py-2 px-4 text-xs text-gray-400">{l.code}</td>
                    <td className="text-gray-800">{l.description}</td>
                    <td className="text-gray-500">{l.unit}</td>
                    <td className="text-right tabular-nums text-gray-600">{l.budgetedQty ?? "-"}</td>
                    <td className="text-right tabular-nums">
                      {locked ? l.cumulativeQty : <EditablePrice value={l.cumulativeQty} onSave={(v) => handleUpdateLine(l.id, v)} />}
                    </td>
                    <td className="text-right tabular-nums text-gray-600">{l.percentExecuted !== null ? `${l.percentExecuted.toFixed(1)}%` : "-"}</td>
                    <td className="text-right tabular-nums text-gray-600">{l.periodQty}</td>
                    <td className="text-right pr-4 tabular-nums font-medium text-gray-900">{money(l.periodValue)}</td>
                  </tr>
                ))}
                {lines.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-gray-400">
                      Sem linhas medidas ainda.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card overflow-hidden xl:sticky xl:top-24 self-start">
          <div className="bg-gradient-to-br from-brand-800 to-brand-950 text-white p-5">
            <h2 className="font-semibold mb-3 text-sm uppercase tracking-wider text-brand-200">Resumo do Período</h2>
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt>Valor do período</dt>
                <dd className="font-semibold tabular-nums">{money(totalPeriodo)}</dd>
              </div>
              <div className="flex justify-between text-brand-200">
                <dt>Valor acumulado</dt>
                <dd className="tabular-nums">{money(totalAcumulado)}</dd>
              </div>
            </dl>
            {!locked ? (
              <button onClick={handleSubmit} className="btn btn-sm w-full mt-4 !bg-white !text-brand-900 hover:!bg-brand-100">
                Submeter auto
              </button>
            ) : (
              <button onClick={handleReopen} className="btn btn-sm w-full mt-4 !bg-brand-700 !text-white hover:!bg-brand-600">
                Reabrir para edição
              </button>
            )}
          </div>
        </section>
      </div>
    </Layout>
  );
}

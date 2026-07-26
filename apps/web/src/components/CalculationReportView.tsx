import type { CalculationReportEntry, CalculationSource } from "../api/boq";

const SOURCE_LABEL: Record<CalculationSource, string> = {
  real: "Dado real (planta)",
  medido: "Indicado no Assistente",
  estimativa: "Estimativa genérica",
};

const SOURCE_CLASS: Record<CalculationSource, string> = {
  real: "bg-green-100 text-green-800",
  medido: "bg-blue-100 text-blue-800",
  estimativa: "bg-amber-100 text-amber-800",
};

function fmt(n: number) {
  return n.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type Props = {
  entries: CalculationReportEntry[];
  generatedAt?: string;
};

// Relatório de cálculos: mostra, item a item, a fórmula usada e se o número por trás veio de um
// dado real extraído de uma planta, de um valor que o utilizador indicou no Assistente para este
// edifício, ou de um rácio genérico de engenharia (usado só quando não havia melhor). Nenhuma
// quantidade do Mapa de Quantidades deve ficar sem se saber de onde veio.
export default function CalculationReportView({ entries, generatedAt }: Props) {
  const counts = entries.reduce(
    (acc, e) => {
      acc[e.source]++;
      return acc;
    },
    { real: 0, medido: 0, estimativa: 0 } as Record<CalculationSource, number>
  );

  return (
    <div className="card card-pad">
      <div className="flex items-center justify-between mb-1">
        <h3 className="section-title">Relatório de Cálculos</h3>
        {generatedAt && <span className="muted">Gerado em {new Date(generatedAt).toLocaleString("pt-MZ")}</span>}
      </div>
      <p className="text-xs text-gray-500 mb-3">
        Fórmula usada em cada item, com os números reais desta estimativa. <span className="font-medium text-green-700">Dado real</span> vem
        de uma planta importada; <span className="font-medium text-blue-700">indicado no Assistente</span> é um valor que o
        utilizador informou para este edifício; <span className="font-medium text-amber-700">estimativa genérica</span> é um
        rácio de mercado usado só por não haver nenhum dado mais específico — ajuste esses itens à mão se souber o valor
        real.
      </p>
      <div className="flex gap-2 mb-3 text-xs">
        <span className={`badge ${SOURCE_CLASS.real}`}>{counts.real} dado(s) real(is)</span>
        <span className={`badge ${SOURCE_CLASS.medido}`}>{counts.medido} indicado(s)</span>
        <span className={`badge ${SOURCE_CLASS.estimativa}`}>{counts.estimativa} estimativa(s)</span>
      </div>
      <div className="overflow-x-auto max-h-96 overflow-y-auto border border-gray-200 rounded-lg">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-gray-50">
            <tr className="table-head-row">
              <th className="text-left py-1.5 pl-3">Item</th>
              <th className="text-right">Quantidade</th>
              <th className="text-left">Origem</th>
              <th className="text-left">Fórmula</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.code} className="table-row align-top">
                <td className="py-1.5 pl-3 pr-2">
                  <span className="text-gray-400">{e.code}</span> {e.label}
                </td>
                <td className="text-right tabular-nums whitespace-nowrap pr-2">
                  {fmt(e.value)} {e.unit}
                </td>
                <td className="pr-2">
                  <span className={`badge ${SOURCE_CLASS[e.source]}`}>{SOURCE_LABEL[e.source]}</span>
                </td>
                <td className="text-gray-600 pr-3">{e.formula}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

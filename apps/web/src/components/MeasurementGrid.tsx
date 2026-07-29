import { useEffect, useState, type FormEvent } from "react";
import { measurementLinesApi, type MeasurementLine } from "../api/measurementLines";

// Grelha de medições dimensionais de um item: Nº × Comp. × Larg. × Alt. = Parcial.
// A quantidade do item passa a ser a soma dos parciais (recalculada no backend).
export default function MeasurementGrid({ lineItemId, onQuantityChange }: { lineItemId: string; onQuantityChange: () => void }) {
  const [lines, setLines] = useState<MeasurementLine[]>([]);
  const [description, setDescription] = useState("");
  const [count, setCount] = useState("1");
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setLines(await measurementLinesApi.list(lineItemId));
  }

  useEffect(() => {
    reload().catch((err) => setError(err.message));
  }, [lineItemId]);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await measurementLinesApi.create(lineItemId, {
        description,
        count: Number(count) || 1,
        length: length ? Number(length) : null,
        width: width ? Number(width) : null,
        height: height ? Number(height) : null,
        sortOrder: lines.length,
      });
      setDescription("");
      setCount("1");
      setLength("");
      setWidth("");
      setHeight("");
      await reload();
      onQuantityChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao adicionar medição");
    }
  }

  async function handleDelete(id: string) {
    await measurementLinesApi.remove(id);
    await reload();
    onQuantityChange();
  }

  const total = lines.reduce((sum, l) => sum + l.partial, 0);

  return (
    <div className="mt-1 rounded-lg bg-brand-50 p-3 text-xs sm:ml-14">
      <p className="font-medium text-brand-900 mb-2">Medições dimensionais</p>
      {error && <p className="text-red-600 mb-1">{error}</p>}

      {lines.length > 0 && (
        <div className="mb-2 overflow-x-auto"><table className="w-full min-w-[520px]">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-200">
              <th className="py-0.5">Descrição</th>
              <th className="w-12">Nº</th>
              <th className="w-16">Comp.</th>
              <th className="w-16">Larg.</th>
              <th className="w-16">Alt.</th>
              <th className="w-20 text-right">Parcial</th>
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b border-gray-100 last:border-0">
                <td className="py-0.5">{l.description || "—"}</td>
                <td>{Number(l.count)}</td>
                <td>{l.length !== null ? Number(l.length) : "—"}</td>
                <td>{l.width !== null ? Number(l.width) : "—"}</td>
                <td>{l.height !== null ? Number(l.height) : "—"}</td>
                <td className="text-right font-medium">{l.partial.toFixed(3)}</td>
                <td className="text-right">
                  <button onClick={() => handleDelete(l.id)} className="icon-btn-danger !h-7 !w-7" title="Eliminar medição">
                    ×
                  </button>
                </td>
              </tr>
            ))}
            <tr className="font-bold text-brand-900">
              <td colSpan={5} className="py-0.5 text-right">
                Quantidade total do item:
              </td>
              <td className="text-right">{total.toFixed(3)}</td>
              <td></td>
            </tr>
          </tbody>
        </table></div>
      )}

      <form onSubmit={handleAdd} className="flex gap-1.5 items-end flex-wrap">
        <input
          placeholder="descrição (ex: Sala, eixo A-B)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="flex-1 min-w-[140px] rounded border border-gray-300 px-1.5 py-0.5"
        />
        <input type="number" step="any" placeholder="Nº" title="Nº de vezes" value={count} onChange={(e) => setCount(e.target.value)} className="w-14 rounded border border-gray-300 px-1.5 py-0.5" />
        <input type="number" step="any" placeholder="Comp." title="Comprimento (m)" value={length} onChange={(e) => setLength(e.target.value)} className="w-16 rounded border border-gray-300 px-1.5 py-0.5" />
        <input type="number" step="any" placeholder="Larg." title="Largura (m)" value={width} onChange={(e) => setWidth(e.target.value)} className="w-16 rounded border border-gray-300 px-1.5 py-0.5" />
        <input type="number" step="any" placeholder="Alt." title="Altura (m)" value={height} onChange={(e) => setHeight(e.target.value)} className="w-16 rounded border border-gray-300 px-1.5 py-0.5" />
        <button type="submit" className="btn btn-primary btn-sm">
          Adicionar medição
        </button>
      </form>
      <p className="text-gray-500 mt-2">Campos vazios contam como 1.</p>
    </div>
  );
}

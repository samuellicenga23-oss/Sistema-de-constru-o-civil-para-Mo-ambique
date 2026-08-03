import { useEffect, useState, type FormEvent } from "react";
import { measurementLinesApi, type MeasurementLine } from "../api/measurementLines";

type MeasureMode = "area" | "length" | "volume" | "direct";

// Grelha de medições dimensionais: Nº × Comp. × Larg. × Alt. = Parcial.
// Pode preencher automaticamente a partir dos compartimentos da planta (por código de item).
export default function MeasurementGrid({
  lineItemId,
  itemCode,
  hasPlantRooms = false,
  onQuantityChange,
}: {
  lineItemId: string;
  itemCode?: string | null;
  hasPlantRooms?: boolean;
  onQuantityChange: () => void;
}) {
  const [lines, setLines] = useState<MeasurementLine[]>([]);
  const [mode, setMode] = useState<MeasureMode>("area");
  const [description, setDescription] = useState("");
  const [count, setCount] = useState("1");
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [directQty, setDirectQty] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fillingFromPlant, setFillingFromPlant] = useState(false);
  const [plantFillNote, setPlantFillNote] = useState<string | null>(null);

  async function reload() {
    setLines(await measurementLinesApi.list(lineItemId));
  }

  useEffect(() => {
    reload().catch((err) => setError(err.message));
  }, [lineItemId]);

  async function handleFillFromPlant() {
    if (!itemCode) return;
    setFillingFromPlant(true);
    setError(null);
    setPlantFillNote(null);
    try {
      const result = await measurementLinesApi.fillFromPlant(lineItemId);
      setPlantFillNote(
        `${result.linesCreated} linha(s) da planta (${result.roomCount} compartimento(s) — ${result.strategy})`,
      );
      await reload();
      onQuantityChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível preencher da planta");
    } finally {
      setFillingFromPlant(false);
    }
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (mode === "direct") {
        const qty = Number(directQty);
        if (!(qty > 0)) {
          setError("Indique uma quantidade válida.");
          return;
        }
        await measurementLinesApi.create(lineItemId, {
          description: description.trim() || "Quantidade directa",
          count: qty,
          length: null,
          width: null,
          height: null,
          sortOrder: lines.length,
        });
      } else {
        await measurementLinesApi.create(lineItemId, {
          description,
          count: Number(count) || 1,
          length: length ? Number(length) : mode === "length" || mode === "area" || mode === "volume" ? 1 : null,
          width: width ? Number(width) : mode === "area" || mode === "volume" ? 1 : null,
          height: height ? Number(height) : mode === "volume" ? 1 : null,
          sortOrder: lines.length,
        });
      }
      setDescription("");
      setCount("1");
      setLength("");
      setWidth("");
      setHeight("");
      setDirectQty("");
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
  const canFillFromPlant = hasPlantRooms && !!itemCode;

  return (
    <div className="mt-1 rounded-lg bg-brand-50 p-3 text-xs sm:ml-14">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-brand-900">Memória de cálculo</p>
        <div className="flex flex-wrap items-center gap-1">
          {canFillFromPlant && (
            <button
              type="button"
              onClick={handleFillFromPlant}
              disabled={fillingFromPlant}
              className="rounded-md bg-emerald-700 px-2 py-1 text-[10px] font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
              title={`Preencher áreas da planta para o item ${itemCode}`}
            >
              {fillingFromPlant ? "A importar..." : "Da planta"}
            </button>
          )}
          {([
            ["area", "Superfície (m²)"],
            ["length", "Comprimento (ml)"],
            ["volume", "Volume (m³)"],
            ["direct", "Quantidade directa"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              className={`rounded-md px-2 py-1 text-[10px] font-semibold ${mode === value ? "bg-brand-700 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {plantFillNote && <p className="mb-1 text-emerald-700">{plantFillNote}</p>}
      {error && <p className="text-red-600 mb-1">{error}</p>}

      {lines.length > 0 && (
        <div className="mb-2 overflow-x-auto">
          <table className="w-full min-w-[520px]">
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
                  <td className="text-right font-medium">{l.partial.toFixed(2)}</td>
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
                <td className="text-right">{total.toFixed(2)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <form onSubmit={handleAdd} className="flex gap-1.5 items-end flex-wrap">
        <input
          placeholder={mode === "direct" ? "origem (ex: Excel, levantamento)" : "local (ex: Sala, eixo A-B)"}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="flex-1 min-w-[140px] rounded border border-gray-300 px-1.5 py-0.5"
        />
        {mode === "direct" ? (
          <input
            type="number"
            step="0.01"
            min="0"
            placeholder="Quant."
            value={directQty}
            onChange={(e) => setDirectQty(e.target.value)}
            className="w-24 rounded border border-gray-300 px-1.5 py-0.5"
          />
        ) : (
          <>
            <input type="number" step="0.01" placeholder="Nº" title="Nº de vezes" value={count} onChange={(e) => setCount(e.target.value)} className="w-14 rounded border border-gray-300 px-1.5 py-0.5" />
            {(mode === "length" || mode === "area" || mode === "volume") && (
              <input type="number" step="0.01" placeholder="Comp." title="Comprimento (m)" value={length} onChange={(e) => setLength(e.target.value)} className="w-16 rounded border border-gray-300 px-1.5 py-0.5" />
            )}
            {(mode === "area" || mode === "volume") && (
              <input type="number" step="0.01" placeholder="Larg." title="Largura (m)" value={width} onChange={(e) => setWidth(e.target.value)} className="w-16 rounded border border-gray-300 px-1.5 py-0.5" />
            )}
            {mode === "volume" && (
              <input type="number" step="0.01" placeholder="Alt." title="Altura (m)" value={height} onChange={(e) => setHeight(e.target.value)} className="w-16 rounded border border-gray-300 px-1.5 py-0.5" />
            )}
          </>
        )}
        <button type="submit" className="btn btn-primary btn-sm">
          Adicionar
        </button>
      </form>
      <p className="text-gray-500 mt-2">
        {canFillFromPlant && "«Da planta» cria uma linha por compartimento (ou total) conforme o código do item. "}
        {mode === "area" && "Superfície: Nº × comprimento × largura. Campos vazios contam como 1."}
        {mode === "length" && "Comprimento linear: Nº × comprimento."}
        {mode === "volume" && "Volume: Nº × comprimento × largura × altura."}
        {mode === "direct" && "Use quando já tem a quantidade final (ex: valor vindo do Excel ou do Assistente)."}
      </p>
    </div>
  );
}

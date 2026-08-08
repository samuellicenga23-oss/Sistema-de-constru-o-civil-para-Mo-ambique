import { useMemo, useState } from "react";
import type { PurchaseOrder } from "../api/purchasing";
import { usePurchaseSheet, type PurchaseRow } from "../hooks/usePurchaseSheet";
import { CellInput, SheetCell } from "./ScheduleSheetCells";
import ModalPortal from "./ModalPortal";
import { IconClose } from "./icons";

type Props = {
  orders: PurchaseOrder[];
  onClose: () => void;
  onChanged: () => Promise<void>;
  onError: (message: string | null) => void;
};

function money(value: number) {
  return value.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Popup de ecrã inteiro com todas as linhas das ordens de compra em RASCUNHO — a única fase em
// que quantidade e preço ainda se podem corrigir antes de a ordem gerar compromisso financeiro.
// Mesmo padrão do "Abrir como folha" do Cronograma: edição célula-a-célula + acções em massa.
export default function PurchaseSheetModal({ orders, onClose, onChanged, onError }: Props) {
  const [query, setQuery] = useState("");
  const [bulkPercent, setBulkPercent] = useState("5");

  const draftOrders = useMemo(() => orders.filter((o) => o.status === "rascunho"), [orders]);
  const rows: PurchaseRow[] = useMemo(
    () => draftOrders.flatMap((order) => order.lines.map((line) => ({ order, lineId: line.id }))),
    [draftOrders],
  );

  const {
    editing,
    savingId,
    selected,
    bulkBusy,
    setEditing,
    toggleSelected,
    toggleSelectAll,
    startEdit,
    commitCell,
    bulkAdjustPrice,
    bulkApproveOrders,
  } = usePurchaseSheet(rows, onChanged, onError);

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("pt");
    if (!needle) return rows;
    return rows.filter((r) => {
      const line = r.order.lines.find((l) => l.id === r.lineId);
      return `${r.order.supplierName} ${line?.materialName ?? ""}`.toLocaleLowerCase("pt").includes(needle);
    });
  }, [rows, query]);

  const allSelected = filteredRows.length > 0 && filteredRows.every((r) => selected.has(r.lineId));

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex flex-col bg-white">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900">Compras — folha de rascunhos</h2>
            <p className="text-xs text-slate-500">{rows.length} linha(s) em {draftOrders.length} ordem(ns) por aprovar · duplo clique para editar</p>
          </div>
          <div className="flex flex-1 items-center justify-end gap-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Pesquisar material ou fornecedor…"
              className="input input-sm w-56 max-w-full"
            />
            <button type="button" onClick={onClose} className="icon-btn-ghost" aria-label="Fechar">
              <IconClose className="h-4 w-4" />
            </button>
          </div>
        </div>

        {selected.size > 0 && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-blue-200 bg-blue-50 px-4 py-2">
            <span className="text-[11px] font-semibold text-blue-900">{selected.size} linha(s) seleccionada(s)</span>
            <span className="mx-1 hidden h-4 w-px bg-blue-200 sm:block" />
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={bulkPercent}
                onChange={(e) => setBulkPercent(e.target.value)}
                className="h-7 w-16 rounded border border-slate-200 bg-white px-1.5 text-[11px]"
                title="Percentagem (negativo desconta)"
              />
              <button type="button" disabled={bulkBusy} onClick={() => void bulkAdjustPrice(Number(bulkPercent))} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:border-slate-300 disabled:opacity-50">
                % no preço
              </button>
            </div>
            <button type="button" disabled={bulkBusy} onClick={() => void bulkApproveOrders()} className="rounded-md border border-emerald-200 bg-white px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:border-emerald-300 disabled:opacity-50">
              Aprovar ordens destas linhas
            </button>
            <p className="w-full text-[10px] text-blue-800/80 sm:ml-auto sm:w-auto">
              Aprovar afecta a ordem inteira, não só as linhas seleccionadas.
            </p>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[760px] table-fixed border-collapse text-[13px]">
            <colgroup>
              <col className="w-9" />
              <col className="w-40" />
              <col />
              <col className="w-24" />
              <col className="w-16" />
              <col className="w-28" />
              <col className="w-28" />
            </colgroup>
            <thead className="sticky top-0 z-[1] bg-slate-100">
              <tr className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <th className="border-b border-slate-200 px-2 py-2 text-center">
                  <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="h-3.5 w-3.5 rounded border-slate-300" aria-label="Seleccionar todas" />
                </th>
                <th className="border-b border-slate-200 px-2 py-2 text-left">Fornecedor</th>
                <th className="border-b border-slate-200 px-2 py-2 text-left">Material</th>
                <th className="border-b border-slate-200 px-2 py-2 text-right">Quantidade</th>
                <th className="border-b border-slate-200 px-2 py-2 text-left">Un.</th>
                <th className="border-b border-slate-200 px-2 py-2 text-right">Preço unit.</th>
                <th className="border-b border-slate-200 px-2 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => {
                const line = row.order.lines.find((l) => l.id === row.lineId);
                if (!line) return null;
                const cell = editing?.lineId === row.lineId ? editing.cell : null;
                const total = Number(line.quantity) * Number(line.unitCost);
                return (
                  <tr key={row.lineId} className={`${savingId === row.lineId ? "opacity-50" : ""} bg-white hover:bg-slate-50/80`}>
                    <SheetCell align="right" className="w-9" rowH={40}>
                      <input type="checkbox" checked={selected.has(row.lineId)} onChange={() => toggleSelected(row.lineId)} className="h-3.5 w-3.5 rounded border-slate-300" />
                    </SheetCell>
                    <SheetCell rowH={40}>
                      <span className="truncate text-slate-700">{row.order.supplierName}</span>
                    </SheetCell>
                    <SheetCell rowH={40}>
                      <span className="text-slate-900">{line.materialName}</span>
                      {Number(line.unitCost) === 0 && <span className="ml-1.5 rounded bg-orange-100 px-1 text-[10px] font-semibold text-orange-700">sem preço</span>}
                    </SheetCell>
                    <SheetCell align="right" onEdit={() => startEdit(row.lineId, "quantity")} rowH={40}>
                      {cell === "quantity" ? (
                        <CellInput type="number" step="0.01" value={line.quantity} onCommit={(v) => void commitCell(row, "quantity", v)} onCancel={() => setEditing(null)} />
                      ) : (
                        <span className="tabular-nums text-slate-600">{money(Number(line.quantity))}</span>
                      )}
                    </SheetCell>
                    <SheetCell rowH={40}><span className="text-slate-500">{line.unit}</span></SheetCell>
                    <SheetCell align="right" onEdit={() => startEdit(row.lineId, "unitCost")} rowH={40}>
                      {cell === "unitCost" ? (
                        <CellInput type="number" step="0.01" value={line.unitCost} onCommit={(v) => void commitCell(row, "unitCost", v)} onCancel={() => setEditing(null)} />
                      ) : (
                        <span className={`tabular-nums ${Number(line.unitCost) === 0 ? "font-semibold text-orange-700" : "text-slate-600"}`}>{money(Number(line.unitCost))} {line.currency}</span>
                      )}
                    </SheetCell>
                    <SheetCell align="right" rowH={40}>
                      <span className="font-semibold tabular-nums text-slate-800">{money(total)} {line.currency}</span>
                    </SheetCell>
                  </tr>
                );
              })}
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">
                    {query ? "Nenhuma linha corresponde à pesquisa." : "Sem ordens em rascunho para editar."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2 text-[11px] text-slate-500">
          <span className="font-medium text-slate-600">{filteredRows.length} de {rows.length} linha(s)</span>
        </div>
      </div>
    </ModalPortal>
  );
}

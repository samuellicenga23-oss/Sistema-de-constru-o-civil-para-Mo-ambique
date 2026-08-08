import { useState } from "react";
import type { PurchaseOrder } from "../api/purchasing";
import { purchasingApi } from "../api/purchasing";

export type PurchaseCell = "quantity" | "unitCost";
export type PurchaseRow = { order: PurchaseOrder; lineId: string };

// Edição em folha das linhas de ordens de compra em rascunho — mesma lógica de célula-a-célula e
// em massa do cronograma (useScheduleSheet), adaptada a quantidade/preço por linha.
export function usePurchaseSheet(rows: PurchaseRow[], onChanged: () => Promise<void>, onError: (message: string | null) => void) {
  const [editing, setEditing] = useState<{ lineId: string; cell: PurchaseCell } | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  function toggleSelected(lineId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.lineId))));
  }

  function startEdit(lineId: string, cell: PurchaseCell) {
    setEditing({ lineId, cell });
  }

  async function commitCell(row: PurchaseRow, cell: PurchaseCell, raw: string) {
    const value = Number(raw.trim().replace(",", "."));
    const line = row.order.lines.find((l) => l.id === row.lineId);
    if (!line) return setEditing(null);
    if (!Number.isFinite(value) || value < 0 || (cell === "quantity" && value <= 0)) {
      onError(cell === "quantity" ? "Quantidade deve ser maior que zero" : "Preço inválido");
      return setEditing(null);
    }
    const current = cell === "quantity" ? Number(line.quantity) : Number(line.unitCost);
    if (value === current) return setEditing(null);
    setSavingId(row.lineId);
    onError(null);
    try {
      await purchasingApi.updateOrderLine(row.lineId, cell === "quantity" ? { quantity: value } : { unitCost: value });
      setEditing(null);
      await onChanged();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Erro ao actualizar a linha");
    } finally {
      setSavingId(null);
    }
  }

  async function bulkAdjustPrice(percent: number) {
    if (!Number.isFinite(percent) || percent === 0) return;
    const targets = rows.filter((r) => selected.has(r.lineId));
    if (!targets.length) return;
    setBulkBusy(true);
    onError(null);
    try {
      const results = await Promise.allSettled(
        targets.map((r) => {
          const line = r.order.lines.find((l) => l.id === r.lineId);
          if (!line) return Promise.resolve(null);
          const nextCost = Math.max(0, Number(line.unitCost) * (1 + percent / 100));
          return purchasingApi.updateOrderLine(r.lineId, { unitCost: Number(nextCost.toFixed(4)) });
        }),
      );
      const failed = results.filter((r) => r.status === "rejected");
      if (failed.length) onError(`${failed.length} de ${targets.length} linha(s) não foram actualizadas.`);
      await onChanged();
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkApproveOrders() {
    const targets = rows.filter((r) => selected.has(r.lineId));
    if (!targets.length) return;
    const orderIds = [...new Set(targets.map((r) => r.order.id))];
    setBulkBusy(true);
    onError(null);
    try {
      const results = await Promise.allSettled(orderIds.map((id) => purchasingApi.updateOrderStatus(id, "aprovado")));
      const failed = results.filter((r) => r.status === "rejected");
      if (failed.length) onError(`${failed.length} de ${orderIds.length} ordem(ns) não foram aprovadas.`);
      setSelected(new Set());
      await onChanged();
    } finally {
      setBulkBusy(false);
    }
  }

  return {
    editing,
    savingId,
    selected,
    bulkBusy,
    setEditing,
    setSelected,
    toggleSelected,
    toggleSelectAll,
    startEdit,
    commitCell,
    bulkAdjustPrice,
    bulkApproveOrders,
  };
}

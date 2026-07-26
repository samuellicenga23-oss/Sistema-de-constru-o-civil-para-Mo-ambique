import { useEffect, useState, type FormEvent } from "react";
import { catalogApi, type Material, type PriceZone, type MaterialZonePrice } from "../api/catalog";
import { suppliersApi, type Supplier } from "../api/suppliers";
import Modal from "./Modal";
import EditablePrice from "./EditablePrice";
import { IconTrash, IconPlus } from "./icons";

type MaterialSupplierRow = { id: string; supplierId: string; supplierName: string; zoneId: string | null; zoneName: string | null; unitCost: string; currency: string };

export default function MaterialPricingModal({ material, onClose, onChanged }: { material: Material; onClose: () => void; onChanged: () => void }) {
  const [zones, setZones] = useState<PriceZone[]>([]);
  const [zonePrices, setZonePrices] = useState<MaterialZonePrice[]>([]);
  const [supplierRows, setSupplierRows] = useState<MaterialSupplierRow[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [newSupplierId, setNewSupplierId] = useState("");
  const [newZoneId, setNewZoneId] = useState("");
  const [newUnitCost, setNewUnitCost] = useState("");

  async function reload() {
    const [zns, zps, sups, matSuppliers] = await Promise.all([
      catalogApi.listPriceZones(),
      catalogApi.listMaterialZonePrices(material.id),
      suppliersApi.list(),
      catalogApi.listMaterialSuppliers(material.id),
    ]);
    setZones(zns);
    setZonePrices(zps);
    setSuppliers(sups);
    setSupplierRows(matSuppliers as MaterialSupplierRow[]);
    if (!newSupplierId && sups.length) setNewSupplierId(sups[0].id);
  }

  useEffect(() => {
    reload().catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [material.id]);

  async function handleSaveZonePrice(zoneId: string, unitCost: number) {
    await catalogApi.setMaterialZonePrice(material.id, zoneId, unitCost);
    await reload();
    onChanged();
  }

  async function handleRemoveZonePrice(zoneId: string) {
    await catalogApi.deleteMaterialZonePrice(material.id, zoneId);
    await reload();
    onChanged();
  }

  async function handleAddSupplierPrice(e: FormEvent) {
    e.preventDefault();
    const cost = Number(newUnitCost);
    if (!newSupplierId || !(cost >= 0)) return;
    setError(null);
    try {
      await suppliersApi.setMaterialPrice(newSupplierId, { materialId: material.id, zoneId: newZoneId || null, unitCost: cost });
      setNewUnitCost("");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao guardar preço do fornecedor");
    }
  }

  async function handleRemoveSupplierPrice(row: MaterialSupplierRow) {
    setError(null);
    try {
      await suppliersApi.deleteMaterialPrice(row.supplierId, row.id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao remover preço do fornecedor");
    }
  }

  return (
    <Modal title={`Preços — ${material.name}`} subtitle={`Preço base: ${Number(material.baseUnitCost).toLocaleString("pt-MZ", { minimumFractionDigits: 2 })} ${material.currency} por ${material.unit}`} onClose={onClose} maxWidth="max-w-2xl">
      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      <section className="mb-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Preços por zona</h3>
        <p className="text-xs text-gray-500 mb-3">Clique num preço para editar. Sem preço próprio, a zona usa o preço base acima.</p>
        {zones.length === 0 ? (
          <p className="text-xs text-gray-400">Ainda não há zonas de preço definidas — crie-as no separador "Zonas de Preço".</p>
        ) : (
          <div className="rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="table-head-row">
                  <th className="text-left py-2 px-3 font-medium">Zona</th>
                  <th className="text-right font-medium">Preço</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {zones.map((z) => {
                  const override = zonePrices.find((p) => p.zoneId === z.id);
                  return (
                    <tr key={z.id} className="table-row">
                      <td className="py-1.5 px-3">{z.name}</td>
                      <td className="text-right">
                        <EditablePrice value={override?.unitCost ?? material.baseUnitCost} suffix={material.currency} onSave={(v) => handleSaveZonePrice(z.id, v)} />
                        {!override && <span className="text-[11px] text-gray-400 ml-1">(base)</span>}
                      </td>
                      <td className="text-right pr-2">
                        {override && (
                          <button onClick={() => handleRemoveZonePrice(z.id)} className="icon-btn-danger" title="Remover preço desta zona">
                            <IconTrash className="w-3 h-3" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Fornecedores deste material</h3>
        {suppliers.length === 0 ? (
          <p className="text-xs text-gray-400 mb-3">Sem fornecedores cadastrados — crie um em "Fornecedores".</p>
        ) : (
          <form onSubmit={handleAddSupplierPrice} className="flex gap-2 items-end flex-wrap mb-3">
            <div>
              <label className="label">Fornecedor</label>
              <select value={newSupplierId} onChange={(e) => setNewSupplierId(e.target.value)} className="input input-sm">
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Zona (opcional)</label>
              <select value={newZoneId} onChange={(e) => setNewZoneId(e.target.value)} className="input input-sm">
                <option value="">Preço geral</option>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Preço</label>
              <input type="number" step="0.01" min="0" value={newUnitCost} onChange={(e) => setNewUnitCost(e.target.value)} className="input input-sm w-28" />
            </div>
            <button type="submit" className="btn btn-primary btn-sm">
              <IconPlus className="w-3.5 h-3.5" />
              Guardar
            </button>
          </form>
        )}

        <div className="rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="table-head-row">
                <th className="text-left py-2 px-3 font-medium">Fornecedor</th>
                <th className="text-left font-medium">Zona</th>
                <th className="text-right font-medium">Preço</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {supplierRows.map((r) => (
                <tr key={r.id} className="table-row">
                  <td className="py-1.5 px-3">{r.supplierName}</td>
                  <td className="text-gray-500">{r.zoneName ?? "Geral"}</td>
                  <td className="text-right tabular-nums">
                    {Number(r.unitCost).toLocaleString("pt-MZ", { minimumFractionDigits: 2 })} {r.currency}
                  </td>
                  <td className="text-right pr-2">
                    <button onClick={() => handleRemoveSupplierPrice(r)} className="icon-btn-danger" title="Remover">
                      <IconTrash className="w-3 h-3" />
                    </button>
                  </td>
                </tr>
              ))}
              {supplierRows.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-3 text-center text-gray-400">
                    Nenhum fornecedor cadastrado para este material ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </Modal>
  );
}

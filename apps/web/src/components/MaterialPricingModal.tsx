import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { catalogApi, type Material, type PriceZone } from "../api/catalog";
import { suppliersApi, type Supplier } from "../api/suppliers";
import Modal from "./Modal";
import { IconTrash, IconPlus } from "./icons";

type MaterialSupplierRow = {
  id: string;
  supplierId: string;
  supplierName: string;
  supplierContact: string | null;
  zoneId: string | null;
  zoneName: string | null;
  unitCost: string;
  currency: string;
  isReference?: boolean;
  isMarketplace?: boolean;
};

function money(value: string | number) {
  return Number(value).toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function MaterialPricingModal({ material, onClose, onChanged }: { material: Material; onClose: () => void; onChanged: () => void }) {
  const [zones, setZones] = useState<PriceZone[]>([]);
  const [supplierRows, setSupplierRows] = useState<MaterialSupplierRow[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [newSupplierId, setNewSupplierId] = useState("");
  const [newZoneId, setNewZoneId] = useState("");
  const [newUnitCost, setNewUnitCost] = useState("");

  const editableSuppliers = suppliers;

  async function reload() {
    const [zns, sups, matSuppliers] = await Promise.all([
      catalogApi.listPriceZones(),
      suppliersApi.list(),
      catalogApi.listMaterialSuppliers(material.id),
    ]);
    setZones(zns);
    setSuppliers(sups);
    setSupplierRows(matSuppliers as MaterialSupplierRow[]);
    if (!newSupplierId && sups.length) setNewSupplierId(sups[0].id);
  }

  useEffect(() => {
    reload().catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [material.id]);

  async function handleAddSupplierPrice(e: FormEvent) {
    e.preventDefault();
    const cost = Number(newUnitCost);
    if (!newSupplierId || !(cost >= 0)) return;
    setError(null);
    try {
      await suppliersApi.setMaterialPrice(newSupplierId, { materialId: material.id, zoneId: newZoneId || null, unitCost: cost });
      setNewUnitCost("");
      await reload();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao guardar preço do fornecedor");
    }
  }

  async function handleRemoveSupplierPrice(row: MaterialSupplierRow) {
    if (row.isMarketplace) return;
    setError(null);
    try {
      await suppliersApi.deleteMaterialPrice(row.supplierId, row.id);
      await reload();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao remover preço do fornecedor");
    }
  }

  return (
    <Modal
      title={`Preços e fornecedores — ${material.name}`}
      subtitle={`Preço base do catálogo (orçamentos): ${money(material.baseUnitCost)} ${material.currency} / ${material.unit}. Os preços abaixo são cotações de fornecedores — não alteram o orçamento.`}
      onClose={onClose}
      maxWidth="max-w-2xl"
    >
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-700">Fornecedores neste material</h3>
            <p className="mt-1 text-xs text-gray-500">
              Inclui SIGO Preços e, no plano Profissional+, fornecedores do marketplace. Ordenado do mais barato ao mais caro.
            </p>
          </div>
          <Link to="/gestao/fornecedores" className="text-xs font-medium text-brand-700 hover:underline">
            Ver todos os fornecedores →
          </Link>
        </div>

        {editableSuppliers.length > 0 && (
          <form onSubmit={handleAddSupplierPrice} className="mb-3 flex flex-wrap items-end gap-2">
            <div>
              <label className="label">Fornecedor</label>
              <select value={newSupplierId} onChange={(e) => setNewSupplierId(e.target.value)} className="input input-sm">
                {editableSuppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Zona</label>
              <select value={newZoneId} onChange={(e) => setNewZoneId(e.target.value)} className="input input-sm">
                <option value="">Geral / só a zona do fornecedor</option>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Preço</label>
              <input type="number" step="0.01" min="0" value={newUnitCost} onChange={(e) => setNewUnitCost(e.target.value)} className="input input-sm w-28" required />
            </div>
            <button type="submit" className="btn btn-primary btn-sm">
              <IconPlus className="h-3.5 w-3.5" />
              Guardar
            </button>
          </form>
        )}

        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="table-head-row">
                <th className="px-3 py-2 text-left font-medium">Fornecedor</th>
                <th className="text-left font-medium">Zona</th>
                <th className="text-left font-medium">Contacto</th>
                <th className="text-right font-medium">Preço</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {supplierRows.map((r) => (
                <tr key={r.id} className="table-row">
                  <td className="px-3 py-1.5">
                    <span className="font-medium text-slate-900">{r.supplierName}</span>
                    {r.isReference && <span className="badge badge-brand ml-2">SIGO</span>}
                    {r.isMarketplace && !r.isReference && <span className="badge badge-gray ml-2">Marketplace</span>}
                  </td>
                  <td className="text-gray-500">{r.zoneName ?? "Geral"}</td>
                  <td className="text-gray-500">
                    {r.supplierContact ? (
                      <a href={`tel:${r.supplierContact}`} className="font-medium text-brand-700 hover:underline">
                        {r.supplierContact}
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="text-right tabular-nums">
                    {money(r.unitCost)} {r.currency}
                  </td>
                  <td className="pr-2 text-right">
                    {!r.isMarketplace && (
                      <button type="button" onClick={() => handleRemoveSupplierPrice(r)} className="icon-btn-danger" title="Remover">
                        <IconTrash className="h-3 w-3" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {supplierRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-gray-400">
                    Ainda não há cotações de fornecedores para este material.
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

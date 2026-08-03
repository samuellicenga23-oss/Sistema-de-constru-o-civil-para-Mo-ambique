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
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null);
  const [zoneDraft, setZoneDraft] = useState({ unitCost: "", sourceName: "", sourceReference: "", effectiveDate: "", includesVat: false, transportIncluded: true });

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
    const existing = zonePrices.find((price) => price.zoneId === zoneId);
    await catalogApi.setMaterialZonePrice(material.id, zoneId, {
      unitCost,
      sourceName: existing?.sourceName ?? null,
      sourceReference: existing?.sourceReference ?? null,
      effectiveDate: existing?.effectiveDate ?? null,
      includesVat: existing?.includesVat ?? false,
      transportIncluded: existing?.transportIncluded ?? true,
    });
    await reload();
    onChanged();
  }

  async function handleRemoveZonePrice(zoneId: string) {
    await catalogApi.deleteMaterialZonePrice(material.id, zoneId);
    await reload();
    onChanged();
  }

  function openZoneEditor(zoneId: string) {
    const existing = zonePrices.find((price) => price.zoneId === zoneId);
    setEditingZoneId(zoneId);
    setZoneDraft({
      unitCost: existing?.unitCost ?? material.baseUnitCost,
      sourceName: existing?.sourceName ?? "",
      sourceReference: existing?.sourceReference ?? "",
      effectiveDate: existing?.effectiveDate ?? "",
      includesVat: existing?.includesVat ?? material.includesVat,
      transportIncluded: existing?.transportIncluded ?? true,
    });
  }

  async function saveZoneDocumentation(e: FormEvent) {
    e.preventDefault();
    if (!editingZoneId) return;
    await catalogApi.setMaterialZonePrice(material.id, editingZoneId, {
      unitCost: Number(zoneDraft.unitCost),
      sourceName: zoneDraft.sourceName.trim() || null,
      sourceReference: zoneDraft.sourceReference.trim() || null,
      effectiveDate: zoneDraft.effectiveDate || null,
      includesVat: zoneDraft.includesVat,
      transportIncluded: zoneDraft.transportIncluded,
    });
    setEditingZoneId(null);
    await reload(); onChanged();
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
    <Modal title={`Preços — ${material.name}`} subtitle={`Preço base: ${Number(material.baseUnitCost).toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${material.currency} por ${material.unit}`} onClose={onClose} maxWidth="max-w-2xl">
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
                  <th className="w-36"></th>
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
                      <td className="text-right pr-2 whitespace-nowrap">
                        <button type="button" onClick={() => openZoneEditor(z.id)} className="btn btn-ghost btn-sm">documentar</button>
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
        {editingZoneId && <form onSubmit={saveZoneDocumentation} className="mt-3 rounded-xl border border-blue-100 bg-blue-50/60 p-4 space-y-3"><div className="flex items-center justify-between"><p className="text-sm font-semibold text-blue-950">Preço específico · {zones.find((z) => z.id === editingZoneId)?.name}</p><button type="button" onClick={() => setEditingZoneId(null)} className="text-xs text-slate-500">fechar</button></div><div className="grid grid-cols-2 gap-3"><div><label className="label">Preço por {material.unit}</label><input required min="0" type="number" step="0.01" className="input" value={zoneDraft.unitCost} onChange={(e) => setZoneDraft({ ...zoneDraft, unitCost: e.target.value })} /></div><div><label className="label">Data efectiva</label><input type="date" className="input" value={zoneDraft.effectiveDate} onChange={(e) => setZoneDraft({ ...zoneDraft, effectiveDate: e.target.value })} /></div><div className="col-span-2"><label className="label">Fonte</label><input className="input" value={zoneDraft.sourceName} onChange={(e) => setZoneDraft({ ...zoneDraft, sourceName: e.target.value })} placeholder="Fornecedor, boletim de preços ou estudo de mercado" /></div><div className="col-span-2"><label className="label">Referência</label><input className="input" value={zoneDraft.sourceReference} onChange={(e) => setZoneDraft({ ...zoneDraft, sourceReference: e.target.value })} placeholder="N.º da cotação, documento ou URL" /></div></div><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex gap-4 text-xs"><label className="flex items-center gap-2"><input type="checkbox" checked={zoneDraft.includesVat} onChange={(e) => setZoneDraft({ ...zoneDraft, includesVat: e.target.checked })} /> Inclui IVA</label><label className="flex items-center gap-2"><input type="checkbox" checked={zoneDraft.transportIncluded} onChange={(e) => setZoneDraft({ ...zoneDraft, transportIncluded: e.target.checked })} /> Inclui transporte</label></div><button className="btn btn-primary btn-sm">Guardar preço documentado</button></div></form>}
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
                    {Number(r.unitCost).toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {r.currency}
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

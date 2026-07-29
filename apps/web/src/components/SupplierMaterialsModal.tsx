import { useEffect, useState, type FormEvent } from "react";
import {
  suppliersApi,
  type Supplier,
  type SupplierMaterialPrice,
  type SupplierLabourPrice,
  type SupplierEquipmentPrice,
} from "../api/suppliers";
import { catalogApi, type Material, type LabourCategory, type Equipment, type PriceZone } from "../api/catalog";
import Modal from "./Modal";
import { IconPlus, IconTrash } from "./icons";

type Tab = "materiais" | "mao-de-obra" | "maquinas";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "materiais", label: "Materiais" },
  { id: "mao-de-obra", label: "Mão-de-obra" },
  { id: "maquinas", label: "Máquinas" },
];

export default function SupplierMaterialsModal({ supplier, onClose }: { supplier: Supplier; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("materiais");
  const [materials, setMaterials] = useState<Material[]>([]);
  const [labourCategories, setLabourCategories] = useState<LabourCategory[]>([]);
  const [equipmentList, setEquipmentList] = useState<Equipment[]>([]);
  const [zones, setZones] = useState<PriceZone[]>([]);
  const [materialPrices, setMaterialPrices] = useState<SupplierMaterialPrice[]>([]);
  const [labourPrices, setLabourPrices] = useState<SupplierLabourPrice[]>([]);
  const [equipmentPrices, setEquipmentPrices] = useState<SupplierEquipmentPrice[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [materialId, setMaterialId] = useState("");
  const [labourCategoryId, setLabourCategoryId] = useState("");
  const [equipmentId, setEquipmentId] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [cost, setCost] = useState("");

  async function reload() {
    const [mats, labs, eqs, zns, matPrices, labPrices, eqPrices] = await Promise.all([
      catalogApi.listMaterials(),
      catalogApi.listLabourCategories(),
      catalogApi.listEquipment(),
      catalogApi.listPriceZones(),
      suppliersApi.listMaterialPrices(supplier.id),
      suppliersApi.listLabourPrices(supplier.id),
      suppliersApi.listEquipmentPrices(supplier.id),
    ]);
    setMaterials(mats);
    setLabourCategories(labs);
    setEquipmentList(eqs);
    setZones(zns);
    setMaterialPrices(matPrices);
    setLabourPrices(labPrices);
    setEquipmentPrices(eqPrices);
    if (!materialId && mats.length) setMaterialId(mats[0].id);
    if (!labourCategoryId && labs.length) setLabourCategoryId(labs[0].id);
    if (!equipmentId && eqs.length) setEquipmentId(eqs[0].id);
  }

  useEffect(() => {
    reload().catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplier.id]);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    const c = Number(cost);
    if (!(c >= 0)) return;
    setError(null);
    try {
      if (tab === "materiais") {
        if (!materialId) return;
        await suppliersApi.setMaterialPrice(supplier.id, { materialId, zoneId: zoneId || null, unitCost: c });
      } else if (tab === "mao-de-obra") {
        if (!labourCategoryId) return;
        await suppliersApi.setLabourPrice(supplier.id, { labourCategoryId, zoneId: zoneId || null, hourlyCost: c });
      } else {
        if (!equipmentId) return;
        await suppliersApi.setEquipmentPrice(supplier.id, { equipmentId, zoneId: zoneId || null, hourlyCost: c });
      }
      setCost("");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao guardar preço");
    }
  }

  async function handleRemove(kind: Tab, priceId: string) {
    setError(null);
    try {
      if (kind === "materiais") await suppliersApi.deleteMaterialPrice(supplier.id, priceId);
      else if (kind === "mao-de-obra") await suppliersApi.deleteLabourPrice(supplier.id, priceId);
      else await suppliersApi.deleteEquipmentPrice(supplier.id, priceId);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao remover preço");
    }
  }

  const optionsEmpty =
    (tab === "materiais" && materials.length === 0) ||
    (tab === "mao-de-obra" && labourCategories.length === 0) ||
    (tab === "maquinas" && equipmentList.length === 0);

  return (
    <Modal title={`${supplier.name}`} subtitle="Materiais, mão-de-obra e máquinas ligados ao Catálogo — usados para sugerir preços ao criar ordens de compra." onClose={onClose} maxWidth="max-w-2xl">
      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      <div className="flex gap-1 border-b border-gray-200 mb-4">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === t.id ? "border-brand-700 text-brand-800" : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {optionsEmpty ? (
        <p className="text-xs text-gray-400 mb-3">Sem opções no Catálogo ainda para este tipo de recurso.</p>
      ) : (
        <form onSubmit={handleAdd} className="flex gap-2 items-end flex-wrap mb-4">
          <div>
            <label className="label">{tab === "materiais" ? "Material" : tab === "mao-de-obra" ? "Categoria" : "Equipamento"}</label>
            {tab === "materiais" && (
              <select value={materialId} onChange={(e) => setMaterialId(e.target.value)} className="input input-sm">
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.unit})
                  </option>
                ))}
              </select>
            )}
            {tab === "mao-de-obra" && (
              <select value={labourCategoryId} onChange={(e) => setLabourCategoryId(e.target.value)} className="input input-sm">
                {labourCategories.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            )}
            {tab === "maquinas" && (
              <select value={equipmentId} onChange={(e) => setEquipmentId(e.target.value)} className="input input-sm">
                {equipmentList.map((eq) => (
                  <option key={eq.id} value={eq.id}>
                    {eq.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label className="label">Zona (opcional)</label>
            <select value={zoneId} onChange={(e) => setZoneId(e.target.value)} className="input input-sm">
              <option value="">Preço geral (todas as zonas)</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">{tab === "materiais" ? "Preço" : "Preço/hora"}</label>
            <input type="number" step="0.01" min="0" value={cost} onChange={(e) => setCost(e.target.value)} className="input input-sm w-28" />
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
              <th className="text-left py-2 px-3 font-medium">{tab === "materiais" ? "Material" : tab === "mao-de-obra" ? "Categoria" : "Equipamento"}</th>
              <th className="text-left font-medium">Zona</th>
              <th className="text-right font-medium">Preço</th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody>
            {tab === "materiais" &&
              materialPrices.map((p) => (
                <tr key={p.id} className="table-row">
                  <td className="py-1.5 px-3">{p.materialName}</td>
                  <td className="text-gray-500">{p.zoneName ?? "Geral"}</td>
                  <td className="text-right tabular-nums">
                    {Number(p.unitCost).toLocaleString("pt-MZ", { minimumFractionDigits: 2 })} {p.currency}
                  </td>
                  <td className="text-right pr-2">
                    <button onClick={() => handleRemove("materiais", p.id)} className="icon-btn-danger" title="Remover">
                      <IconTrash className="w-3 h-3" />
                    </button>
                  </td>
                </tr>
              ))}
            {tab === "mao-de-obra" &&
              labourPrices.map((p) => (
                <tr key={p.id} className="table-row">
                  <td className="py-1.5 px-3">{p.labourName}</td>
                  <td className="text-gray-500">{p.zoneName ?? "Geral"}</td>
                  <td className="text-right tabular-nums">
                    {Number(p.hourlyCost).toLocaleString("pt-MZ", { minimumFractionDigits: 2 })} {p.currency}/h
                  </td>
                  <td className="text-right pr-2">
                    <button onClick={() => handleRemove("mao-de-obra", p.id)} className="icon-btn-danger" title="Remover">
                      <IconTrash className="w-3 h-3" />
                    </button>
                  </td>
                </tr>
              ))}
            {tab === "maquinas" &&
              equipmentPrices.map((p) => (
                <tr key={p.id} className="table-row">
                  <td className="py-1.5 px-3">{p.equipmentName}</td>
                  <td className="text-gray-500">{p.zoneName ?? "Geral"}</td>
                  <td className="text-right tabular-nums">
                    {Number(p.hourlyCost).toLocaleString("pt-MZ", { minimumFractionDigits: 2 })} {p.currency}/h
                  </td>
                  <td className="text-right pr-2">
                    <button onClick={() => handleRemove("maquinas", p.id)} className="icon-btn-danger" title="Remover">
                      <IconTrash className="w-3 h-3" />
                    </button>
                  </td>
                </tr>
              ))}
            {((tab === "materiais" && materialPrices.length === 0) ||
              (tab === "mao-de-obra" && labourPrices.length === 0) ||
              (tab === "maquinas" && equipmentPrices.length === 0)) && (
              <tr>
                <td colSpan={4} className="py-3 text-center text-gray-400">
                  Sem preços cadastrados ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

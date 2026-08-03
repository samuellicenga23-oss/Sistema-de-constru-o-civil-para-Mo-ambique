import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  suppliersApi,
  type Supplier,
  type SupplierMaterialPrice,
  type SupplierLabourPrice,
  type SupplierEquipmentPrice,
} from "../api/suppliers";
import { catalogApi, type Material, type LabourCategory, type Equipment, type PriceZone } from "../api/catalog";
import Modal from "./Modal";
import PageSearch from "./PageSearch";
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
  const [query, setQuery] = useState("");

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
  const needle = query.trim().toLocaleLowerCase("pt");
  const filteredMaterialPrices = useMemo(() => materialPrices.filter((price) => !needle || [price.materialName, price.zoneName].some((value) => String(value ?? "").toLocaleLowerCase("pt").includes(needle))), [materialPrices, needle]);
  const filteredLabourPrices = useMemo(() => labourPrices.filter((price) => !needle || [price.labourName, price.zoneName].some((value) => String(value ?? "").toLocaleLowerCase("pt").includes(needle))), [labourPrices, needle]);
  const filteredEquipmentPrices = useMemo(() => equipmentPrices.filter((price) => !needle || [price.equipmentName, price.zoneName].some((value) => String(value ?? "").toLocaleLowerCase("pt").includes(needle))), [equipmentPrices, needle]);
  const visiblePriceCount = tab === "materiais" ? filteredMaterialPrices.length : tab === "mao-de-obra" ? filteredLabourPrices.length : filteredEquipmentPrices.length;

  return (
    <Modal title={supplier.name} subtitle="Recursos e cotações deste fornecedor usados nas compras e estimativas da obra." onClose={onClose} maxWidth="max-w-4xl">
      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      <div className="workspace-tabs mb-5">
        {TABS.filter((t) => !supplier.isReference || t.id === "materiais").map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`workspace-tab ${tab === t.id ? "workspace-tab-active" : ""}`}
          >
            {t.label} <span className="ml-1 text-[10px] text-slate-400">({t.id === "materiais" ? materialPrices.length : t.id === "mao-de-obra" ? labourPrices.length : equipmentPrices.length})</span>
          </button>
        ))}
      </div>

      {supplier.isReference && (
        <div className="mb-4 flex flex-col gap-1 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-950 sm:flex-row sm:items-center sm:justify-between">
          <strong>Referência nacional sem IVA</strong>
          <span className="text-xs text-brand-800">Revista em {supplier.referenceDate ?? "2026-08-03"} · confirme transporte e cotação antes da compra</span>
        </div>
      )}

      {optionsEmpty ? (
        <p className="text-xs text-gray-400 mb-3">Sem opções no Catálogo ainda para este tipo de recurso.</p>
      ) : !supplier.isReference ? (
        <form onSubmit={handleAdd} className="mb-5 grid items-end gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_9rem_auto]">
          <div className="min-w-0">
            <label className="label">{tab === "materiais" ? "Material" : tab === "mao-de-obra" ? "Categoria" : "Equipamento"}</label>
            {tab === "materiais" && (
              <select value={materialId} onChange={(e) => setMaterialId(e.target.value)} className="input">
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.unit})
                  </option>
                ))}
              </select>
            )}
            {tab === "mao-de-obra" && (
              <select value={labourCategoryId} onChange={(e) => setLabourCategoryId(e.target.value)} className="input">
                {labourCategories.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            )}
            {tab === "maquinas" && (
              <select value={equipmentId} onChange={(e) => setEquipmentId(e.target.value)} className="input">
                {equipmentList.map((eq) => (
                  <option key={eq.id} value={eq.id}>
                    {eq.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="min-w-0">
            <label className="label">Zona (opcional)</label>
            <select value={zoneId} onChange={(e) => setZoneId(e.target.value)} className="input">
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
            <input type="number" step="0.01" min="0" value={cost} onChange={(e) => setCost(e.target.value)} className="input" />
          </div>
          <button type="submit" className="btn btn-primary w-full lg:w-auto">
            <IconPlus className="w-3.5 h-3.5" />
            Guardar
          </button>
        </form>
      ) : null}

      <div className="mb-3">
        <PageSearch value={query} onChange={setQuery} placeholder="Pesquisar recurso ou zona…" resultLabel={`${visiblePriceCount} preço(s)`} />
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full min-w-[600px] text-sm">
          <thead>
            <tr className="table-head-row">
              <th className="text-left py-2 px-3 font-medium">{tab === "materiais" ? "Material" : tab === "mao-de-obra" ? "Categoria" : "Equipamento"}</th>
              <th className="text-left font-medium">{supplier.isReference && tab === "materiais" ? "Fonte / data" : "Zona"}</th>
              <th className="text-right font-medium">Preço</th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody>
            {tab === "materiais" &&
              filteredMaterialPrices.map((p) => (
                <tr key={p.id} className="table-row">
                  <td className="py-1.5 px-3">{p.materialName}</td>
                  <td className="text-gray-500">
                    {supplier.isReference
                      ? <><span className="block max-w-[16rem] truncate">{p.materialSourceName ?? "Referência SIGO"}</span><span className="text-xs text-slate-400">{p.materialPriceDate ?? supplier.referenceDate ?? "—"}</span></>
                      : p.zoneName ?? "Geral"}
                  </td>
                  <td className="text-right tabular-nums">
                    {Number(p.unitCost).toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {p.currency}
                  </td>
                  <td className="text-right pr-2">
                    {!supplier.isReference && <button onClick={() => handleRemove("materiais", p.id)} className="icon-btn-danger" title="Remover">
                      <IconTrash className="w-3 h-3" />
                    </button>}
                  </td>
                </tr>
              ))}
            {tab === "mao-de-obra" &&
              filteredLabourPrices.map((p) => (
                <tr key={p.id} className="table-row">
                  <td className="py-1.5 px-3">{p.labourName}</td>
                  <td className="text-gray-500">{p.zoneName ?? "Geral"}</td>
                  <td className="text-right tabular-nums">
                    {Number(p.hourlyCost).toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {p.currency}/h
                  </td>
                  <td className="text-right pr-2">
                    <button onClick={() => handleRemove("mao-de-obra", p.id)} className="icon-btn-danger" title="Remover">
                      <IconTrash className="w-3 h-3" />
                    </button>
                  </td>
                </tr>
              ))}
            {tab === "maquinas" &&
              filteredEquipmentPrices.map((p) => (
                <tr key={p.id} className="table-row">
                  <td className="py-1.5 px-3">{p.equipmentName}</td>
                  <td className="text-gray-500">{p.zoneName ?? "Geral"}</td>
                  <td className="text-right tabular-nums">
                    {Number(p.hourlyCost).toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {p.currency}/h
                  </td>
                  <td className="text-right pr-2">
                    <button onClick={() => handleRemove("maquinas", p.id)} className="icon-btn-danger" title="Remover">
                      <IconTrash className="w-3 h-3" />
                    </button>
                  </td>
                </tr>
              ))}
            {visiblePriceCount === 0 && (
              <tr>
                <td colSpan={4} className="py-3 text-center text-gray-400">
                  {query ? "Nenhum preço corresponde à pesquisa." : "Sem preços cadastrados ainda."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

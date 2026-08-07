import { useEffect, useMemo, useState } from "react";
import {
  suppliersApi,
  type Supplier,
  type SupplierMaterialPrice,
  type SupplierLabourPrice,
  type SupplierEquipmentPrice,
} from "../api/suppliers";
import Modal from "./Modal";
import PageSearch from "./PageSearch";

type Tab = "materiais" | "mao-de-obra" | "maquinas";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "materiais", label: "Materiais" },
  { id: "mao-de-obra", label: "Mão-de-obra" },
  { id: "maquinas", label: "Máquinas" },
];

function money(value: string | number) {
  return Number(value).toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Consulta só leitura — preços e produtos são geridos pelo fornecedor no Portal. */
export default function SupplierMaterialsModal({ supplier, onClose }: { supplier: Supplier; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("materiais");
  const [materialPrices, setMaterialPrices] = useState<SupplierMaterialPrice[]>([]);
  const [labourPrices, setLabourPrices] = useState<SupplierLabourPrice[]>([]);
  const [equipmentPrices, setEquipmentPrices] = useState<SupplierEquipmentPrice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    Promise.all([
      suppliersApi.listMaterialPrices(supplier.id),
      suppliersApi.listLabourPrices(supplier.id),
      suppliersApi.listEquipmentPrices(supplier.id),
    ])
      .then(([matPrices, labPrices, eqPrices]) => {
        setMaterialPrices(matPrices);
        setLabourPrices(labPrices);
        setEquipmentPrices(eqPrices);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [supplier.id]);

  const needle = query.trim().toLocaleLowerCase("pt");
  const filteredMaterialPrices = useMemo(
    () => materialPrices.filter((price) => !needle || [price.materialName, price.zoneName].some((value) => String(value ?? "").toLocaleLowerCase("pt").includes(needle))),
    [materialPrices, needle],
  );
  const filteredLabourPrices = useMemo(
    () => labourPrices.filter((price) => !needle || [price.labourName, price.zoneName].some((value) => String(value ?? "").toLocaleLowerCase("pt").includes(needle))),
    [labourPrices, needle],
  );
  const filteredEquipmentPrices = useMemo(
    () => equipmentPrices.filter((price) => !needle || [price.equipmentName, price.zoneName].some((value) => String(value ?? "").toLocaleLowerCase("pt").includes(needle))),
    [equipmentPrices, needle],
  );
  const visiblePriceCount = tab === "materiais" ? filteredMaterialPrices.length : tab === "mao-de-obra" ? filteredLabourPrices.length : filteredEquipmentPrices.length;

  return (
    <Modal
      title={supplier.name}
      subtitle="Livro de preços (consulta). Criar ou alterar preços e produtos só é permitido no Portal do Fornecedor."
      onClose={onClose}
      maxWidth="max-w-4xl"
    >
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-relaxed text-slate-700">
        No SIGO pode ver estes preços e pedir confirmação de preço e disponibilidade, indicando as quantidades. O fornecedor actualiza o seu catálogo directamente no portal.
      </div>

      <div className="workspace-tabs mb-5">
        {TABS.filter((t) => !supplier.isReference || t.id === "materiais").map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)} className={`workspace-tab ${tab === t.id ? "workspace-tab-active" : ""}`}>
            {t.label}{" "}
            <span className="ml-1 text-[10px] text-slate-400">
              ({t.id === "materiais" ? materialPrices.length : t.id === "mao-de-obra" ? labourPrices.length : equipmentPrices.length})
            </span>
          </button>
        ))}
      </div>

      <div className="mb-3">
        <PageSearch value={query} onChange={setQuery} placeholder="Pesquisar material ou zona…" resultLabel={`${visiblePriceCount} preço(s)`} />
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full min-w-[600px] text-sm">
          <thead>
            <tr className="table-head-row">
              <th className="px-3 py-2 text-left font-medium">{tab === "materiais" ? "Material" : tab === "mao-de-obra" ? "Categoria" : "Equipamento"}</th>
              <th className="text-left font-medium">Zona</th>
              <th className="pr-3 text-right font-medium">Preço</th>
            </tr>
          </thead>
          <tbody>
            {tab === "materiais" &&
              filteredMaterialPrices.map((p) => (
                <tr key={p.id} className="table-row">
                  <td className="px-3 py-1.5">{p.materialName}</td>
                  <td className="text-gray-500">{p.zoneName ?? "Geral"}</td>
                  <td className="pr-3 text-right tabular-nums">
                    {money(p.unitCost)} {p.currency}
                  </td>
                </tr>
              ))}
            {tab === "mao-de-obra" &&
              filteredLabourPrices.map((p) => (
                <tr key={p.id} className="table-row">
                  <td className="px-3 py-1.5">{p.labourName}</td>
                  <td className="text-gray-500">{p.zoneName ?? "Geral"}</td>
                  <td className="pr-3 text-right tabular-nums">
                    {money(p.hourlyCost)} {p.currency}/h
                  </td>
                </tr>
              ))}
            {tab === "maquinas" &&
              filteredEquipmentPrices.map((p) => (
                <tr key={p.id} className="table-row">
                  <td className="px-3 py-1.5">{p.equipmentName}</td>
                  <td className="text-gray-500">{p.zoneName ?? "Geral"}</td>
                  <td className="pr-3 text-right tabular-nums">
                    {money(p.hourlyCost)} {p.currency}/h
                  </td>
                </tr>
              ))}
            {visiblePriceCount === 0 && (
              <tr>
                <td colSpan={3} className="py-6 text-center text-gray-400">
                  {query ? "Nenhum preço corresponde à pesquisa." : "Sem preços publicados ainda."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

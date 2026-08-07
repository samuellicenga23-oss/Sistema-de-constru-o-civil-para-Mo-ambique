import { useEffect, useState } from "react";
import { suppliersApi, type SupplierMaterialPrice, type SupplierLabourPrice, type SupplierEquipmentPrice } from "../api/suppliers";
import type { MarketplaceSupplier } from "../api/marketplace";
import Modal from "./Modal";
import PageSearch from "./PageSearch";

type Tab = "materiais" | "mao-de-obra" | "maquinas";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "materiais", label: "Materiais" },
  { id: "mao-de-obra", label: "Mão-de-obra" },
  { id: "maquinas", label: "Máquinas" },
];

// Só leitura — os preços de um fornecedor do marketplace são geridos por ele próprio no Portal
// do Fornecedor, nunca por uma empresa cliente. Este modal existe para a empresa consultar antes
// de decidir pedir cotação.
export default function MarketplaceSupplierModal({
  supplier,
  onClose,
  onRequestQuote,
}: {
  supplier: MarketplaceSupplier;
  onClose: () => void;
  onRequestQuote: () => void;
}) {
  const [tab, setTab] = useState<Tab>("materiais");
  const [materialPrices, setMaterialPrices] = useState<SupplierMaterialPrice[]>([]);
  const [labourPrices, setLabourPrices] = useState<SupplierLabourPrice[]>([]);
  const [equipmentPrices, setEquipmentPrices] = useState<SupplierEquipmentPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    Promise.all([suppliersApi.listMaterialPrices(supplier.id), suppliersApi.listLabourPrices(supplier.id), suppliersApi.listEquipmentPrices(supplier.id)])
      .then(([m, l, e]) => {
        setMaterialPrices(m);
        setLabourPrices(l);
        setEquipmentPrices(e);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Erro ao carregar preços"))
      .finally(() => setLoading(false));
  }, [supplier.id]);

  const needle = query.trim().toLocaleLowerCase("pt");
  const filteredMaterials = materialPrices.filter((p) => !needle || p.materialName.toLocaleLowerCase("pt").includes(needle));
  const filteredLabour = labourPrices.filter((p) => !needle || p.labourName.toLocaleLowerCase("pt").includes(needle));
  const filteredEquipment = equipmentPrices.filter((p) => !needle || p.equipmentName.toLocaleLowerCase("pt").includes(needle));
  const visibleCount = tab === "materiais" ? filteredMaterials.length : tab === "mao-de-obra" ? filteredLabour.length : filteredEquipment.length;

  return (
    <Modal title={supplier.name} subtitle={`Fornecedor do marketplace SIGO Fornecedores${supplier.zoneName ? ` · ${supplier.zoneName}` : ""}`} onClose={onClose} maxWidth="max-w-3xl">
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      <div className="workspace-tabs mb-4">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`workspace-tab ${tab === t.id ? "workspace-tab-active" : ""}`}>
            {t.label} <span className="ml-1 text-[10px] text-slate-400">({t.id === "materiais" ? materialPrices.length : t.id === "mao-de-obra" ? labourPrices.length : equipmentPrices.length})</span>
          </button>
        ))}
      </div>

      <div className="mb-3">
        <PageSearch value={query} onChange={setQuery} placeholder="Pesquisar recurso…" resultLabel={`${visibleCount} preço(s)`} />
      </div>

      {loading ? (
        <p className="py-6 text-center text-sm text-slate-500">A carregar...</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full min-w-[500px] text-sm">
            <thead>
              <tr className="table-head-row">
                <th className="px-3 py-2 text-left font-medium">{tab === "materiais" ? "Material" : tab === "mao-de-obra" ? "Categoria" : "Equipamento"}</th>
                <th className="text-right font-medium">Preço</th>
              </tr>
            </thead>
            <tbody>
              {tab === "materiais" &&
                filteredMaterials.map((p) => (
                  <tr key={p.id} className="table-row">
                    <td className="px-3 py-1.5">{p.materialName}</td>
                    <td className="text-right tabular-nums">{Number(p.unitCost).toLocaleString("pt-MZ", { minimumFractionDigits: 2 })} {p.currency}</td>
                  </tr>
                ))}
              {tab === "mao-de-obra" &&
                filteredLabour.map((p) => (
                  <tr key={p.id} className="table-row">
                    <td className="px-3 py-1.5">{p.labourName}</td>
                    <td className="text-right tabular-nums">{Number(p.hourlyCost).toLocaleString("pt-MZ", { minimumFractionDigits: 2 })} {p.currency}/h</td>
                  </tr>
                ))}
              {tab === "maquinas" &&
                filteredEquipment.map((p) => (
                  <tr key={p.id} className="table-row">
                    <td className="px-3 py-1.5">{p.equipmentName}</td>
                    <td className="text-right tabular-nums">{Number(p.hourlyCost).toLocaleString("pt-MZ", { minimumFractionDigits: 2 })} {p.currency}/h</td>
                  </tr>
                ))}
              {visibleCount === 0 && (
                <tr>
                  <td colSpan={2} className="py-4 text-center text-slate-400">
                    {query ? "Nenhum preço corresponde à pesquisa." : "Este fornecedor ainda não publicou preços."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-5 flex justify-end border-t border-slate-200 pt-4">
        <button onClick={onRequestQuote} className="btn btn-primary">Pedir cotação formal</button>
      </div>
    </Modal>
  );
}

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { catalogApi, type Material } from "../api/catalog";
import Modal from "./Modal";

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

/** Só consulta — a empresa não cria nem edita preços de fornecedores. */
export default function MaterialPricingModal({ material, onClose }: { material: Material; onClose: () => void; onChanged?: () => void }) {
  const [supplierRows, setSupplierRows] = useState<MaterialSupplierRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    catalogApi
      .listMaterialSuppliers(material.id)
      .then((rows) => setSupplierRows(rows as MaterialSupplierRow[]))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [material.id]);

  return (
    <Modal
      title={`Preços e fornecedores — ${material.name}`}
      subtitle={`Preço base do catálogo (orçamentos): ${money(material.baseUnitCost)} ${material.currency} / ${material.unit}. Abaixo: cotações publicadas pelos fornecedores (só leitura).`}
      onClose={onClose}
      maxWidth="max-w-2xl"
    >
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-700">Quem vende este material</h3>
            <p className="mt-1 text-xs text-gray-500">
              Para confirmar preço e stock, peça cotação em Fornecedores com as quantidades necessárias. Os fornecedores gerem os seus preços no Portal.
            </p>
          </div>
          <Link to="/gestao/fornecedores" className="text-xs font-medium text-brand-700 hover:underline">
            Pesquisar fornecedores →
          </Link>
        </div>

        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="table-head-row">
                <th className="px-3 py-2 text-left font-medium">Fornecedor</th>
                <th className="text-left font-medium">Zona</th>
                <th className="text-left font-medium">Contacto</th>
                <th className="pr-3 text-right font-medium">Preço</th>
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
                  <td className="pr-3 text-right tabular-nums">
                    {money(r.unitCost)} {r.currency}
                  </td>
                </tr>
              ))}
              {supplierRows.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-gray-400">
                    Ainda não há fornecedores com este material publicado.
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

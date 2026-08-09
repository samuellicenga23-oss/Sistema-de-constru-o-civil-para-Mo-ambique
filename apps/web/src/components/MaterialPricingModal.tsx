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
      .then((rows) => setSupplierRows((rows as MaterialSupplierRow[]).sort((a, b) => Number(a.unitCost) - Number(b.unitCost))))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [material.id]);

  return (
    <Modal
      title={`Cotações — ${material.name}`}
      subtitle={`Referência do catálogo: ${money(material.effectiveUnitCost)} ${material.currency}/${material.unit}`}
      onClose={onClose}
      maxWidth="max-w-2xl"
    >
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-gray-700">{supplierRows.length} fornecedor(es)</h3>
          <Link to="/gestao/fornecedores" className="text-xs font-medium text-brand-700 hover:underline">
            Gerir fornecedores →
          </Link>
        </div>

        <div className="space-y-2 md:hidden">
          {supplierRows.map((row, index) => (
            <article key={`mobile-${row.id}`} className="rounded-xl border border-slate-200 p-3">
              <div className="flex items-start justify-between gap-3">
                <div><strong className="text-sm text-slate-900">{row.supplierName}</strong><p className="mt-0.5 text-xs text-slate-500">{row.zoneName ?? "Preço geral"}</p></div>
                <div className="text-right"><strong className="text-sm tabular-nums text-slate-950">{money(row.unitCost)} {row.currency}</strong>{index === 0 && <span className="mt-1 block text-[10px] font-semibold text-emerald-700">Melhor preço</span>}</div>
              </div>
              {row.supplierContact && <a href={`tel:${row.supplierContact}`} className="mt-2 inline-block text-xs font-semibold text-brand-700">{row.supplierContact}</a>}
            </article>
          ))}
        </div>
        <div className="hidden overflow-x-auto rounded-lg border border-gray-200 md:block">
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
              {supplierRows.map((r, index) => (
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
                    {index === 0 && <span className="ml-2 text-[10px] font-semibold text-emerald-700">Melhor</span>}
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
        {supplierRows.length === 0 && <p className="py-6 text-center text-sm text-slate-500 md:hidden">Ainda não há cotações publicadas.</p>}
      </section>
    </Modal>
  );
}

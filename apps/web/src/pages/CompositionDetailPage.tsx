import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { catalogApi, type CostCompositionDetail, type LabourCategory, type Material, type Equipment } from "../api/catalog";
import Layout from "../components/Layout";
import { IconTrash, IconPlus, IconBack } from "../components/icons";

function money(value: string | number) {
  return Number(value).toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

type SupplierSummary = { count: number; cheapest: { supplierName: string; unitCost: number; currency: string } };

function formatSupplierHint(summaries: Map<string, SupplierSummary>, refId: string): string | null {
  const s = summaries.get(refId);
  if (!s) return null;
  const plural = s.count === 1 ? "fornecedor" : "fornecedores";
  return `${s.count} ${plural} cadastrado(s) · desde ${money(s.cheapest.unitCost)} ${s.cheapest.currency} (${s.cheapest.supplierName})`;
}

// Resolve por NOME, nunca pelo id da linha: composições ainda não clonadas para esta empresa
// apontam para o recurso GLOBAL, mas os preços de fornecedor ficam sempre ligados ao recurso da
// PRÓPRIA empresa (clonado automaticamente ao editar) — o mesmo princípio já usado no `fallback`
// de cada LineEditor para o custo do recurso.
async function buildSupplierSummaryByRefId<TLine extends { refId: string; name: string }, TOption extends { id: string; name: string }>(
  lines: TLine[],
  currentOptions: TOption[],
  fetchSuppliers: (id: string) => Promise<Array<{ supplierName: string; currency: string; unitCost?: string; hourlyCost?: string }>>
): Promise<Map<string, SupplierSummary>> {
  const nameByRefId = new Map(lines.map((l) => [l.refId, l.name]));
  const uniqueNames = Array.from(new Set(lines.map((l) => l.name)));
  const summaries = await Promise.all(
    uniqueNames.map(async (name) => {
      const lookupId = currentOptions.find((o) => o.name === name)?.id ?? lines.find((l) => l.name === name)?.refId;
      if (!lookupId) return [name, null] as const;
      const rows = await fetchSuppliers(lookupId).catch(() => []);
      if (rows.length === 0) return [name, null] as const;
      const cost = (r: (typeof rows)[number]) => Number(r.unitCost ?? r.hourlyCost ?? 0);
      const cheapest = rows.reduce((min, r) => (cost(r) < cost(min) ? r : min), rows[0]);
      return [name, { count: rows.length, cheapest: { supplierName: cheapest.supplierName, unitCost: cost(cheapest), currency: cheapest.currency } }] as const;
    })
  );
  const summaryByName = new Map(summaries.filter(([, v]) => v !== null) as [string, SupplierSummary][]);
  return new Map(Array.from(nameByRefId.entries()).flatMap(([refId, name]) => (summaryByName.has(name) ? [[refId, summaryByName.get(name)!]] : [])));
}

// Linha editável do editor: recurso escolhido + rendimento/consumo por unidade de saída.
type EditableLine = { refId: string; qtyPerUnit: number };

function LineEditor({
  title,
  unitLabel,
  lines,
  setLines,
  options,
  optionCost,
  fallback,
  hint,
}: {
  title: string;
  unitLabel: string;
  lines: EditableLine[];
  setLines: (l: EditableLine[]) => void;
  options: Array<{ id: string; name: string }>;
  optionCost: (refId: string) => number;
  // Nome/custo de recursos que já não aparecem em `options` — por exemplo, uma matéria-prima
  // partilhada que a empresa entretanto passou a ter na sua própria versão (com outro id):
  // a linha continua a apontar para o id antigo, mas ainda é válido e tem de mostrar-se bem.
  fallback: Map<string, { name: string; unitCost: number }>;
  // Texto opcional mostrado por baixo do nome do recurso — usado nos Materiais para indicar se há
  // fornecedores cadastrados com preço (ver GET /api/catalog/materials/:id/suppliers).
  hint?: (refId: string) => string | null;
}) {
  const [newRefId, setNewRefId] = useState("");
  const [newQty, setNewQty] = useState("");

  const available = options.filter((o) => !lines.some((l) => l.refId === o.id));

  function resolveName(refId: string): string {
    return options.find((o) => o.id === refId)?.name ?? fallback.get(refId)?.name ?? "Recurso removido do catálogo";
  }
  function resolveCost(refId: string): number {
    const found = options.find((o) => o.id === refId);
    if (found) return optionCost(refId);
    return fallback.get(refId)?.unitCost ?? 0;
  }

  const subtotal = lines.reduce((sum, l) => sum + l.qtyPerUnit * resolveCost(l.refId), 0);

  function updateQty(refId: string, qty: number) {
    setLines(lines.map((l) => (l.refId === refId ? { ...l, qtyPerUnit: qty } : l)));
  }

  function removeLine(refId: string) {
    setLines(lines.filter((l) => l.refId !== refId));
  }

  function addLine() {
    if (!newRefId || !newQty) return;
    setLines([...lines, { refId: newRefId, qtyPerUnit: Number(newQty) }]);
    setNewRefId("");
    setNewQty("");
  }

  return (
    <section className="card card-pad">
      <div className="flex items-center justify-between mb-3">
        <h2 className="section-title">{title}</h2>
        <span className="text-sm font-semibold text-brand-800 tabular-nums">{money(subtotal)} MZN</span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="table-head-row">
            <th className="py-1.5 font-medium">Recurso</th>
            <th className="w-32 font-medium">{unitLabel}</th>
            <th className="w-28 text-right font-medium">Custo unitário</th>
            <th className="w-28 text-right font-medium">Subtotal</th>
            <th className="w-8"></th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const cost = resolveCost(l.refId);
            return (
              <tr key={l.refId} className="table-row">
                <td className="py-1.5">
                  {resolveName(l.refId)}
                  {hint?.(l.refId) && <p className="text-[11px] text-gray-400">{hint(l.refId)}</p>}
                </td>
                <td>
                  <input
                    type="number"
                    step="any"
                    value={l.qtyPerUnit}
                    onChange={(e) => updateQty(l.refId, Number(e.target.value))}
                    className="input input-sm w-24"
                  />
                </td>
                <td className="text-right tabular-nums text-gray-600">{money(cost)}</td>
                <td className="text-right tabular-nums font-medium">{money(l.qtyPerUnit * cost)}</td>
                <td className="text-right">
                  <button onClick={() => removeLine(l.refId)} className="icon-btn-danger">
                    <IconTrash className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            );
          })}
          {lines.length === 0 && (
            <tr>
              <td colSpan={5} className="py-3 text-gray-400 text-xs text-center">
                Sem recursos nesta secção.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {available.length > 0 && (
        <div className="flex gap-1.5 items-end mt-3">
          <select value={newRefId} onChange={(e) => setNewRefId(e.target.value)} className="input input-sm flex-1">
            <option value="">— escolher recurso —</option>
            {available.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <input type="number" step="any" placeholder={unitLabel} value={newQty} onChange={(e) => setNewQty(e.target.value)} className="input input-sm w-28" />
          <button onClick={addLine} type="button" className="btn btn-secondary btn-sm">
            <IconPlus className="w-3.5 h-3.5" />
            Adicionar
          </button>
        </div>
      )}
    </section>
  );
}

export default function CompositionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<CostCompositionDetail | null>(null);
  const [labourCategories, setLabourCategories] = useState<LabourCategory[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [labourLines, setLabourLines] = useState<EditableLine[]>([]);
  const [materialLines, setMaterialLines] = useState<EditableLine[]>([]);
  const [equipmentLines, setEquipmentLines] = useState<EditableLine[]>([]);
  const [labourFallback, setLabourFallback] = useState<Map<string, { name: string; unitCost: number }>>(new Map());
  const [materialFallback, setMaterialFallback] = useState<Map<string, { name: string; unitCost: number }>>(new Map());
  const [equipmentFallback, setEquipmentFallback] = useState<Map<string, { name: string; unitCost: number }>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [supplierSummaryByMaterial, setSupplierSummaryByMaterial] = useState<Map<string, SupplierSummary>>(new Map());
  const [supplierSummaryByLabour, setSupplierSummaryByLabour] = useState<Map<string, SupplierSummary>>(new Map());
  const [supplierSummaryByEquipment, setSupplierSummaryByEquipment] = useState<Map<string, SupplierSummary>>(new Map());

  async function reload(loadId: string) {
    const [d, lc, m, eq] = await Promise.all([
      catalogApi.getComposition(loadId),
      catalogApi.listLabourCategories(),
      catalogApi.listMaterials(),
      catalogApi.listEquipment(),
    ]);
    setDetail(d);
    setName(d.name);
    setCategory(d.category);
    setLabourLines(d.labourLines.map((l) => ({ refId: l.refId, qtyPerUnit: Number(l.qtyPerUnit) })));
    setMaterialLines(d.materialLines.map((l) => ({ refId: l.refId, qtyPerUnit: Number(l.qtyPerUnit) })));
    setEquipmentLines(d.equipmentLines.map((l) => ({ refId: l.refId, qtyPerUnit: Number(l.qtyPerUnit) })));
    // Reserva: nome/custo de cada recurso tal como o backend os resolveu para ESTA
    // composição — cobre o caso de o id já não aparecer na lista geral (deduplicada).
    setLabourFallback(new Map(d.labourLines.map((l) => [l.refId, { name: l.name, unitCost: Number(l.unitCost) }])));
    setMaterialFallback(new Map(d.materialLines.map((l) => [l.refId, { name: l.name, unitCost: Number(l.unitCost) * Number(l.importFactor ?? 1) }])));
    setEquipmentFallback(new Map(d.equipmentLines.map((l) => [l.refId, { name: l.name, unitCost: Number(l.unitCost) }])));
    setLabourCategories(lc);
    setMaterials(m);
    setEquipment(eq);

    // Fornecedores cadastrados para cada recurso desta composição — mostrado como referência
    // ("3 fornecedores · desde 620 MZN") no editor, sem substituir o custo do catálogo usado no
    // cálculo (que continua a ser o preço base/por zona do recurso, não o preço de um fornecedor
    // específico — essa escolha fica para a ordem de compra/contratação).
    const [materialSummary, labourSummary, equipmentSummary] = await Promise.all([
      buildSupplierSummaryByRefId(d.materialLines, m, (id) => catalogApi.listMaterialSuppliers(id)),
      buildSupplierSummaryByRefId(d.labourLines, lc, (id) => catalogApi.listLabourSuppliers(id)),
      buildSupplierSummaryByRefId(d.equipmentLines, eq, (id) => catalogApi.listEquipmentSuppliers(id)),
    ]);
    setSupplierSummaryByMaterial(materialSummary);
    setSupplierSummaryByLabour(labourSummary);
    setSupplierSummaryByEquipment(equipmentSummary);
  }

  useEffect(() => {
    if (!id) return;
    reload(id).catch((err) => setError(err.message));
  }, [id]);

  // Gravar sempre funciona directamente — se a composição ainda pertencer ao catálogo
  // partilhado, o backend clona-a silenciosamente para a empresa; se o id devolvido for
  // diferente do actual, navegamos para o novo endereço (a "sua" cópia) sem o utilizador notar.
  async function handleSave() {
    if (!id || !detail) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const result = await catalogApi.updateComposition(id, {
        name,
        category: category || "Outros",
        outputUnit: detail.outputUnit,
        currency: detail.currency,
        labourLines,
        materialLines,
        equipmentLines,
      });
      setMessage("Composição gravada — o novo preço unitário já está em uso para novos itens do orçamento.");
      if (result.id !== id) {
        navigate(`/catalogo/composicoes/${result.id}`, { replace: true });
      } else {
        await reload(id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao gravar");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!id || !detail) return;
    if (!window.confirm(`Eliminar a composição "${detail.name}"? Itens de orçamento já criados mantêm o preço gravado, mas deixarão de estar ligados a esta composição.`)) return;
    await catalogApi.deleteComposition(id);
    navigate("/catalogo");
  }

  if (!detail) {
    return <div className="min-h-screen flex items-center justify-center text-gray-400">A carregar...</div>;
  }

  // Usa o preço ao vivo do catálogo quando o recurso ainda lá está; senão, a reserva
  // gravada com esta composição (evita mostrar 0 para recursos "escondidos" pela deduplicação).
  const labourCost = labourLines.reduce(
    (s, l) => s + l.qtyPerUnit * Number(labourCategories.find((o) => o.id === l.refId)?.hourlyRate ?? labourFallback.get(l.refId)?.unitCost ?? 0),
    0
  );
  const materialCost = materialLines.reduce((s, l) => {
    const mat = materials.find((o) => o.id === l.refId);
    const cost = mat ? Number(mat.baseUnitCost) * Number(mat.importFactor) : materialFallback.get(l.refId)?.unitCost ?? 0;
    return s + l.qtyPerUnit * cost;
  }, 0);
  const equipmentCost = equipmentLines.reduce(
    (s, l) => s + l.qtyPerUnit * Number(equipment.find((o) => o.id === l.refId)?.hourlyCost ?? equipmentFallback.get(l.refId)?.unitCost ?? 0),
    0
  );
  const unitCost = labourCost + materialCost + equipmentCost;

  return (
    <Layout
      title={detail.name}
      subtitle={`Composição de custo · ${detail.category} · por ${detail.outputUnit}`}
      actions={
        <Link to="/catalogo" className="btn btn-ghost btn-sm">
          <IconBack className="w-3.5 h-3.5" />
          Catálogo
        </Link>
      }
    >
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_18rem] max-w-5xl">
        <div className="space-y-5 min-w-0">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {message && <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">{message}</p>}

          <section className="card card-pad">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Nome da composição</label>
                <input value={name} onChange={(e) => setName(e.target.value)} className="input" />
              </div>
              <div>
                <label className="label">Categoria</label>
                <input value={category} onChange={(e) => setCategory(e.target.value)} className="input" placeholder="ex: Betões, Aços e Cofragens" />
              </div>
            </div>
            <div className="flex justify-between items-center mt-4">
              <button onClick={handleDelete} className="btn btn-ghost btn-sm text-red-600 hover:bg-red-50">
                <IconTrash className="w-3.5 h-3.5" />
                Eliminar composição
              </button>
              <button onClick={handleSave} disabled={saving} className="btn btn-primary">
                {saving ? "A gravar..." : "Gravar composição"}
              </button>
            </div>
          </section>

          <LineEditor
            title="Mão-de-obra"
            unitLabel={`h / ${detail.outputUnit}`}
            lines={labourLines}
            setLines={setLabourLines}
            options={labourCategories}
            optionCost={(refId) => Number(labourCategories.find((o) => o.id === refId)?.hourlyRate ?? 0)}
            fallback={labourFallback}
            hint={(refId) => formatSupplierHint(supplierSummaryByLabour, refId)}
          />
          <LineEditor
            title="Materiais"
            unitLabel={`qtd / ${detail.outputUnit}`}
            lines={materialLines}
            setLines={setMaterialLines}
            options={materials}
            optionCost={(refId) => {
              const mat = materials.find((o) => o.id === refId);
              return Number(mat?.baseUnitCost ?? 0) * Number(mat?.importFactor ?? 1);
            }}
            fallback={materialFallback}
            hint={(refId) => formatSupplierHint(supplierSummaryByMaterial, refId)}
          />
          <LineEditor
            title="Máquinas / Equipamento"
            unitLabel={`h / ${detail.outputUnit}`}
            lines={equipmentLines}
            setLines={setEquipmentLines}
            options={equipment}
            optionCost={(refId) => Number(equipment.find((o) => o.id === refId)?.hourlyCost ?? 0)}
            fallback={equipmentFallback}
            hint={(refId) => formatSupplierHint(supplierSummaryByEquipment, refId)}
          />
        </div>

        <div className="space-y-5">
          <section className="card overflow-hidden xl:sticky xl:top-24">
            <div className="bg-gradient-to-br from-brand-800 to-brand-950 text-white p-5">
              <h2 className="text-sm uppercase tracking-wider text-brand-200 font-semibold mb-3">Preço unitário</h2>
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between text-brand-200">
                  <dt>Mão-de-obra</dt>
                  <dd className="tabular-nums">{money(labourCost)}</dd>
                </div>
                <div className="flex justify-between text-brand-200">
                  <dt>Materiais</dt>
                  <dd className="tabular-nums">{money(materialCost)}</dd>
                </div>
                <div className="flex justify-between text-brand-200">
                  <dt>Máquinas</dt>
                  <dd className="tabular-nums">{money(equipmentCost)}</dd>
                </div>
              </dl>
              <div className="flex justify-between items-baseline border-t border-white/20 pt-3 mt-3">
                <span className="text-sm font-medium">por {detail.outputUnit}</span>
                <span className="text-xl font-bold tabular-nums">{money(unitCost)} MZN</span>
              </div>
            </div>
          </section>
          <div className="card card-pad text-xs text-gray-500 leading-relaxed">
            <p className="font-medium text-gray-700 mb-1">Como funciona</p>
            <p>Ajuste qualquer rendimento ou adicione/remova recursos livremente. Ao gravar, a sua empresa fica sempre com a sua própria versão — o catálogo base partilhado nunca é alterado.</p>
          </div>
        </div>
      </div>
    </Layout>
  );
}

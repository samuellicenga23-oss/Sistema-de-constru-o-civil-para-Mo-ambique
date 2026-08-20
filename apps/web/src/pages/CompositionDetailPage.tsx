import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { catalogApi, type CostCompositionDetail, type LabourCategory, type Material, type Equipment } from "../api/catalog";
import Layout from "../components/Layout";
import LoadingState from "../components/LoadingState";
import AlertBanner from "../components/AlertBanner";
import Modal from "../components/Modal";
import { useConfirmDialog } from "../hooks/useConfirmDialog";
import { useAuth } from "../auth/AuthContext";
import { IconTrash, IconPlus, IconBack } from "../components/icons";
import CompositionTechnicalV2Panel from "../components/CompositionTechnicalV2Panel";
import { resolveSupplierLookupId } from "../utils/resourceIdentity";

type CompositionLocationState = { flash?: string };

function money(value: string | number) {
  return Number(value).toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type SupplierSummary = { count: number; cheapest: { supplierName: string; unitCost: number; currency: string } };

function formatSupplierHint(summaries: Map<string, SupplierSummary>, refId: string): string | null {
  const s = summaries.get(refId);
  if (!s) return null;
  return `${s.count} oferta(s) · melhor ${money(s.cheapest.unitCost)} ${s.cheapest.currency}`;
}

type ResourceTab = "materials" | "labour" | "equipment";

async function buildSupplierSummaryByRefId<TLine extends { refId: string; familyKey?: string | null }, TOption extends { id: string; familyKey?: string | null }>(
  lines: TLine[],
  currentOptions: TOption[],
  fetchSuppliers: (id: string) => Promise<Array<{ supplierName: string; currency: string; unitCost?: string; hourlyCost?: string }>>
): Promise<Map<string, SupplierSummary>> {
  const uniqueLookups = Array.from(new Set(lines.map((line) => resolveSupplierLookupId(line, currentOptions))));
  const summaries = await Promise.all(
    uniqueLookups.map(async (lookupId) => {
      const rows = await fetchSuppliers(lookupId).catch(() => []);
      if (rows.length === 0) return [lookupId, null] as const;
      const cost = (r: (typeof rows)[number]) => Number(r.unitCost ?? r.hourlyCost ?? 0);
      const cheapest = rows.reduce((min, r) => (cost(r) < cost(min) ? r : min), rows[0]);
      return [lookupId, { count: rows.length, cheapest: { supplierName: cheapest.supplierName, unitCost: cost(cheapest), currency: cheapest.currency } }] as const;
    }),
  );
  const summaryByLookup = new Map(summaries.filter(([, value]) => value !== null) as [string, SupplierSummary][]);
  return new Map(lines.flatMap((line) => {
    const lookupId = resolveSupplierLookupId(line, currentOptions);
    const summary = summaryByLookup.get(lookupId);
    return summary ? [[line.refId, summary] as const] : [];
  }));
}

// Linha editável do editor: recurso escolhido + rendimento/consumo por unidade de saída.
type EditableLine = { refId: string; qtyPerUnit: number; wastePct?: number; notes?: string | null };

function LineEditor({
  title,
  unitLabel,
  lines,
  setLines,
  options,
  optionCost,
  fallback,
  hint,
  supportsWaste = false,
  optionDefaultWaste,
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
  supportsWaste?: boolean;
  optionDefaultWaste?: (refId: string) => number;
}) {
  const [newRefId, setNewRefId] = useState("");
  const [newQty, setNewQty] = useState("");
  const [newQuery, setNewQuery] = useState("");

  const query = newQuery.trim().toLocaleLowerCase("pt");
  const remainingOptions = options.filter((o) => !lines.some((l) => l.refId === o.id));
  const available = remainingOptions.filter((o) => !query || o.name.toLocaleLowerCase("pt").includes(query));

  function resolveName(refId: string): string {
    return options.find((o) => o.id === refId)?.name ?? fallback.get(refId)?.name ?? "Recurso removido do catálogo";
  }
  function resolveCost(refId: string): number {
    const found = options.find((o) => o.id === refId);
    if (found) return optionCost(refId);
    return fallback.get(refId)?.unitCost ?? 0;
  }

  const subtotal = lines.reduce((sum, l) => sum + l.qtyPerUnit * (1 + Number(l.wastePct ?? 0) / 100) * resolveCost(l.refId), 0);

  function updateQty(refId: string, qty: number) {
    setLines(lines.map((l) => (l.refId === refId ? { ...l, qtyPerUnit: qty } : l)));
  }

  function updateWaste(refId: string, wastePct: number) {
    setLines(lines.map((l) => (l.refId === refId ? { ...l, wastePct } : l)));
  }

  function removeLine(refId: string) {
    setLines(lines.filter((l) => l.refId !== refId));
  }

  function addLine() {
    if (!newRefId || !newQty) return;
    setLines([...lines, { refId: newRefId, qtyPerUnit: Number(newQty), wastePct: supportsWaste ? optionDefaultWaste?.(newRefId) ?? 0 : undefined }]);
    setNewRefId("");
    setNewQty("");
  }

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
        <h2 className="section-title">{title}</h2>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-brand-800">{money(subtotal)} MZN</span>
      </div>
      <div className="divide-y divide-slate-100 md:hidden">
        {lines.map((line) => {
          const cost = resolveCost(line.refId);
          const effectiveQty = line.qtyPerUnit * (1 + Number(line.wastePct ?? 0) / 100);
          return (
            <div key={`mobile-${line.refId}`} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <strong className="block text-sm text-slate-900">{resolveName(line.refId)}</strong>
                  {hint?.(line.refId) && <p className="mt-1 text-[11px] leading-4 text-slate-500">{hint(line.refId)}</p>}
                </div>
                <button onClick={() => removeLine(line.refId)} className="icon-btn-danger shrink-0" title="Remover recurso">
                  <IconTrash className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className={`mt-3 grid gap-2 ${supportsWaste ? "grid-cols-2" : "grid-cols-1"}`}>
                <label className="text-xs text-slate-500">{unitLabel}
                  <input type="number" step="0.01" value={line.qtyPerUnit} onChange={(event) => updateQty(line.refId, Number(event.target.value))} className="input input-sm mt-1 w-full" />
                </label>
                {supportsWaste && <label className="text-xs text-slate-500">Perda (%)
                  <input type="number" min="0" max="100" step="0.01" value={line.wastePct ?? 0} onChange={(event) => updateWaste(line.refId, Number(event.target.value))} className="input input-sm mt-1 w-full" />
                </label>}
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-xs">
                <span className="text-slate-500">{money(cost)} por unidade</span>
                <strong className="tabular-nums text-slate-900">{money(effectiveQty * cost)} MZN</strong>
              </div>
            </div>
          );
        })}
        {lines.length === 0 && <p className="px-4 py-6 text-center text-xs text-slate-400">Sem recursos nesta secção.</p>}
      </div>
      <div className="hidden overflow-x-auto px-4 py-3 md:block">
      <table className="w-full min-w-[720px] border-separate border-spacing-0 overflow-hidden rounded-lg border border-slate-200 text-sm">
        <thead>
          <tr className="table-head-row">
            <th className="px-3 py-2.5 font-medium">Recurso</th>
            <th className="w-32 px-3 py-2.5 font-medium">{unitLabel}</th>
            {supportsWaste && <th className="w-28 px-3 py-2.5 font-medium">Perda</th>}
            <th className="w-32 px-3 py-2.5 text-right font-medium">Custo unitário</th>
            <th className="w-32 px-3 py-2.5 text-right font-medium">Subtotal</th>
            <th className="w-12 px-2 py-2.5"></th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const cost = resolveCost(l.refId);
            const effectiveQty = l.qtyPerUnit * (1 + Number(l.wastePct ?? 0) / 100);
            return (
              <tr key={l.refId} className="table-row">
                <td className="px-3 py-2.5">
                  {resolveName(l.refId)}
                  {hint?.(l.refId) && <p className="text-[11px] text-gray-400">{hint(l.refId)}</p>}
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    step="0.01"
                    value={l.qtyPerUnit}
                    onChange={(e) => updateQty(l.refId, Number(e.target.value))}
                    className="input input-sm w-24"
                  />
                </td>
                {supportsWaste && <td className="px-3 py-2"><div className="flex items-center gap-1"><input type="number" min="0" max="100" step="0.01" value={l.wastePct ?? 0} onChange={(e) => updateWaste(l.refId, Number(e.target.value))} className="input input-sm w-16" /><span className="text-xs text-slate-400">%</span></div></td>}
                <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{money(cost)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums font-medium">{money(effectiveQty * cost)}</td>
                <td className="px-2 py-2 text-right">
                  <button onClick={() => removeLine(l.refId)} className="icon-btn-danger">
                    <IconTrash className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            );
          })}
          {lines.length === 0 && (
            <tr>
              <td colSpan={supportsWaste ? 6 : 5} className="py-3 text-gray-400 text-xs text-center">
                Sem recursos nesta secção.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>

      {remainingOptions.length > 0 && (
        <div className="grid gap-3 border-t border-slate-200 bg-slate-50/70 p-4 sm:grid-cols-[minmax(10rem,.8fr)_minmax(0,1fr)_8rem_auto] sm:items-end">
          <input type="search" value={newQuery} onChange={(e) => setNewQuery(e.target.value)} className="input input-sm" placeholder="Pesquisar recurso..." />
          <select value={newRefId} onChange={(e) => setNewRefId(e.target.value)} className="input input-sm flex-1">
            <option value="">— escolher recurso —</option>
            {available.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
            {available.length === 0 && <option disabled>Nenhum resultado</option>}
          </select>
          <input type="number" step="0.01" placeholder={unitLabel} value={newQty} onChange={(e) => setNewQty(e.target.value)} className="input input-sm w-full" />
          <button onClick={addLine} type="button" className="btn btn-secondary btn-sm w-full sm:w-auto">
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
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { confirm, dialog } = useConfirmDialog();
  const [detail, setDetail] = useState<CostCompositionDetail | null>(null);
  const [labourCategories, setLabourCategories] = useState<LabourCategory[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [measurementCriteria, setMeasurementCriteria] = useState("");
  const [executionNotes, setExecutionNotes] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [sourceReference, setSourceReference] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [labourLines, setLabourLines] = useState<EditableLine[]>([]);
  const [materialLines, setMaterialLines] = useState<EditableLine[]>([]);
  const [equipmentLines, setEquipmentLines] = useState<EditableLine[]>([]);
  const [labourFallback, setLabourFallback] = useState<Map<string, { name: string; unitCost: number }>>(new Map());
  const [materialFallback, setMaterialFallback] = useState<Map<string, { name: string; unitCost: number }>>(new Map());
  const [equipmentFallback, setEquipmentFallback] = useState<Map<string, { name: string; unitCost: number }>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [forking, setForking] = useState(false);

  function flash(text: string) {
    setMessage(text);
    window.setTimeout(() => setMessage((current) => (current === text ? null : current)), 7000);
  }

  useEffect(() => {
    const flashText = (location.state as CompositionLocationState | null)?.flash;
    if (!flashText) return;
    flash(flashText);
    navigate(location.pathname + location.search, { replace: true, state: {} });
  }, [location.state, location.pathname, location.search, navigate]);
  const [showShare, setShowShare] = useState(false);
  const [shareEmail, setShareEmail] = useState("");
  const [sharePermission, setSharePermission] = useState<"view" | "edit">("view");
  const [shares, setShares] = useState<Array<{ userId: string; permission: "view" | "edit"; email: string; name: string }>>([]);
  const [supplierSummaryByMaterial, setSupplierSummaryByMaterial] = useState<Map<string, SupplierSummary>>(new Map());
  const [supplierSummaryByLabour, setSupplierSummaryByLabour] = useState<Map<string, SupplierSummary>>(new Map());
  const [supplierSummaryByEquipment, setSupplierSummaryByEquipment] = useState<Map<string, SupplierSummary>>(new Map());
  const [resourceTab, setResourceTab] = useState<ResourceTab>("materials");

  async function reload(loadId: string) {
    const [d, lc, m, eq] = await Promise.all([
      catalogApi.getComposition(loadId),
      catalogApi.listLabourCategories(),
      catalogApi.listMaterials(),
      catalogApi.listEquipment(),
    ]);
    setDetail(d);
    setCode(d.code ?? "");
    setName(d.name);
    setCategory(d.category);
    setDescription(d.description ?? "");
    setMeasurementCriteria(d.measurementCriteria ?? "");
    setExecutionNotes(d.executionNotes ?? "");
    setSourceName(d.sourceName ?? "");
    setSourceReference(d.sourceReference ?? "");
    setIsActive(d.isActive);
    setLabourLines(d.labourLines.map((l) => ({ refId: l.refId, qtyPerUnit: Number(l.qtyPerUnit), notes: l.notes })));
    setMaterialLines(d.materialLines.map((l) => ({ refId: l.refId, qtyPerUnit: Number(l.qtyPerUnit), wastePct: Number(l.wastePct ?? 0), notes: l.notes })));
    setEquipmentLines(d.equipmentLines.map((l) => ({ refId: l.refId, qtyPerUnit: Number(l.qtyPerUnit), notes: l.notes })));
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

  // Guardar sempre funciona directamente — se a composição ainda não for sua, o backend
  // cria cópia pessoal; navegamos para o novo id e mostramos aviso visível.
  async function handleSave() {
    if (!id || !detail) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const result = await catalogApi.updateComposition(id, {
        code: code.trim() || null,
        name,
        category: category || "Outros",
        description: description.trim() || null,
        measurementCriteria: measurementCriteria.trim() || null,
        executionNotes: executionNotes.trim() || null,
        outputUnit: detail.outputUnit,
        currency: detail.currency,
        sourceName: sourceName.trim() || null,
        sourceReference: sourceReference.trim() || null,
        isActive,
        labourLines,
        materialLines,
        equipmentLines,
      });
      if (result.id !== id) {
        navigate(`/catalogo/composicoes/${result.id}`, {
          replace: true,
          state: {
            flash:
              "Composição actualizada e guardada nas suas composições. Esta passa a ser a sua versão prioritária.",
          } satisfies CompositionLocationState,
        });
      } else {
        await reload(id);
        flash("Composição actualizada. O novo preço unitário já está em uso para novos itens do orçamento.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao guardar");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!id || !detail) return;
    const ok = await confirm({
      title: "Eliminar composição?",
      message: `Eliminar “${detail.name}”?`,
      confirmLabel: "Eliminar",
      danger: true,
      details: ["Itens de orçamento existentes mantêm o preço gravado"],
    });
    if (!ok) return;
    await catalogApi.deleteComposition(id);
    navigate("/catalogo");
  }

  async function handleFork() {
    if (!id) return;
    setError(null);
    setForking(true);
    try {
      const copy = await catalogApi.forkComposition(id);
      navigate(`/catalogo/composicoes/${copy.id}`, {
        state: {
          flash:
            "Composição duplicada com sucesso. Esta cópia é sua — pode editá-la sem afectar o original.",
        } satisfies CompositionLocationState,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao duplicar");
    } finally {
      setForking(false);
    }
  }

  async function openShare() {
    if (!id) return;
    setError(null);
    try {
      const data = await catalogApi.listCompositionShares(id);
      setShares(data.shares);
      setShowShare(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao abrir partilha");
    }
  }

  async function handleShare(e: FormEvent) {
    e.preventDefault();
    if (!id) return;
    setError(null);
    try {
      await catalogApi.shareComposition(id, { email: shareEmail.trim(), permission: sharePermission });
      setShareEmail("");
      const data = await catalogApi.listCompositionShares(id);
      setShares(data.shares);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao partilhar");
    }
  }

  if (!detail) {
    return (
      <Layout title="Composição">
        <div className="mx-auto w-full max-w-6xl space-y-5">
          {error && <AlertBanner tone="error" onDismiss={() => setError(null)}>{error}</AlertBanner>}
          {message && <AlertBanner tone="success" onDismiss={() => setMessage(null)}>{message}</AlertBanner>}
          <LoadingState fullScreen label="A carregar composição..." />
        </div>
      </Layout>
    );
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
    return s + l.qtyPerUnit * (1 + Number(l.wastePct ?? 0) / 100) * cost;
  }, 0);
  const equipmentCost = equipmentLines.reduce(
    (s, l) => s + l.qtyPerUnit * Number(equipment.find((o) => o.id === l.refId)?.hourlyCost ?? equipmentFallback.get(l.refId)?.unitCost ?? 0),
    0
  );
  const directCost = labourCost + materialCost + equipmentCost;
  const unitCost = directCost;

  return (
    <Layout
      title={detail.name}
      subtitle={`${detail.visibility === "private" ? "Minha" : detail.visibility === "shared" ? "Partilhada" : detail.visibility === "global" ? "SIGO" : "Empresa"} · ${detail.category} · v${detail.version} · por ${detail.outputUnit}`}
      actions={
        <>
          <span className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold tabular-nums text-slate-900">{money(unitCost)} MZN/{detail.outputUnit}</span>
          <button type="button" onClick={() => void handleFork()} disabled={forking} className="btn btn-secondary btn-sm">
            {forking ? "A duplicar..." : "Duplicar"}
          </button>
          {detail.ownerUserId === user?.id && (
            <button type="button" onClick={() => void openShare()} className="btn btn-secondary btn-sm">Partilhar</button>
          )}
          <button onClick={handleSave} disabled={saving} className="btn btn-primary btn-sm">{saving ? "A guardar..." : "Guardar"}</button>
        </>
      }
    >
      <div className="mx-auto w-full max-w-6xl space-y-5">
        <div className="space-y-5 min-w-0">
          <Link to="/catalogo" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline"><IconBack className="h-3.5 w-3.5" /> Voltar ao catálogo</Link>
          {error && <AlertBanner tone="error" onDismiss={() => setError(null)}>{error}</AlertBanner>}
          {message && <AlertBanner tone="success" onDismiss={() => setMessage(null)}>{message}</AlertBanner>}

          <section className="card grid overflow-hidden grid-cols-2 lg:grid-cols-4">
            {[["Materiais", materialCost], ["Mão-de-obra", labourCost], ["Equipamento", equipmentCost], ["Custo directo", directCost]].map(([label, value], index) => <div key={String(label)} className={`p-4 ${index === 1 || index === 3 ? "border-l" : ""} ${index === 2 ? "border-t lg:border-l lg:border-t-0" : index === 3 ? "border-t lg:border-t-0" : ""} border-slate-200`}><span className="text-xs text-slate-500">{label}</span><strong className={`mt-1 block tabular-nums ${index === 3 ? "text-xl text-brand-800" : "text-base text-slate-950"}`}>{money(Number(value))} MZN</strong></div>)}
          </section>

          <div className="workspace-tabs">
            {([
              ["materials", "Materiais", materialLines.length, materialCost],
              ["labour", "Mão-de-obra", labourLines.length, labourCost],
              ["equipment", "Equipamento", equipmentLines.length, equipmentCost],
            ] as const).map(([value, label, count, cost]) => (
              <button key={value} type="button" onClick={() => setResourceTab(value)} className={`workspace-tab ${resourceTab === value ? "workspace-tab-active" : ""}`}>
                {label} <span className="ml-1 text-xs opacity-70">{count} · {money(cost)}</span>
              </button>
            ))}
          </div>

          {resourceTab === "materials" && <LineEditor title="Materiais" unitLabel={`consumo / ${detail.outputUnit}`} lines={materialLines} setLines={setMaterialLines} options={materials.filter((item) => item.isActive)} optionCost={(refId) => { const mat = materials.find((o) => o.id === refId); return Number(mat?.baseUnitCost ?? 0) * Number(mat?.importFactor ?? 1); }} fallback={materialFallback} hint={(refId) => { const mat = materials.find((o) => o.id === refId); return [mat?.specification, formatSupplierHint(supplierSummaryByMaterial, refId)].filter(Boolean).join(" · ") || null; }} supportsWaste optionDefaultWaste={(refId) => Number(materials.find((o) => o.id === refId)?.defaultWastePct ?? 0)} />}
          {resourceTab === "labour" && <LineEditor title="Mão-de-obra" unitLabel={`h / ${detail.outputUnit}`} lines={labourLines} setLines={setLabourLines} options={labourCategories.filter((item) => item.isActive)} optionCost={(refId) => Number(labourCategories.find((o) => o.id === refId)?.hourlyRate ?? 0)} fallback={labourFallback} hint={(refId) => formatSupplierHint(supplierSummaryByLabour, refId)} />}
          {resourceTab === "equipment" && <LineEditor title="Equipamento" unitLabel={`h / ${detail.outputUnit}`} lines={equipmentLines} setLines={setEquipmentLines} options={equipment} optionCost={(refId) => Number(equipment.find((o) => o.id === refId)?.hourlyCost ?? 0)} fallback={equipmentFallback} hint={(refId) => formatSupplierHint(supplierSummaryByEquipment, refId)} />}

          <details className="card overflow-hidden">
            <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-slate-800">Dados da composição</summary>
            <div className="grid gap-3 border-t border-slate-200 p-5 lg:grid-cols-2">
              <div className="lg:col-span-2"><label className="label">Nome</label><input value={name} onChange={(e) => setName(e.target.value)} className="input" /></div>
              <div><label className="label">Código</label><input value={code} onChange={(e) => setCode(e.target.value)} className="input" placeholder="Opcional" /></div>
              <div><label className="label">Categoria</label><input value={category} onChange={(e) => setCategory(e.target.value)} className="input" /></div>
              <div className="lg:col-span-2"><label className="label">Descrição resumida</label><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="input text-sm" /></div>
              <div><label className="label">Como medir</label><textarea value={measurementCriteria} onChange={(e) => setMeasurementCriteria(e.target.value)} rows={2} className="input text-sm" /></div>
              <div><label className="label">Notas de execução</label><textarea value={executionNotes} onChange={(e) => setExecutionNotes(e.target.value)} rows={2} className="input text-sm" /></div>
              <div><label className="label">Fonte</label><input value={sourceName} onChange={(e) => setSourceName(e.target.value)} className="input" /></div>
              <div><label className="label">Referência</label><input value={sourceReference} onChange={(e) => setSourceReference(e.target.value)} className="input" /></div>
              <label className="flex items-center gap-2 text-sm text-slate-700 lg:col-span-2"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Disponível para novos orçamentos</label>
            </div>
          </details>

          <details className="card overflow-hidden">
            <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-slate-800">Cálculo avançado e subcomposições</summary>
            <div className="border-t border-slate-200">
              <CompositionTechnicalV2Panel
                compositionId={detail.id}
                onChanged={() => void reload(detail.id)}
                onCompositionIdChange={(nextId) =>
                  navigate(`/catalogo/composicoes/${nextId}`, {
                    replace: true,
                    state: {
                      flash:
                        "Composição actualizada e guardada nas suas composições. Esta passa a ser a sua versão prioritária.",
                    } satisfies CompositionLocationState,
                  })
                }
              />
            </div>
          </details>
          <div className="flex justify-end">
            <button onClick={handleDelete} className="btn btn-ghost btn-sm text-red-600 hover:bg-red-50"><IconTrash className="h-3.5 w-3.5" /> Eliminar composição</button>
          </div>
        </div>

      </div>
      {showShare && (
        <Modal title="Partilhar" onClose={() => setShowShare(false)}>
          <form onSubmit={handleShare} className="space-y-3">
            <input className="input" type="email" required placeholder="email" value={shareEmail} onChange={(e) => setShareEmail(e.target.value)} />
            <select className="input" value={sharePermission} onChange={(e) => setSharePermission(e.target.value as "view" | "edit")}>
              <option value="view">Ver</option>
              <option value="edit">Editar</option>
            </select>
            <button type="submit" className="btn btn-primary w-full">Partilhar</button>
          </form>
          <ul className="mt-4 space-y-2 text-sm">
            {shares.map((share) => (
              <li key={share.userId} className="flex items-center justify-between gap-2">
                <span>{share.name} · {share.permission === "edit" ? "Editar" : "Ver"}</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={async () => {
                  if (!id) return;
                  await catalogApi.revokeCompositionShare(id, share.userId);
                  setShares((current) => current.filter((row) => row.userId !== share.userId));
                }}>Revogar</button>
              </li>
            ))}
          </ul>
        </Modal>
      )}
      {dialog}
    </Layout>
  );
}

import { Fragment, useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { catalogApi, type LabourCategory, type LabourCategoryInput, type Material, type MaterialInput, type CostComposition, type PriceZone, type PriceZoneInput } from "../api/catalog";
import { useAuth } from "../auth/AuthContext";
import EditablePrice from "../components/EditablePrice";
import MaterialPackageEditor from "../components/MaterialPackageEditor";
import MaterialPricingModal from "../components/MaterialPricingModal";
import { LabourEditor, MaterialEditor, ZoneEditor } from "../components/CatalogEditors";
import Layout from "../components/Layout";
import Modal from "../components/Modal";
import { IconPlus, IconTrash } from "../components/icons";

function money(value: string | number) {
  return Number(value).toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

type Tab = "composicoes" | "mao-de-obra" | "materiais" | "zonas";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "composicoes", label: "Composições de custo" },
  { id: "mao-de-obra", label: "Mão-de-obra" },
  { id: "materiais", label: "Materiais" },
  { id: "zonas", label: "Zonas de Preço" },
];

function normalize(text: string) {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export default function CatalogPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("composicoes");
  const [labourCategories, setLabourCategories] = useState<LabourCategory[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [compositions, setCompositions] = useState<CostComposition[]>([]);
  const [zones, setZones] = useState<PriceZone[]>([]);
  const [compositionQuery, setCompositionQuery] = useState("");
  const [labourQuery, setLabourQuery] = useState("");
  const [materialQuery, setMaterialQuery] = useState("");
  const [newCompositionName, setNewCompositionName] = useState("");
  const [newCompositionCategory, setNewCompositionCategory] = useState("");
  const [newCompositionUnit, setNewCompositionUnit] = useState("m3");
  const [showCompositionForm, setShowCompositionForm] = useState(false);
  const [labourEditor, setLabourEditor] = useState<{ item: LabourCategory | null } | null>(null);
  const [materialEditor, setMaterialEditor] = useState<{ item: Material | null } | null>(null);
  const [zoneEditor, setZoneEditor] = useState<{ item: PriceZone | null } | null>(null);
  const [pricingModalMaterial, setPricingModalMaterial] = useState<Material | null>(null);
  const [viewZoneId, setViewZoneId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function isOwn(companyId: string | null) {
    if (!user) return false;
    if (user.role === "super_admin") return companyId === null;
    return companyId === user.companyId;
  }

  function flash(text: string) {
    setMessage(text);
    setTimeout(() => setMessage((current) => (current === text ? null : current)), 2500);
  }

  async function reload(zoneId = viewZoneId) {
    const [lc, m, c, z] = await Promise.all([
      catalogApi.listLabourCategories(),
      catalogApi.listMaterials(zoneId || undefined),
      catalogApi.listCompositions(zoneId || undefined),
      catalogApi.listPriceZones(),
    ]);
    setLabourCategories(lc);
    setMaterials(m);
    setCompositions(c);
    setZones(z);
  }

  useEffect(() => {
    reload().catch((err) => setError(err.message));
  }, []);

  async function handleViewZoneChange(zoneId: string) {
    setViewZoneId(zoneId);
    setError(null);
    try {
      const [m, c] = await Promise.all([catalogApi.listMaterials(zoneId || undefined), catalogApi.listCompositions(zoneId || undefined)]);
      setMaterials(m);
      setCompositions(c);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao mudar de zona");
    }
  }

  const categories = useMemo(() => Array.from(new Set(compositions.map((c) => c.category))).sort(), [compositions]);

  const filteredCompositions = useMemo(() => {
    const q = normalize(compositionQuery);
    return compositions.filter((c) => !q || normalize(c.name).includes(q) || normalize(c.category).includes(q));
  }, [compositions, compositionQuery]);

  const groupedCompositions = useMemo(() => {
    const groups = new Map<string, CostComposition[]>();
    for (const c of filteredCompositions) {
      if (!groups.has(c.category)) groups.set(c.category, []);
      groups.get(c.category)!.push(c);
    }
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredCompositions]);

  const filteredLabour = useMemo(() => {
    const q = normalize(labourQuery);
    return labourCategories.filter((l) => !q || normalize(l.name).includes(q));
  }, [labourCategories, labourQuery]);

  const filteredMaterials = useMemo(() => {
    const q = normalize(materialQuery);
    return materials.filter((m) => !q || normalize(`${m.code ?? ""} ${m.name} ${m.category} ${m.specification ?? ""}`).includes(q));
  }, [materials, materialQuery]);

  const catalogueHealth = useMemo(() => {
    const incompleteMaterials = materials.filter((m) => !m.code || !m.specification || !m.priceSourceName || !m.priceDate).length;
    const staleMaterials = materials.filter((m) => m.priceDate && (Date.now() - new Date(m.priceDate).getTime()) / 86_400_000 > 120).length;
    const incompleteLabour = labourCategories.filter((l) => !l.code || !l.sourceName || !l.effectiveDate).length;
    const incompleteCompositions = compositions.filter((c) => !c.isReady || c.qualityScore < 80).length;
    return { incompleteMaterials, staleMaterials, incompleteLabour, incompleteCompositions };
  }, [materials, labourCategories, compositions]);

  async function handleDeleteLabour(id: string, name: string) {
    if (!window.confirm(`Remover a categoria "${name}"? Esta acção não pode ser desfeita.`)) return;
    await catalogApi.deleteLabourCategory(id);
    flash("Categoria removida.");
    await reload();
  }

  async function handleSaveLabourSalary(id: string, monthlySalary: number) {
    await catalogApi.updateLabourCategory(id, { monthlySalary });
    flash("Salário actualizado — o custo/hora foi recalculado.");
    await reload();
  }

  async function handleSaveMaterialPrice(id: string, baseUnitCost: number) {
    // Com uma zona seleccionada para visualização, editar o preço aqui edita o preço DESSA
    // zona (não o preço base) — coerente com o que a coluna está a mostrar nesse momento.
    if (viewZoneId) {
      await handleSaveZonePrice(id, viewZoneId, baseUnitCost);
      return;
    }
    await catalogApi.updateMaterial(id, { baseUnitCost });
    flash("Preço actualizado — todas as composições que usam este material foram recalculadas.");
    await reload();
  }

  async function handleSaveMaterialPackage(id: string, purchasePackageLabel: string | null, purchasePackageQty: number | null) {
    await catalogApi.updateMaterial(id, { purchasePackageLabel, purchasePackageQty });
    flash("Unidade de compra actualizada.");
    await reload();
  }

  async function handleSaveZonePrice(materialId: string, zoneId: string, unitCost: number) {
    const material = materials.find((item) => item.id === materialId);
    await catalogApi.setMaterialZonePrice(materialId, zoneId, {
      unitCost,
      sourceName: material?.zonePriceSourceName ?? null,
      effectiveDate: material?.zonePriceEffectiveDate ?? null,
    });
    flash("Preço por zona actualizado.");
    await reload();
  }

  async function handleDeleteZone(id: string, name: string) {
    if (!window.confirm(`Eliminar a zona "${name}"? Os projectos com esta zona atribuída ficam sem zona. Esta acção não pode ser desfeita.`)) return;
    await catalogApi.deletePriceZone(id);
    flash("Zona eliminada.");
    await reload();
  }

  async function saveLabour(item: LabourCategory | null, data: LabourCategoryInput) {
    setError(null);
    try {
      if (item) await catalogApi.updateLabourCategory(item.id, data);
      else await catalogApi.createLabourCategory(data);
      setLabourEditor(null);
      flash(item ? "Ficha de mão-de-obra actualizada." : "Categoria de mão-de-obra criada.");
      await reload();
    } catch (err) { setError(err instanceof Error ? err.message : "Erro ao guardar mão-de-obra"); }
  }

  async function saveMaterial(item: Material | null, data: MaterialInput) {
    setError(null);
    try {
      if (item) await catalogApi.updateMaterial(item.id, data);
      else await catalogApi.createMaterial(data);
      setMaterialEditor(null);
      flash(item ? "Ficha técnica do material actualizada." : "Material adicionado ao catálogo.");
      await reload();
    } catch (err) { setError(err instanceof Error ? err.message : "Erro ao guardar material"); }
  }

  async function saveZone(item: PriceZone | null, data: PriceZoneInput) {
    setError(null);
    try {
      if (item) await catalogApi.updatePriceZone(item.id, data);
      else await catalogApi.createPriceZone(data);
      setZoneEditor(null);
      flash(item ? "Zona e factores actualizados." : "Zona de preço criada.");
      await reload();
    } catch (err) { setError(err instanceof Error ? err.message : "Erro ao guardar zona"); }
  }

  async function handleCreateComposition(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const created = await catalogApi.createComposition({
        name: newCompositionName,
        category: newCompositionCategory || "Outros",
        outputUnit: newCompositionUnit,
        currency: "MZN",
        labourLines: [],
        materialLines: [],
        equipmentLines: [],
      });
      navigate(`/catalogo/composicoes/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar composição");
    }
  }

  return (
    <Layout title="Catálogo de Preços" subtitle="Composições de custo, mão-de-obra e materiais — a base de todos os orçamentos">
      <div className="mx-auto w-full max-w-7xl space-y-5">
        {error && <p className="text-sm text-red-600">{error}</p>}
        {message && <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">{message}</p>}

        <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="grid grid-cols-2 md:grid-cols-4">
              {[
                [catalogueHealth.incompleteCompositions, "composições por validar", "composicoes" as Tab],
                [catalogueHealth.incompleteMaterials, "materiais incompletos", "materiais" as Tab],
                [catalogueHealth.staleMaterials, "preços com +120 dias", "materiais" as Tab],
                [catalogueHealth.incompleteLabour, "custos laborais incompletos", "mao-de-obra" as Tab],
              ].map(([value, label, target], index) => <button key={label as string} onClick={() => setTab(target as Tab)} className={`p-4 text-left hover:bg-slate-50 ${index < 3 ? "border-r border-slate-200" : ""}`}><strong className={`block text-xl tabular-nums ${Number(value) ? "text-amber-700" : "text-emerald-700"}`}>{value}</strong><span className="text-xs text-slate-500">{label}</span></button>)}
          </div>
        </section>

        {/* Separadores */}
        <div className="workspace-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`workspace-tab ${tab === t.id ? "workspace-tab-active" : ""}`}
            >
              {t.label}
              <span className="ml-1.5 rounded-full bg-slate-200/70 px-1.5 py-0.5 text-[10px] text-slate-600">
                (
                {t.id === "composicoes"
                  ? compositions.length
                  : t.id === "mao-de-obra"
                    ? labourCategories.length
                    : t.id === "materiais"
                      ? materials.length
                      : zones.length}
                )
              </span>
            </button>
          ))}
        </div>

        {(tab === "composicoes" || tab === "materiais") && (
          <div className="toolbar !items-center !py-3">
            <label className="text-xs text-gray-500 font-medium">A ver preços da zona:</label>
            <select value={viewZoneId} onChange={(e) => handleViewZoneChange(e.target.value)} className="input input-sm w-auto">
              <option value="">Preço base (sem zona)</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
            {viewZoneId && (
              <span className="text-xs text-gray-400">
                {tab === "materiais" ? "Preços editáveis já são desta zona." : "Preço unitário já reflecte esta zona."}
              </span>
            )}
          </div>
        )}

        {tab === "composicoes" && (
          <section className="card overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 space-y-3 bg-slate-50/60">
              <p className="text-xs leading-5 text-gray-500 max-w-lg">Abra uma composição para rever recursos, rendimentos e preço unitário.</p>
              <div className="flex flex-wrap items-end gap-3 justify-between border-t border-slate-200 pt-3">
                <input
                  type="search"
                  placeholder="Pesquisar composição por nome ou categoria..."
                  value={compositionQuery}
                  onChange={(e) => setCompositionQuery(e.target.value)}
                  className="input max-w-xs"
                />
                <button type="button" onClick={() => setShowCompositionForm(true)} className="btn btn-primary btn-sm"><IconPlus className="h-3.5 w-3.5" /> Nova composição</button>
                {showCompositionForm && <Modal title="Nova composição" subtitle="Crie a ficha base e adicione os recursos no passo seguinte" onClose={() => setShowCompositionForm(false)}><form onSubmit={handleCreateComposition} className="space-y-4">
                  <div><label className="label">Nome do serviço</label>
                  <input
                    required
                    placeholder="ex: Betão ciclópico"
                    value={newCompositionName}
                    onChange={(e) => setNewCompositionName(e.target.value)}
                    className="input"
                  /></div>
                  <div><label className="label">Categoria</label>
                  <input
                    list="composition-categories"
                    placeholder="categoria"
                    value={newCompositionCategory}
                    onChange={(e) => setNewCompositionCategory(e.target.value)}
                    className="input"
                  /></div>
                  <datalist id="composition-categories">
                    {categories.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                  <div><label className="label">Unidade de saída</label><select value={newCompositionUnit} onChange={(e) => setNewCompositionUnit(e.target.value)} className="input">
                    {["m3", "m2", "m", "ml", "kg", "un", "vg", "h"].map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select></div>
                  <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end"><button type="button" onClick={() => setShowCompositionForm(false)} className="btn btn-secondary">Cancelar</button><button type="submit" className="btn btn-primary">
                    <IconPlus className="w-3.5 h-3.5" />
                    Criar
                  </button></div>
                </form></Modal>}
              </div>
            </div>

            <div className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-x 2xl:grid-cols-3">{filteredCompositions.map((c) => <button key={`mobile-${c.id}`} type="button" onClick={() => navigate(`/catalogo/composicoes/${c.id}`)} className="group block w-full px-4 py-4 text-left hover:bg-blue-50/60"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><span className="font-mono text-[10px] font-semibold text-slate-400">{c.code || "SEM CÓD."}</span><strong className="mt-1 block text-sm text-slate-900 group-hover:text-brand-700">{c.name}</strong><p className="mt-1 text-xs text-slate-500">{c.category} · {c.outputUnit} · revisão {c.version}</p></div><span className={`badge shrink-0 ${c.isReady ? "badge-green" : "badge-yellow"}`}>{c.qualityScore}%</span></div><div className="mt-3 flex items-end justify-between gap-3 border-t border-slate-100 pt-3"><span className="click-hint">Abrir composição →</span><span className="text-right"><strong className="block text-sm tabular-nums">{money(c.unitCost)} {c.currency}</strong><small className="text-[10px] text-slate-500">por {c.outputUnit}</small></span></div></button>)}</div>
            <div className="hidden">
              <table className="w-full text-sm min-w-[860px]">
                <thead>
                  <tr className="table-head-row">
                    <th className="py-2.5 px-5 font-medium">Código e serviço</th>
                    <th className="font-medium">Un</th>
                    <th className="text-right font-medium">Mão-de-obra</th>
                    <th className="text-right font-medium">Materiais</th>
                    <th className="text-right font-medium">Máquinas</th>
                    <th className="text-center font-medium">Validação</th>
                    <th className="text-right font-medium pr-5">Preço unitário</th>
                  </tr>
                </thead>
                <tbody>
                  {groupedCompositions.map(([category, items]) => (
                    <Fragment key={category}>
                      <tr>
                        <td colSpan={7} className="px-5 pt-4 pb-1 text-xs font-semibold uppercase tracking-wider text-brand-700 bg-brand-50/60">
                          {category}
                        </td>
                      </tr>
                      {items.map((c) => (
                        <tr key={c.id} className="table-row cursor-pointer" onClick={() => navigate(`/catalogo/composicoes/${c.id}`)}>
                          <td className="py-2 px-5">
                            <span className="mr-2 font-mono text-[11px] text-slate-400">{c.code || "SEM CÓD."}</span><span className="text-brand-800 font-medium">{c.name}</span>
                            {c.companyId === null && <span className="badge badge-gray ml-2">catálogo base</span>}
                            <p className="mt-0.5 text-[11px] text-slate-400">revisão {c.version} · custo directo {money(c.directCost)} {c.currency}</p>
                          </td>
                          <td className="text-gray-500">{c.outputUnit}</td>
                          <td className="text-right tabular-nums text-gray-600">{money(c.labourCost)}</td>
                          <td className="text-right tabular-nums text-gray-600">{money(c.materialCost)}</td>
                          <td className="text-right tabular-nums text-gray-600">{money(c.equipmentCost)}</td>
                          <td className="text-center"><span title={c.qualityWarnings.join("\n")} className={`badge ${c.isReady ? "badge-green" : "badge-yellow"}`}>{c.qualityScore}% · {c.isReady ? "pronta" : "rever"}</span></td>
                          <td className="text-right tabular-nums font-semibold text-gray-900 pr-5">
                            {money(c.unitCost)} <span className="text-xs text-gray-400">{c.currency}</span><span className="ml-2 text-brand-700" aria-hidden="true">→</span>
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                  {filteredCompositions.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-gray-400">
                        Nenhuma composição corresponde à pesquisa.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {tab === "mao-de-obra" && (
          <section className="card">
            <div className="px-5 pt-4 pb-3 border-b border-gray-100 space-y-3">
              <p className="text-xs leading-5 text-gray-500 max-w-2xl">Custo por hora, encargos e fonte de cada categoria profissional.</p>
              <div className="flex flex-wrap items-end gap-3 justify-between">
                <input
                  type="search"
                  placeholder="Pesquisar categoria..."
                  value={labourQuery}
                  onChange={(e) => setLabourQuery(e.target.value)}
                  className="input max-w-xs"
                />
                <button type="button" onClick={() => setLabourEditor({ item: null })} className="btn btn-primary btn-sm"><IconPlus className="w-3.5 h-3.5" /> Nova categoria</button>
              </div>
            </div>
            <div className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-x 2xl:grid-cols-3">{filteredLabour.map((lc) => <article key={`mobile-${lc.id}`} className="p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><span className="font-mono text-[10px] text-slate-400">{lc.code || "SEM CÓD."}</span><strong className="mt-1 block text-sm text-slate-900">{lc.name}</strong><p className="mt-1 text-xs text-slate-500">{lc.sourceName || "Fonte por definir"}</p></div><span className="text-right"><strong className="block text-sm tabular-nums">{money(lc.hourlyRate)} {lc.currency}/h</strong><small className="text-[10px] text-slate-500">encargos {money(Number(lc.socialChargesPct) + Number(lc.complementaryCostsPct))}%</small></span></div><div className="mt-3 flex gap-2 border-t border-slate-100 pt-3"><button onClick={() => setLabourEditor({ item: lc })} className="btn btn-secondary btn-sm flex-1">Editar ficha</button>{isOwn(lc.companyId) && <button onClick={() => handleDeleteLabour(lc.id, lc.name)} className="btn btn-sm border-red-200 bg-white text-red-600">Remover</button>}</div></article>)}</div>
            <div className="hidden"><table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="table-head-row">
                  <th className="py-2.5 px-5 font-medium">Código e categoria</th>
                  <th className="text-right font-medium">Salário/mês</th>
                  <th className="text-right font-medium">Encargos</th>
                  <th className="text-right font-medium">Custo/hora</th>
                  <th className="font-medium">Fonte / vigência</th>
                  <th className="w-36 pr-5"></th>
                </tr>
              </thead>
              <tbody>
                {filteredLabour.map((lc) => (
                  <tr key={lc.id} className="table-row">
                    <td className="py-2 px-5">
                      <span className="mr-2 font-mono text-[11px] text-slate-400">{lc.code || "SEM CÓD."}</span><span className="font-medium text-slate-800">{lc.name}</span>
                      {lc.companyId === null && <span className="badge badge-gray ml-2">catálogo base</span>}
                      {!lc.isActive && <span className="badge badge-yellow ml-2">inactiva</span>}
                    </td>
                    <td className="text-right tabular-nums">
                      <EditablePrice value={lc.monthlySalary} suffix={lc.currency} onSave={(v) => handleSaveLabourSalary(lc.id, v)} />
                    </td>
                    <td className="text-right tabular-nums text-slate-600">{money(Number(lc.socialChargesPct) + Number(lc.complementaryCostsPct))}%</td>
                    <td className="text-right tabular-nums text-gray-600">{money(lc.hourlyRate)} /h</td>
                    <td><p className="text-xs text-slate-700">{lc.sourceName || "Fonte por definir"}</p><p className="text-[11px] text-slate-400">{lc.effectiveDate ? `desde ${new Date(lc.effectiveDate).toLocaleDateString("pt-MZ")}` : "sem data de vigência"}</p></td>
                    <td className="text-right pr-5">
                      <button onClick={() => setLabourEditor({ item: lc })} className="btn btn-secondary btn-sm">Editar</button>
                      {isOwn(lc.companyId) && (
                        <button onClick={() => handleDeleteLabour(lc.id, lc.name)} className="btn btn-ghost btn-sm text-red-600 hover:bg-red-50">
                          remover
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {filteredLabour.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-gray-400">
                      Nenhuma categoria corresponde à pesquisa.
                    </td>
                  </tr>
                )}
              </tbody>
            </table></div>
          </section>
        )}

        {tab === "materiais" && (
          <section className="card">
            <div className="px-5 pt-4 pb-3 border-b border-gray-100 space-y-3">
              <p className="text-xs leading-5 text-gray-500 max-w-3xl">Preço, especificação, perda e unidade de compra de cada material.</p>
              <div className="flex flex-wrap items-center justify-between gap-3"><input type="search" placeholder="Pesquisar por código, material ou categoria..." value={materialQuery} onChange={(e) => setMaterialQuery(e.target.value)} className="input max-w-sm" /><button type="button" onClick={() => setMaterialEditor({ item: null })} className="btn btn-primary btn-sm"><IconPlus className="w-3.5 h-3.5" /> Novo material</button></div>
            </div>
            <div className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-x 2xl:grid-cols-3">{filteredMaterials.map((m) => <article key={`mobile-${m.id}`} className="p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><span className="font-mono text-[10px] text-slate-400">{m.code || "SEM CÓD."}</span><strong className="mt-1 block text-sm text-slate-900">{m.name}</strong><p className="mt-1 text-xs text-slate-500">{m.category} · {m.unit}</p></div><span className="text-right"><strong className="block text-sm tabular-nums">{money(m.effectiveUnitCost)} {m.currency}</strong><small className="text-[10px] text-slate-500">{m.priceBasis === "zone_specific" ? "preço da zona" : "preço base"}</small></span></div>{m.marketPrice && <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-900"><span>Melhor cotação · {m.marketSupplierName}</span><strong className="float-right tabular-nums">{money(m.marketPrice)} {m.marketCurrency}</strong></div>}<div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3"><button onClick={() => setMaterialEditor({ item: m })} className="btn btn-secondary btn-sm">Editar ficha</button><button onClick={() => setPricingModalMaterial(m)} className="btn btn-secondary btn-sm">Preços e fornecedores</button>{m.marketPrice && <button type="button" onClick={() => handleSaveMaterialPrice(m.id, Number(m.marketPrice))} className="btn btn-primary btn-sm col-span-2">Adoptar melhor cotação</button>}</div></article>)}</div>
            <div className="hidden">
              <table className="w-full text-sm min-w-[1180px]">
                <thead>
                  <tr className="table-head-row">
                    <th className="py-2.5 px-5 font-medium">Código e material</th>
                    <th className="font-medium">Un</th>
                    <th className="text-right font-medium">Preço aplicado</th>
                    <th className="text-left font-medium">Melhor cotação</th>
                    <th className="text-right font-medium">Perda</th>
                    <th className="text-left font-medium">Fonte / data</th>
                    <th className="text-left font-medium">Unidade de compra</th>
                    <th className="text-right font-medium pr-5">Acções</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMaterials.map((m) => (
                    <tr key={m.id} className="table-row">
                      <td className="py-2 px-5">
                        <span className="mr-2 font-mono text-[11px] text-slate-400">{m.code || "SEM CÓD."}</span><span className="font-medium text-slate-800">{m.name}</span>
                        {m.companyId === null && <span className="badge badge-gray ml-2">catálogo base</span>}
                        {!m.isActive && <span className="badge badge-yellow ml-2">inactivo</span>}
                        <p className="mt-0.5 max-w-sm truncate text-[11px] text-slate-400">{m.category}{m.specification ? ` · ${m.specification}` : " · especificação em falta"}</p>
                      </td>
                      <td className="text-gray-500">{m.unit}</td>
                      <td className="text-right tabular-nums">
                        <EditablePrice value={m.priceBasis === "zone_specific" ? m.zonePrice! : m.baseUnitCost} suffix={m.currency} onSave={(v) => handleSaveMaterialPrice(m.id, v)} />
                        <p className="text-[11px] text-slate-400">efectivo {money(m.effectiveUnitCost)} · {m.priceBasis === "zone_specific" ? "preço da zona" : m.priceBasis === "zone_adjusted_base" ? "base + factores da zona" : Number(m.importFactor) !== 1 ? `factor ${money(m.importFactor)}×` : "preço base"}</p>
                      </td>
                      <td>
                        {m.marketPrice ? (
                          <div className="flex items-center gap-2">
                            <div><p className="font-medium text-slate-800 tabular-nums">{money(m.marketPrice)} {m.marketCurrency}</p><p className="text-[11px] text-slate-500">{m.marketSupplierName} · {m.marketPriceIsZoneSpecific ? "nesta zona" : "preço geral"}</p></div>
                            <button type="button" onClick={() => handleSaveMaterialPrice(m.id, Number(m.marketPrice))} className="btn btn-secondary btn-sm">Adoptar</button>
                          </div>
                        ) : <span className="text-xs text-slate-400">Sem cotação</span>}
                      </td>
                      <td className="text-right tabular-nums text-gray-600">{money(m.defaultWastePct)}%</td>
                      <td><p className="text-xs text-slate-700">{m.zonePriceSourceName || m.priceSourceName || "Fonte por definir"}</p><p className="text-[11px] text-slate-400">{(m.zonePriceEffectiveDate || m.priceDate) ? new Date((m.zonePriceEffectiveDate || m.priceDate)!).toLocaleDateString("pt-MZ") : "sem data"}{m.includesVat ? " · inclui IVA" : " · IVA não indicado"}</p></td>
                      <td>
                        <MaterialPackageEditor
                          label={m.purchasePackageLabel}
                          qty={m.purchasePackageQty}
                          onSave={(label, qty) => handleSaveMaterialPackage(m.id, label, qty)}
                        />
                        {m.purchasePackageLabel && m.purchasePackageQty && (
                          <span className="text-gray-400 ml-1">({money(m.purchasePackageQty)} {m.unit})</span>
                        )}
                      </td>
                      <td className="text-right pr-5">
                        <button onClick={() => setMaterialEditor({ item: m })} className="btn btn-secondary btn-sm">Editar</button><button onClick={() => setPricingModalMaterial(m)} className="btn btn-secondary btn-sm">Preços</button>
                      </td>
                    </tr>
                  ))}
                  {filteredMaterials.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-gray-400">
                        Nenhum material corresponde à pesquisa.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {pricingModalMaterial && (
          <MaterialPricingModal
            material={pricingModalMaterial}
            onClose={() => setPricingModalMaterial(null)}
            onChanged={() => reload()}
          />
        )}

        {tab === "zonas" && (
          <section className="card">
            <div className="px-5 pt-4 pb-3 border-b border-gray-100 space-y-3">
              <p className="text-xs leading-5 text-gray-500 max-w-3xl">Ajuste materiais, transporte, mão-de-obra e equipamento ao contexto local da obra.</p>
              <button type="button" onClick={() => setZoneEditor({ item: null })} className="btn btn-primary btn-sm"><IconPlus className="w-3.5 h-3.5" /> Nova zona</button>
            </div>
            <div className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-x 2xl:grid-cols-3">{zones.map((z) => <article key={`mobile-${z.id}`} className="p-4"><div className="flex items-start justify-between gap-3"><div><strong className="text-sm text-slate-900">{z.name}</strong><p className="mt-1 text-xs text-slate-500">{[z.district, z.province].filter(Boolean).join(", ") || "Localização por definir"}</p></div><span className="badge badge-gray">Zona</span></div><dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg bg-slate-50 p-3 text-xs"><div className="flex justify-between gap-2"><dt className="text-slate-500">Materiais</dt><dd className="font-semibold">{Number(z.materialAdjustmentPct) >= 0 ? "+" : ""}{money(z.materialAdjustmentPct)}%</dd></div><div className="flex justify-between gap-2"><dt className="text-slate-500">Transporte</dt><dd className="font-semibold">+{money(z.defaultTransportPct)}%</dd></div><div className="flex justify-between gap-2"><dt className="text-slate-500">Mão-de-obra</dt><dd className="font-semibold">{Number(z.labourAdjustmentPct) >= 0 ? "+" : ""}{money(z.labourAdjustmentPct)}%</dd></div><div className="flex justify-between gap-2"><dt className="text-slate-500">Equipamento</dt><dd className="font-semibold">{Number(z.equipmentAdjustmentPct) >= 0 ? "+" : ""}{money(z.equipmentAdjustmentPct)}%</dd></div></dl><div className="mt-3 flex gap-2"><button onClick={() => setZoneEditor({ item: z })} className="btn btn-secondary btn-sm flex-1">Configurar zona</button><button onClick={() => handleDeleteZone(z.id, z.name)} className="btn btn-sm border-red-200 bg-white text-red-600">Remover</button></div></article>)}</div>
            <div className="hidden"><table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="table-head-row">
                  <th className="py-2.5 px-5 font-medium">Zona e localização</th>
                  <th className="text-right font-medium">Materiais</th><th className="text-right font-medium">Transporte</th><th className="text-right font-medium">Mão-de-obra</th><th className="text-right font-medium">Equipamento</th>
                  <th className="font-medium">Fonte / vigência</th><th className="w-40 pr-5"></th>
                </tr>
              </thead>
              <tbody>
                {zones.map((z) => (
                  <tr key={z.id} className="table-row">
                    <td className="py-2 px-5">
                      <span className="font-medium text-slate-800">{z.name}</span>
                      {z.companyId === null && <span className="badge badge-gray ml-2">catálogo base</span>}
                      <p className="text-[11px] text-slate-400">{[z.district, z.province].filter(Boolean).join(", ") || "localização por definir"}</p>
                    </td>
                    <td className="text-right tabular-nums">{Number(z.materialAdjustmentPct) >= 0 ? "+" : ""}{money(z.materialAdjustmentPct)}%</td><td className="text-right tabular-nums">+{money(z.defaultTransportPct)}%</td><td className="text-right tabular-nums">{Number(z.labourAdjustmentPct) >= 0 ? "+" : ""}{money(z.labourAdjustmentPct)}%</td><td className="text-right tabular-nums">{Number(z.equipmentAdjustmentPct) >= 0 ? "+" : ""}{money(z.equipmentAdjustmentPct)}%</td>
                    <td><p className="text-xs text-slate-700">{z.sourceName || "Fonte por definir"}</p><p className="text-[11px] text-slate-400">{z.effectiveDate ? `desde ${new Date(z.effectiveDate).toLocaleDateString("pt-MZ")}` : "sem data de vigência"}</p></td>
                    <td className="text-right pr-5">
                      <button onClick={() => setZoneEditor({ item: z })} className="btn btn-secondary btn-sm">Configurar</button>
                      <button onClick={() => handleDeleteZone(z.id, z.name)} className="btn btn-ghost btn-sm text-red-600 hover:bg-red-50">
                        remover
                      </button>
                    </td>
                  </tr>
                ))}
                {zones.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-gray-400">
                      Ainda não há zonas de preço — crie a primeira acima.
                    </td>
                  </tr>
                )}
              </tbody>
            </table></div>
          </section>
        )}
        {labourEditor && <LabourEditor item={labourEditor.item} onClose={() => setLabourEditor(null)} onSave={(data) => saveLabour(labourEditor.item, data)} />}
        {materialEditor && <MaterialEditor item={materialEditor.item} onClose={() => setMaterialEditor(null)} onSave={(data) => saveMaterial(materialEditor.item, data)} />}
        {zoneEditor && <ZoneEditor item={zoneEditor.item} onClose={() => setZoneEditor(null)} onSave={(data) => saveZone(zoneEditor.item, data)} />}
      </div>
    </Layout>
  );
}

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { catalogApi, type LabourCategory, type LabourCategoryInput, type Material, type MaterialInput, type CostComposition } from "../api/catalog";
import { useAuth } from "../auth/AuthContext";
import MaterialPricingModal from "../components/MaterialPricingModal";
import { LabourEditor, MaterialEditor } from "../components/CatalogEditors";
import Layout from "../components/Layout";
import Modal from "../components/Modal";
import AlertBanner from "../components/AlertBanner";
import LoadingState from "../components/LoadingState";
import { useConfirmDialog } from "../hooks/useConfirmDialog";
import { IconPlus, IconTrash } from "../components/icons";
import WorkChapterLibrary from "../components/WorkChapterLibrary";

function money(value: string | number) {
  return Number(value).toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type Tab = "composicoes" | "capitulos" | "mao-de-obra" | "materiais";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "composicoes", label: "Composições" },
  { id: "materiais", label: "Materiais" },
  { id: "mao-de-obra", label: "Mão-de-obra" },
  { id: "capitulos", label: "Capítulos" },
];

function normalize(text: string) {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export default function CatalogPage() {
  const { user } = useAuth();
  const { confirm, dialog } = useConfirmDialog();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("composicoes");
  const [labourCategories, setLabourCategories] = useState<LabourCategory[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [compositions, setCompositions] = useState<CostComposition[]>([]);
  const [chapterCount, setChapterCount] = useState(0);
  const [compositionQuery, setCompositionQuery] = useState("");
  const [labourQuery, setLabourQuery] = useState("");
  const [materialQuery, setMaterialQuery] = useState("");
  const [newCompositionName, setNewCompositionName] = useState("");
  const [newCompositionCategory, setNewCompositionCategory] = useState("");
  const [newCompositionUnit, setNewCompositionUnit] = useState("m3");
  const [showCompositionForm, setShowCompositionForm] = useState(false);
  const [labourEditor, setLabourEditor] = useState<{ item: LabourCategory | null } | null>(null);
  const [materialEditor, setMaterialEditor] = useState<{ item: Material | null } | null>(null);
  const [pricingModalMaterial, setPricingModalMaterial] = useState<Material | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function isOwn(companyId: string | null) {
    if (!user) return false;
    if (user.role === "super_admin") return companyId === null;
    return companyId === user.companyId;
  }

  function flash(text: string) {
    setMessage(text);
    setTimeout(() => setMessage((current) => (current === text ? null : current)), 2500);
  }

  async function reload() {
    const [lc, m, c] = await Promise.all([
      catalogApi.listLabourCategories(),
      catalogApi.listMaterials(),
      catalogApi.listCompositions(),
    ]);
    setLabourCategories(lc);
    setMaterials(m);
    setCompositions(c);
    setLoading(false);
  }

  useEffect(() => {
    reload().catch((err) => { setError(err.message); setLoading(false); });
  }, []);

  const categories = useMemo(() => Array.from(new Set(compositions.map((c) => c.category))).sort(), [compositions]);

  const filteredCompositions = useMemo(() => {
    const q = normalize(compositionQuery);
    return compositions.filter((c) => !q || normalize(c.name).includes(q) || normalize(c.category).includes(q));
  }, [compositions, compositionQuery]);

  const filteredLabour = useMemo(() => {
    const q = normalize(labourQuery);
    return labourCategories.filter((l) => !q || normalize(l.name).includes(q));
  }, [labourCategories, labourQuery]);

  const filteredMaterials = useMemo(() => {
    const q = normalize(materialQuery);
    return materials.filter((m) => !q || normalize(`${m.code ?? ""} ${m.name} ${m.category} ${m.specification ?? ""}`).includes(q));
  }, [materials, materialQuery]);

  const materialGroups = useMemo(() => {
    const map = new Map<string, Material[]>();
    for (const m of filteredMaterials) {
      const key = (m.category || "Outros").trim() || "Outros";
      const list = map.get(key) ?? [];
      list.push(m);
      map.set(key, list);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b, "pt"))
      .map(([category, items]) => ({
        category,
        items: items.slice().sort((a, b) => a.name.localeCompare(b.name, "pt")),
      }));
  }, [filteredMaterials]);

  const [collapsedMaterialGroups, setCollapsedMaterialGroups] = useState<Record<string, boolean>>({});

  function toggleMaterialGroup(category: string) {
    setCollapsedMaterialGroups((prev) => ({ ...prev, [category]: prev[category] === false }));
  }

  async function handleDeleteLabour(id: string, name: string) {
    const ok = await confirm({ title: "Remover categoria?", message: `Remover “${name}”?`, confirmLabel: "Remover", danger: true });
    if (!ok) return;
    await catalogApi.deleteLabourCategory(id);
    flash("Categoria removida.");
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
    <Layout title="Catálogo de Preços">
      <div className="mx-auto w-full max-w-7xl space-y-5">
        {error && <AlertBanner tone="error" onDismiss={() => setError(null)}>{error}</AlertBanner>}
        {message && <AlertBanner tone="success" onDismiss={() => setMessage(null)}>{message}</AlertBanner>}

        {loading ? (
          <LoadingState skeleton />
        ) : (
          <>
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
                {t.id === "composicoes"
                  ? compositions.length
                  : t.id === "capitulos"
                    ? chapterCount
                  : t.id === "mao-de-obra"
                    ? labourCategories.length
                    : materials.length}
              </span>
            </button>
          ))}
        </div>

        {tab === "composicoes" && (
          <section className="card overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 space-y-3 bg-slate-50/60">
              <div className="flex flex-wrap items-center gap-3 justify-between">
                <input
                  type="search"
                  placeholder="Pesquisar composição por nome ou categoria..."
                  value={compositionQuery}
                  onChange={(e) => setCompositionQuery(e.target.value)}
                  className="input max-w-xs"
                />
                <button type="button" onClick={() => setShowCompositionForm(true)} className="btn btn-primary btn-sm"><IconPlus className="h-3.5 w-3.5" /> Nova composição</button>
                {showCompositionForm && <Modal title="Nova composição" onClose={() => setShowCompositionForm(false)}><form onSubmit={handleCreateComposition} className="space-y-4">
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
          </section>
        )}

        {tab === "capitulos" && (
          <WorkChapterLibrary
            compositions={compositions}
            onCount={setChapterCount}
            onError={setError}
            onSaved={flash}
            onCompositionsChanged={() => { reload().catch((err) => setError(err.message)); }}
          />
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
            <div className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-x 2xl:grid-cols-3">{filteredLabour.map((lc) => <article key={`mobile-${lc.id}`} className="p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><span className="font-mono text-[10px] text-slate-400">{lc.code || "SEM CÓD."}</span><strong className="mt-1 block text-sm text-slate-900">{lc.name}</strong><p className="mt-1 text-xs text-slate-500">{lc.sourceName || "Fonte por definir"}</p></div><span className="text-right"><strong className="block text-sm tabular-nums">{money(lc.hourlyRate)} {lc.currency}/h</strong><small className="text-[10px] text-slate-500">encargos {money(Number(lc.socialChargesPct) + Number(lc.complementaryCostsPct))}%</small></span></div><div className="mt-3 flex gap-2 border-t border-slate-100 pt-3"><button onClick={() => setLabourEditor({ item: lc })} className="btn btn-secondary btn-sm flex-1">Editar ficha</button>{isOwn(lc.companyId) && <button onClick={() => handleDeleteLabour(lc.id, lc.name)} className="btn btn-danger btn-sm">Remover</button>}</div></article>)}</div>
          </section>
        )}

        {tab === "materiais" && (
          <section className="card overflow-hidden">
            <div className="space-y-3 border-b border-gray-100 px-5 pb-3 pt-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <input
                  type="search"
                  placeholder="Pesquisar grupo, marca, código ou especificação..."
                  value={materialQuery}
                  onChange={(e) => setMaterialQuery(e.target.value)}
                  className="input max-w-sm"
                />
                <button type="button" onClick={() => setMaterialEditor({ item: null })} className="btn btn-primary btn-sm">
                  <IconPlus className="h-3.5 w-3.5" /> Novo material
                </button>
              </div>
            </div>

            {materialGroups.length === 0 && (
              <p className="p-6 text-center text-sm text-slate-500">
                {materialQuery ? "Nenhum material corresponde à pesquisa." : "Ainda não há materiais no catálogo."}
              </p>
            )}

            {materialGroups.map((group) => {
              const collapsed = materialQuery ? false : (collapsedMaterialGroups[group.category] ?? true);
              return (
                <div key={group.category} className="border-b border-slate-100 last:border-b-0">
                  <button
                    type="button"
                    onClick={() => toggleMaterialGroup(group.category)}
                    className="flex w-full items-center gap-2 bg-slate-50/80 px-5 py-2.5 text-left hover:bg-slate-100/80"
                  >
                    <span className="text-xs text-slate-400">{collapsed ? "▸" : "▾"}</span>
                    <strong className="text-sm text-slate-900">{group.category}</strong>
                    <span className="text-xs text-slate-500">{group.items.length} {group.items.length === 1 ? "material" : "materiais"}</span>
                  </button>
                  {!collapsed && (
                    <div className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-x 2xl:grid-cols-3">
                      {group.items.map((m) => (
                        <article key={m.id} className="p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <span className="font-mono text-[10px] text-slate-400">{m.code || "SEM CÓD."}</span>
                              <strong className="mt-1 block text-sm text-slate-900">{m.name}</strong>
                              <p className="mt-1 truncate text-xs text-slate-500">
                                {m.unit}
                                {m.specification ? ` · ${m.specification}` : ""}
                              </p>
                            </div>
                            <span className="text-right">
                              <strong className="block text-sm tabular-nums">
                                {money(m.effectiveUnitCost)} {m.currency}
                              </strong>
                              <small className="text-[10px] text-slate-500">preço aplicado/{m.unit}</small>
                            </span>
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3">
                            <button type="button" onClick={() => setMaterialEditor({ item: m })} className="btn btn-secondary btn-sm">
                              Editar
                            </button>
                            <button type="button" onClick={() => setPricingModalMaterial(m)} className="btn btn-secondary btn-sm">
                              Cotações
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        )}

        {pricingModalMaterial && (
          <MaterialPricingModal
            material={pricingModalMaterial}
            onClose={() => setPricingModalMaterial(null)}
            onChanged={() => reload()}
          />
        )}

          </>
        )}
        {labourEditor && <LabourEditor item={labourEditor.item} onClose={() => setLabourEditor(null)} onSave={(data) => saveLabour(labourEditor.item, data)} />}
        {materialEditor && <MaterialEditor item={materialEditor.item} onClose={() => setMaterialEditor(null)} onSave={(data) => saveMaterial(materialEditor.item, data)} />}
        {dialog}
      </div>
    </Layout>
  );
}

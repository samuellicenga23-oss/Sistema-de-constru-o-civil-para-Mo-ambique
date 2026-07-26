import { Fragment, useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { catalogApi, type LabourCategory, type Material, type CostComposition, type PriceZone } from "../api/catalog";
import { useAuth } from "../auth/AuthContext";
import EditablePrice from "../components/EditablePrice";
import MaterialPackageEditor from "../components/MaterialPackageEditor";
import MaterialPricingModal from "../components/MaterialPricingModal";
import Layout from "../components/Layout";
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
  const [newLabourName, setNewLabourName] = useState("");
  const [newLabourSalary, setNewLabourSalary] = useState("");
  const [newCompositionName, setNewCompositionName] = useState("");
  const [newCompositionCategory, setNewCompositionCategory] = useState("");
  const [newCompositionUnit, setNewCompositionUnit] = useState("m3");
  const [newZoneName, setNewZoneName] = useState("");
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
    return materials.filter((m) => !q || normalize(m.name).includes(q));
  }, [materials, materialQuery]);

  async function handleAddLabour(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await catalogApi.createLabourCategory({ name: newLabourName, monthlySalary: Number(newLabourSalary) });
      setNewLabourName("");
      setNewLabourSalary("");
      flash("Categoria de mão-de-obra criada.");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar categoria");
    }
  }

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
    await catalogApi.setMaterialZonePrice(materialId, zoneId, unitCost);
    flash("Preço por zona actualizado.");
    await reload();
  }

  async function handleAddZone(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await catalogApi.createPriceZone({ name: newZoneName });
      setNewZoneName("");
      flash("Zona de preço criada.");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar zona");
    }
  }

  async function handleRenameZone(id: string, currentName: string) {
    const name = window.prompt("Novo nome da zona:", currentName);
    if (!name || !name.trim() || name === currentName) return;
    await catalogApi.updatePriceZone(id, { name: name.trim() });
    flash("Zona renomeada.");
    await reload();
  }

  async function handleDeleteZone(id: string, name: string) {
    if (!window.confirm(`Eliminar a zona "${name}"? Os projectos com esta zona atribuída ficam sem zona. Esta acção não pode ser desfeita.`)) return;
    await catalogApi.deletePriceZone(id);
    flash("Zona eliminada.");
    await reload();
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
      <div className="space-y-5 max-w-5xl">
        {error && <p className="text-sm text-red-600">{error}</p>}
        {message && <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">{message}</p>}

        {/* Separadores */}
        <div className="flex gap-1 border-b border-gray-200">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === t.id ? "border-brand-700 text-brand-800" : "border-transparent text-gray-500 hover:text-gray-800"
              }`}
            >
              {t.label}
              <span className="ml-1.5 text-xs text-gray-400">
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
          <div className="flex items-center gap-2 -mt-2">
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
          <section className="card">
            <div className="px-5 pt-4 pb-3 border-b border-gray-100 space-y-3">
              <p className="text-xs text-gray-500 max-w-lg">
                Preço unitário = mão-de-obra + materiais + máquinas por unidade de trabalho. Clique numa composição para
                abrir o editor completo. Qualquer preço pode ser ajustado directamente — a sua empresa fica sempre com a
                sua própria versão, sem afectar as outras empresas.
              </p>
              <div className="flex flex-wrap items-end gap-3 justify-between">
                <input
                  type="search"
                  placeholder="Pesquisar composição por nome ou categoria..."
                  value={compositionQuery}
                  onChange={(e) => setCompositionQuery(e.target.value)}
                  className="input max-w-xs"
                />
                <form onSubmit={handleCreateComposition} className="flex gap-2 items-end flex-wrap">
                  <input
                    required
                    placeholder="ex: Betão ciclópico"
                    value={newCompositionName}
                    onChange={(e) => setNewCompositionName(e.target.value)}
                    className="input input-sm w-44"
                  />
                  <input
                    list="composition-categories"
                    placeholder="categoria"
                    value={newCompositionCategory}
                    onChange={(e) => setNewCompositionCategory(e.target.value)}
                    className="input input-sm w-36"
                  />
                  <datalist id="composition-categories">
                    {categories.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                  <select value={newCompositionUnit} onChange={(e) => setNewCompositionUnit(e.target.value)} className="input input-sm w-auto">
                    {["m3", "m2", "m", "ml", "kg", "un", "vg", "h"].map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                  <button type="submit" className="btn btn-primary btn-sm">
                    <IconPlus className="w-3.5 h-3.5" />
                    Criar
                  </button>
                </form>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="table-head-row">
                    <th className="py-2.5 px-5 font-medium">Tipo de trabalho</th>
                    <th className="font-medium">Un</th>
                    <th className="text-right font-medium">Mão-de-obra</th>
                    <th className="text-right font-medium">Materiais</th>
                    <th className="text-right font-medium">Máquinas</th>
                    <th className="text-right font-medium pr-5">Preço unitário</th>
                  </tr>
                </thead>
                <tbody>
                  {groupedCompositions.map(([category, items]) => (
                    <Fragment key={category}>
                      <tr>
                        <td colSpan={6} className="px-5 pt-4 pb-1 text-xs font-semibold uppercase tracking-wider text-brand-700 bg-brand-50/60">
                          {category}
                        </td>
                      </tr>
                      {items.map((c) => (
                        <tr key={c.id} className="table-row cursor-pointer" onClick={() => navigate(`/catalogo/composicoes/${c.id}`)}>
                          <td className="py-2 px-5">
                            <span className="text-brand-800 font-medium">{c.name}</span>
                            {c.companyId === null && <span className="badge badge-gray ml-2">catálogo base</span>}
                          </td>
                          <td className="text-gray-500">{c.outputUnit}</td>
                          <td className="text-right tabular-nums text-gray-600">{money(c.labourCost)}</td>
                          <td className="text-right tabular-nums text-gray-600">{money(c.materialCost)}</td>
                          <td className="text-right tabular-nums text-gray-600">{money(c.equipmentCost)}</td>
                          <td className="text-right tabular-nums font-semibold text-gray-900 pr-5">
                            {money(c.unitCost)} <span className="text-xs text-gray-400">{c.currency}</span>
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                  {filteredCompositions.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-gray-400">
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
              <p className="text-xs text-gray-500 max-w-lg">
                O custo/hora é calculado a partir do salário mensal e dos dias/horas de trabalho da empresa. Clique num
                salário para o editar directamente — não é preciso clonar nada.
              </p>
              <div className="flex flex-wrap items-end gap-3 justify-between">
                <input
                  type="search"
                  placeholder="Pesquisar categoria..."
                  value={labourQuery}
                  onChange={(e) => setLabourQuery(e.target.value)}
                  className="input max-w-xs"
                />
                <form onSubmit={handleAddLabour} className="flex gap-2 items-end">
                  <input required value={newLabourName} onChange={(e) => setNewLabourName(e.target.value)} className="input input-sm w-36" placeholder="ex: Ladrilhador" />
                  <input required type="number" value={newLabourSalary} onChange={(e) => setNewLabourSalary(e.target.value)} className="input input-sm w-28" placeholder="salário/mês" />
                  <button type="submit" className="btn btn-primary btn-sm">
                    <IconPlus className="w-3.5 h-3.5" />
                    Adicionar
                  </button>
                </form>
              </div>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="table-head-row">
                  <th className="py-2.5 px-5 font-medium">Categoria</th>
                  <th className="text-right font-medium">Salário/mês</th>
                  <th className="text-right font-medium">Custo/hora</th>
                  <th className="w-24 pr-5"></th>
                </tr>
              </thead>
              <tbody>
                {filteredLabour.map((lc) => (
                  <tr key={lc.id} className="table-row">
                    <td className="py-2 px-5">
                      {lc.name}
                      {lc.companyId === null && <span className="badge badge-gray ml-2">catálogo base</span>}
                    </td>
                    <td className="text-right tabular-nums">
                      <EditablePrice value={lc.monthlySalary} suffix={lc.currency} onSave={(v) => handleSaveLabourSalary(lc.id, v)} />
                    </td>
                    <td className="text-right tabular-nums text-gray-600">{money(lc.hourlyRate)} /h</td>
                    <td className="text-right pr-5">
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
                    <td colSpan={4} className="py-6 text-center text-gray-400">
                      Nenhuma categoria corresponde à pesquisa.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        )}

        {tab === "materiais" && (
          <section className="card">
            <div className="px-5 pt-4 pb-3 border-b border-gray-100 space-y-3">
              <p className="text-xs text-gray-500">
                Preços são editáveis directamente. O factor de importação multiplica o preço base (frete/taxas de
                material importado). Alterar um preço actualiza de imediato todas as composições que o usam. A
                "Unidade de compra" (ex: "Camião 10m³", "Saco 20kg") é usada no relatório Materiais por Fase para
                converter a quantidade medida na quantidade real a encomendar ao fornecedor — deixe em branco para
                materiais sem embalagem fixa (ex: água, local).
              </p>
              <input
                type="search"
                placeholder="Pesquisar material..."
                value={materialQuery}
                onChange={(e) => setMaterialQuery(e.target.value)}
                className="input max-w-xs"
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[560px]">
                <thead>
                  <tr className="table-head-row">
                    <th className="py-2.5 px-5 font-medium">Material</th>
                    <th className="font-medium">Un</th>
                    <th className="text-right font-medium">{viewZoneId ? `Preço (${zones.find((z) => z.id === viewZoneId)?.name})` : "Preço base"}</th>
                    <th className="text-right font-medium">Factor imp.</th>
                    <th className="text-left font-medium">Unidade de compra</th>
                    <th className="text-right font-medium pr-5">Por zona</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMaterials.map((m) => (
                    <tr key={m.id} className="table-row">
                      <td className="py-2 px-5">
                        {m.name}
                        {m.companyId === null && <span className="badge badge-gray ml-2">catálogo base</span>}
                      </td>
                      <td className="text-gray-500">{m.unit}</td>
                      <td className="text-right tabular-nums">
                        <EditablePrice value={m.zonePrice ?? m.baseUnitCost} suffix={m.currency} onSave={(v) => handleSaveMaterialPrice(m.id, v)} />
                        {viewZoneId && !m.zonePrice && <span className="text-xs text-gray-400 ml-1">(base)</span>}
                      </td>
                      <td className="text-right tabular-nums text-gray-600">{money(m.importFactor)}×</td>
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
                        <button onClick={() => setPricingModalMaterial(m)} className="btn btn-ghost btn-sm">
                          preços e fornecedores
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredMaterials.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-gray-400">
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
              <p className="text-xs text-gray-500 max-w-lg">
                As zonas de preço permitem que um material custe diferente consoante a zona da obra (ex: transporte para
                Matola/Marracuene). Atribua uma zona a cada projecto e defina o preço por zona no separador "Materiais".
              </p>
              <form onSubmit={handleAddZone} className="flex gap-2 items-end">
                <input required value={newZoneName} onChange={(e) => setNewZoneName(e.target.value)} className="input input-sm w-64" placeholder="ex: Costa do Sol" />
                <button type="submit" className="btn btn-primary btn-sm">
                  <IconPlus className="w-3.5 h-3.5" />
                  Adicionar zona
                </button>
              </form>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="table-head-row">
                  <th className="py-2.5 px-5 font-medium">Zona</th>
                  <th className="w-40 pr-5"></th>
                </tr>
              </thead>
              <tbody>
                {zones.map((z) => (
                  <tr key={z.id} className="table-row">
                    <td className="py-2 px-5">
                      {z.name}
                      {z.companyId === null && <span className="badge badge-gray ml-2">catálogo base</span>}
                    </td>
                    <td className="text-right pr-5">
                      <button onClick={() => handleRenameZone(z.id, z.name)} className="btn btn-ghost btn-sm">
                        renomear
                      </button>
                      <button onClick={() => handleDeleteZone(z.id, z.name)} className="btn btn-ghost btn-sm text-red-600 hover:bg-red-50">
                        remover
                      </button>
                    </td>
                  </tr>
                ))}
                {zones.length === 0 && (
                  <tr>
                    <td colSpan={2} className="py-6 text-center text-gray-400">
                      Ainda não há zonas de preço — crie a primeira acima.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </Layout>
  );
}

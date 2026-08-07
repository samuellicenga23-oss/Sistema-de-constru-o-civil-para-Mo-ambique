import { useEffect, useMemo, useState } from "react";
import type { MarketplaceCatalog } from "../api/supplierPortal";

export type OfferDraft = {
  offersMaterials: boolean;
  offersLabour: boolean;
  offersEquipment: boolean;
  materialIds: string[];
  labourCategoryIds: string[];
  equipmentIds: string[];
};

type Props = {
  catalog: MarketplaceCatalog;
  value: OfferDraft;
  onChange: (next: OfferDraft) => void;
  /** Quando true, mostra formulário compacto «criar novo». */
  onCreateMaterial?: (data: { name: string; unit: string; category: string }) => Promise<void>;
  onCreateLabour?: (data: { name: string }) => Promise<void>;
  onCreateEquipment?: (data: { name: string }) => Promise<void>;
  creating?: boolean;
};

function toggleId(list: string[], id: string) {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function groupByCategory(materials: MarketplaceCatalog["materials"]) {
  const map = new Map<string, typeof materials>();
  for (const m of materials) {
    const key = (m.category || "Outros").trim() || "Outros";
    const list = map.get(key) ?? [];
    list.push(m);
    map.set(key, list);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b, "pt"));
}

export function OfferSetupForm({ catalog, value, onChange, onCreateMaterial, onCreateLabour, onCreateEquipment, creating }: Props) {
  const [query, setQuery] = useState("");
  const [newName, setNewName] = useState("");
  const [newUnit, setNewUnit] = useState("un");
  const [newCategory, setNewCategory] = useState("Cimento");
  const [createKind, setCreateKind] = useState<"material" | "labour" | "equipment" | null>(null);

  const needle = query.trim().toLocaleLowerCase("pt");
  const materialGroups = useMemo(() => {
    const filtered = needle
      ? catalog.materials.filter((m) => {
          const blob = `${m.name} ${m.category ?? ""} ${m.specification ?? ""}`.toLocaleLowerCase("pt");
          return blob.includes(needle);
        })
      : catalog.materials;
    return groupByCategory(filtered);
  }, [catalog.materials, needle]);

  const labourOptions = useMemo(
    () => (needle ? catalog.labourCategories.filter((l) => l.name.toLocaleLowerCase("pt").includes(needle)) : catalog.labourCategories),
    [catalog.labourCategories, needle],
  );
  const equipmentOptions = useMemo(
    () => (needle ? catalog.equipment.filter((e) => e.name.toLocaleLowerCase("pt").includes(needle)) : catalog.equipment),
    [catalog.equipment, needle],
  );

  async function handleCreate() {
    if (!createKind || !newName.trim()) return;
    if (createKind === "material" && onCreateMaterial) {
      await onCreateMaterial({ name: newName.trim(), unit: newUnit, category: newCategory.trim() || "Outros" });
    } else if (createKind === "labour" && onCreateLabour) {
      await onCreateLabour({ name: newName.trim() });
    } else if (createKind === "equipment" && onCreateEquipment) {
      await onCreateEquipment({ name: newName.trim() });
    }
    setNewName("");
    setCreateKind(null);
  }

  return (
    <div className="field-stack" style={{ gap: "1.25rem" }}>
      <div>
        <p className="field-label" style={{ marginBottom: "0.5rem" }}>O que vende / oferece?</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
          <label className="flex items-center gap-2 text-sm" style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <input
              type="checkbox"
              checked={value.offersMaterials}
              onChange={(e) => onChange({ ...value, offersMaterials: e.target.checked, materialIds: e.target.checked ? value.materialIds : [] })}
            />
            Materiais
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <input
              type="checkbox"
              checked={value.offersLabour}
              onChange={(e) => onChange({ ...value, offersLabour: e.target.checked, labourCategoryIds: e.target.checked ? value.labourCategoryIds : [] })}
            />
            Mão-de-obra
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <input
              type="checkbox"
              checked={value.offersEquipment}
              onChange={(e) =>
                onChange({ ...value, offersEquipment: e.target.checked, equipmentIds: e.target.checked ? value.equipmentIds : [] })
              }
            />
            Máquinas (aluguer)
          </label>
        </div>
        <p style={{ margin: "0.5rem 0 0", fontSize: "0.8rem", color: "var(--ink-400)" }}>
          Só os tipos seleccionados entram no seu painel de preços — não vê o catálogo inteiro.
        </p>
      </div>

      {(value.offersMaterials || value.offersLabour || value.offersEquipment) && (
        <div>
          <label className="field-label">Pesquisar na lista SIGO</label>
          <input className="field-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ex. Limak, pedreiro, betoneira…" />
        </div>
      )}

      {value.offersMaterials && (
        <div>
          <p className="field-label">Materiais que tem à venda ({value.materialIds.length})</p>
          <div style={{ maxHeight: "14rem", overflow: "auto", border: "1px solid var(--border, #e2e8f0)", borderRadius: "0.75rem", padding: "0.5rem" }}>
            {materialGroups.map(([category, rows]) => (
              <div key={category} style={{ marginBottom: "0.6rem" }}>
                <strong style={{ fontSize: "0.8rem" }}>{category}</strong>
                {rows.map((m) => (
                  <label key={m.id} style={{ display: "flex", gap: "0.45rem", alignItems: "flex-start", padding: "0.25rem 0", fontSize: "0.85rem" }}>
                    <input
                      type="checkbox"
                      checked={value.materialIds.includes(m.id)}
                      onChange={() => onChange({ ...value, materialIds: toggleId(value.materialIds, m.id) })}
                    />
                    <span>
                      {m.name} <span style={{ opacity: 0.6 }}>({m.unit})</span>
                    </span>
                  </label>
                ))}
              </div>
            ))}
            {materialGroups.length === 0 && <p style={{ fontSize: "0.85rem", color: "var(--ink-400)" }}>Nenhum material na pesquisa.</p>}
          </div>
          {onCreateMaterial && (
            <p style={{ marginTop: "0.6rem", fontSize: "0.82rem" }}>
              Não encontra o produto?{" "}
              <button type="button" className="link-strong" onClick={() => setCreateKind("material")}>
                Cadastre um material novo no sistema
              </button>
            </p>
          )}
        </div>
      )}

      {value.offersLabour && (
        <div>
          <p className="field-label">Categorias de mão-de-obra ({value.labourCategoryIds.length})</p>
          <div style={{ maxHeight: "10rem", overflow: "auto", border: "1px solid var(--border, #e2e8f0)", borderRadius: "0.75rem", padding: "0.5rem" }}>
            {labourOptions.map((l) => (
              <label key={l.id} style={{ display: "flex", gap: "0.45rem", padding: "0.25rem 0", fontSize: "0.85rem" }}>
                <input
                  type="checkbox"
                  checked={value.labourCategoryIds.includes(l.id)}
                  onChange={() => onChange({ ...value, labourCategoryIds: toggleId(value.labourCategoryIds, l.id) })}
                />
                {l.name}
              </label>
            ))}
          </div>
          {onCreateLabour && (
            <p style={{ marginTop: "0.6rem", fontSize: "0.82rem" }}>
              Não está na lista?{" "}
              <button type="button" className="link-strong" onClick={() => setCreateKind("labour")}>
                Cadastre uma categoria nova
              </button>
            </p>
          )}
        </div>
      )}

      {value.offersEquipment && (
        <div>
          <p className="field-label">Máquinas para aluguer ({value.equipmentIds.length})</p>
          <div style={{ maxHeight: "10rem", overflow: "auto", border: "1px solid var(--border, #e2e8f0)", borderRadius: "0.75rem", padding: "0.5rem" }}>
            {equipmentOptions.map((e) => (
              <label key={e.id} style={{ display: "flex", gap: "0.45rem", padding: "0.25rem 0", fontSize: "0.85rem" }}>
                <input
                  type="checkbox"
                  checked={value.equipmentIds.includes(e.id)}
                  onChange={() => onChange({ ...value, equipmentIds: toggleId(value.equipmentIds, e.id) })}
                />
                {e.name}
              </label>
            ))}
          </div>
          {onCreateEquipment && (
            <p style={{ marginTop: "0.6rem", fontSize: "0.82rem" }}>
              Não está na lista?{" "}
              <button type="button" className="link-strong" onClick={() => setCreateKind("equipment")}>
                Cadastre uma máquina nova
              </button>
            </p>
          )}
        </div>
      )}

      {createKind && (
        <div style={{ padding: "0.85rem", borderRadius: "0.75rem", background: "rgba(15,118,110,0.06)" }}>
          <p className="field-label" style={{ marginBottom: "0.5rem" }}>
            Novo {createKind === "material" ? "material" : createKind === "labour" ? "mão-de-obra" : "equipamento"}
          </p>
          <input className="field-input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nome" style={{ marginBottom: "0.5rem" }} />
          {createKind === "material" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", marginBottom: "0.5rem" }}>
              <select className="field-input" value={newUnit} onChange={(e) => setNewUnit(e.target.value)}>
                {["un", "kg", "m", "m2", "m3", "ml", "vg", "h"].map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
              <input className="field-input" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} list="offer-material-categories" placeholder="Grupo (ex. Cimento)" />
              <datalist id="offer-material-categories">
                <option value="Cimento" />
                <option value="Agregados" />
                <option value="Aços" />
                <option value="Alvenaria" />
                <option value="Madeiras" />
                <option value="Coberturas" />
                <option value="Instalações hidráulicas" />
                <option value="Instalações eléctricas" />
                <option value="Acabamentos" />
                <option value="Isolamentos" />
                <option value="Ferragens" />
                <option value="Betões preparados" />
                <option value="Estaleiro e segurança" />
                <option value="Outros" />
              </datalist>
            </div>
          )}
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="button" className="btn btn-primary btn-sm" disabled={creating || !newName.trim()} onClick={() => void handleCreate()}>
              {creating ? "A guardar…" : "Guardar no sistema"}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCreateKind(null)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

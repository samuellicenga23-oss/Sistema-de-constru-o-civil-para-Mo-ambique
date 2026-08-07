import { useState, type FormEvent, type ReactNode } from "react";
import type { LabourCategory, LabourCategoryInput, Material, MaterialInput, PriceZone, PriceZoneInput } from "../api/catalog";
import Modal from "./Modal";

const nullable = (value: string) => value.trim() || null;
const numeric = (value: string, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] leading-4 text-slate-500">{hint}</span>}
    </label>
  );
}

export function LabourEditor({
  item,
  onClose,
  onSave,
}: {
  item: LabourCategory | null;
  onClose: () => void;
  onSave: (data: LabourCategoryInput) => Promise<void>;
}) {
  const [form, setForm] = useState({
    code: item?.code ?? "",
    name: item?.name ?? "",
    monthlySalary: item?.monthlySalary ?? "",
    productiveHoursPerMonth: item?.productiveHoursPerMonth ?? "",
    socialChargesPct: item?.socialChargesPct ?? "0",
    complementaryCostsPct: item?.complementaryCostsPct ?? "0",
    sourceName: item?.sourceName ?? "",
    sourceReference: item?.sourceReference ?? "",
    effectiveDate: item?.effectiveDate ?? "",
    isActive: item?.isActive ?? true,
  });
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await onSave({
        code: nullable(form.code),
        name: form.name.trim(),
        monthlySalary: numeric(form.monthlySalary),
        productiveHoursPerMonth: form.productiveHoursPerMonth ? numeric(form.productiveHoursPerMonth) : null,
        socialChargesPct: numeric(form.socialChargesPct),
        complementaryCostsPct: numeric(form.complementaryCostsPct),
        sourceName: nullable(form.sourceName),
        sourceReference: nullable(form.sourceReference),
        effectiveDate: nullable(form.effectiveDate),
        isActive: form.isActive,
      });
    } finally {
      setSaving(false);
    }
  }

  const productiveHours = numeric(form.productiveHoursPerMonth, 176) || 176;
  const loadedRate = numeric(form.monthlySalary) / productiveHours
    * (1 + (numeric(form.socialChargesPct) + numeric(form.complementaryCostsPct)) / 100);

  return (
    <Modal title={item ? "Ficha de mão-de-obra" : "Nova categoria de mão-de-obra"} subtitle="Salário, encargos, horas produtivas e vigência do custo." onClose={onClose} maxWidth="max-w-3xl">
      <form onSubmit={submit} className="space-y-5">
        <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 flex items-center justify-between gap-4">
          <div><p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Custo horário carregado</p><p className="text-xs text-blue-700/80">Salário ÷ horas produtivas + encargos sociais e complementares.</p></div>
          <strong className="text-xl text-blue-950 tabular-nums">{loadedRate.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MZN/h</strong>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Código"><input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="MO-PED-01" /></Field>
          <Field label="Categoria"><input required className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Pedreiro oficial" /></Field>
          <Field label="Salário mensal"><input required min="0.01" type="number" step="0.01" className="input" value={form.monthlySalary} onChange={(e) => setForm({ ...form, monthlySalary: e.target.value })} /></Field>
          <Field label="Horas produtivas/mês" hint="Se ficar vazio, usa os dias e horas de trabalho definidos na empresa."><input min="0.01" type="number" step="0.01" className="input" value={form.productiveHoursPerMonth} onChange={(e) => setForm({ ...form, productiveHoursPerMonth: e.target.value })} placeholder="176" /></Field>
          <Field label="Encargos sociais (%)"><input min="0" max="200" type="number" step="0.01" className="input" value={form.socialChargesPct} onChange={(e) => setForm({ ...form, socialChargesPct: e.target.value })} /></Field>
          <Field label="Custos complementares (%)" hint="EPI, ferramentas, transporte, alimentação ou outros custos não salariais."><input min="0" max="200" type="number" step="0.01" className="input" value={form.complementaryCostsPct} onChange={(e) => setForm({ ...form, complementaryCostsPct: e.target.value })} /></Field>
          <Field label="Fonte do valor"><input className="input" value={form.sourceName} onChange={(e) => setForm({ ...form, sourceName: e.target.value })} placeholder="Tabela salarial / acordo / folha" /></Field>
          <Field label="Válido desde"><input type="date" className="input" value={form.effectiveDate} onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })} /></Field>
        </div>
        <Field label="Referência / observação da fonte"><textarea className="input min-h-20" value={form.sourceReference} onChange={(e) => setForm({ ...form, sourceReference: e.target.value })} placeholder="Documento, despacho, URL ou nota de cálculo" /></Field>
        <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Disponível para novas composições</label>
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="btn btn-ghost">Cancelar</button><button disabled={saving} className="btn btn-primary">{saving ? "A guardar..." : "Guardar ficha"}</button></div>
      </form>
    </Modal>
  );
}

export function MaterialEditor({
  item,
  onClose,
  onSave,
}: {
  item: Material | null;
  onClose: () => void;
  onSave: (data: MaterialInput) => Promise<void>;
}) {
  const [form, setForm] = useState({
    code: item?.code ?? "", name: item?.name ?? "", category: item?.category ?? "Outros", specification: item?.specification ?? "",
    unit: item?.unit ?? "un", baseUnitCost: item?.baseUnitCost ?? "", importFactor: item?.importFactor ?? "1",
    defaultWastePct: item?.defaultWastePct ?? "0", priceSourceName: item?.priceSourceName ?? "", sourceReference: item?.sourceReference ?? "",
    priceDate: item?.priceDate ?? "", includesVat: item?.includesVat ?? false, isActive: item?.isActive ?? true,
    purchasePackageLabel: item?.purchasePackageLabel ?? "", purchasePackageQty: item?.purchasePackageQty ?? "",
  });
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true);
    try {
      await onSave({ code: nullable(form.code), name: form.name.trim(), category: form.category.trim() || "Outros", specification: nullable(form.specification), unit: form.unit,
        baseUnitCost: numeric(form.baseUnitCost), importFactor: numeric(form.importFactor, 1), defaultWastePct: numeric(form.defaultWastePct),
        priceSourceName: nullable(form.priceSourceName), sourceReference: nullable(form.sourceReference), priceDate: nullable(form.priceDate),
        includesVat: form.includesVat, isActive: form.isActive, purchasePackageLabel: nullable(form.purchasePackageLabel),
        purchasePackageQty: form.purchasePackageQty ? numeric(form.purchasePackageQty) : null });
    } finally { setSaving(false); }
  }

  return (
    <Modal title={item ? "Ficha técnica do material" : "Novo material"} subtitle="Especificação, unidade de medição, compra, perdas e rastreabilidade do preço." onClose={onClose} maxWidth="max-w-4xl">
      <form onSubmit={submit} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Código"><input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="MAT-CIM-001" /></Field>
          <Field label="Material"><input required className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Cimento Portland 32,5" /></Field>
          <Field label="Categoria"><input required className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Ligantes" /></Field>
          <Field label="Unidade de medição"><select className="input" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>{["m", "m2", "m3", "ml", "kg", "un", "vg", "h"].map((u) => <option key={u}>{u}</option>)}</select></Field>
          <Field label="Preço base (MZN)"><input required min="0" type="number" step="0.01" className="input" value={form.baseUnitCost} onChange={(e) => setForm({ ...form, baseUnitCost: e.target.value })} /></Field>
          <Field label="Data do preço"><input type="date" className="input" value={form.priceDate} onChange={(e) => setForm({ ...form, priceDate: e.target.value })} /></Field>
          <Field label="Perda padrão (%)" hint="Sugestão ao adicionar o material a uma composição; pode ser ajustada por serviço."><input min="0" max="100" type="number" step="0.01" className="input" value={form.defaultWastePct} onChange={(e) => setForm({ ...form, defaultWastePct: e.target.value })} /></Field>
          <Field label="Factor de importação"><input min="0.0001" type="number" step="0.01" className="input" value={form.importFactor} onChange={(e) => setForm({ ...form, importFactor: e.target.value })} /></Field>
          <Field label="Fonte do preço"><input className="input" value={form.priceSourceName} onChange={(e) => setForm({ ...form, priceSourceName: e.target.value })} placeholder="Fornecedor / INE / cotação" /></Field>
          <Field label="Unidade de compra"><input className="input" value={form.purchasePackageLabel} onChange={(e) => setForm({ ...form, purchasePackageLabel: e.target.value })} placeholder="Saco 50 kg" /></Field>
          <Field label="Conteúdo da embalagem"><input min="0.0001" type="number" step="0.01" className="input" value={form.purchasePackageQty} onChange={(e) => setForm({ ...form, purchasePackageQty: e.target.value })} placeholder="50" /></Field>
        </div>
        <Field label="Especificação técnica"><textarea className="input min-h-20" value={form.specification} onChange={(e) => setForm({ ...form, specification: e.target.value })} placeholder="Marca e classe (ex. Limak CEM II/A-V 42,5 N), dimensões, norma — use um material distinto por marca/classe quando o preço difere" /></Field>
        <Field label="Referência da fonte"><textarea className="input min-h-16" value={form.sourceReference} onChange={(e) => setForm({ ...form, sourceReference: e.target.value })} placeholder="N.º da cotação, documento, URL ou observação" /></Field>
        <div className="flex flex-wrap gap-5"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.includesVat} onChange={(e) => setForm({ ...form, includesVat: e.target.checked })} /> Preço inclui IVA</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Disponível para novas composições</label></div>
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="btn btn-ghost">Cancelar</button><button disabled={saving} className="btn btn-primary">{saving ? "A guardar..." : "Guardar material"}</button></div>
      </form>
    </Modal>
  );
}

export function ZoneEditor({ item, onClose, onSave }: { item: PriceZone | null; onClose: () => void; onSave: (data: PriceZoneInput) => Promise<void> }) {
  const [form, setForm] = useState({ name: item?.name ?? "", province: item?.province ?? "", district: item?.district ?? "", description: item?.description ?? "",
    materialAdjustmentPct: item?.materialAdjustmentPct ?? "0", labourAdjustmentPct: item?.labourAdjustmentPct ?? "0", equipmentAdjustmentPct: item?.equipmentAdjustmentPct ?? "0",
    defaultTransportPct: item?.defaultTransportPct ?? "0", sourceName: item?.sourceName ?? "", sourceReference: item?.sourceReference ?? "", effectiveDate: item?.effectiveDate ?? "" });
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) { event.preventDefault(); setSaving(true); try { await onSave({ name: form.name.trim(), province: nullable(form.province), district: nullable(form.district), description: nullable(form.description),
    materialAdjustmentPct: numeric(form.materialAdjustmentPct), labourAdjustmentPct: numeric(form.labourAdjustmentPct), equipmentAdjustmentPct: numeric(form.equipmentAdjustmentPct), defaultTransportPct: numeric(form.defaultTransportPct),
    sourceName: nullable(form.sourceName), sourceReference: nullable(form.sourceReference), effectiveDate: nullable(form.effectiveDate) }); } finally { setSaving(false); } }
  return (
    <Modal title={item ? "Configurar zona de preço" : "Nova zona de preço"} subtitle="Ajustes geográficos aplicados apenas quando não existe um preço específico do recurso para a zona." onClose={onClose} maxWidth="max-w-3xl">
      <form onSubmit={submit} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-3"><Field label="Nome da zona"><input required className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field><Field label="Província"><input className="input" value={form.province} onChange={(e) => setForm({ ...form, province: e.target.value })} /></Field><Field label="Distrito"><input className="input" value={form.district} onChange={(e) => setForm({ ...form, district: e.target.value })} /></Field></div>
        <div className="rounded-xl border border-amber-100 bg-amber-50 p-4"><p className="text-sm font-semibold text-amber-950 mb-3">Factores de localização sobre o preço base</p><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Field label="Materiais (%)"><input type="number" step="0.01" className="input" value={form.materialAdjustmentPct} onChange={(e) => setForm({ ...form, materialAdjustmentPct: e.target.value })} /></Field><Field label="Transporte (%)"><input min="0" type="number" step="0.01" className="input" value={form.defaultTransportPct} onChange={(e) => setForm({ ...form, defaultTransportPct: e.target.value })} /></Field><Field label="Mão-de-obra (%)"><input type="number" step="0.01" className="input" value={form.labourAdjustmentPct} onChange={(e) => setForm({ ...form, labourAdjustmentPct: e.target.value })} /></Field><Field label="Equipamento (%)"><input type="number" step="0.01" className="input" value={form.equipmentAdjustmentPct} onChange={(e) => setForm({ ...form, equipmentAdjustmentPct: e.target.value })} /></Field></div></div>
        <Field label="Descrição / âmbito"><textarea className="input min-h-16" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Área coberta, acessos, premissas logísticas" /></Field>
        <div className="grid gap-4 sm:grid-cols-2"><Field label="Fonte"><input className="input" value={form.sourceName} onChange={(e) => setForm({ ...form, sourceName: e.target.value })} placeholder="INE / estudo de mercado" /></Field><Field label="Válido desde"><input type="date" className="input" value={form.effectiveDate} onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })} /></Field></div>
        <Field label="Referência da fonte"><textarea className="input min-h-16" value={form.sourceReference} onChange={(e) => setForm({ ...form, sourceReference: e.target.value })} /></Field>
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="btn btn-ghost">Cancelar</button><button disabled={saving} className="btn btn-primary">{saving ? "A guardar..." : "Guardar zona"}</button></div>
      </form>
    </Modal>
  );
}

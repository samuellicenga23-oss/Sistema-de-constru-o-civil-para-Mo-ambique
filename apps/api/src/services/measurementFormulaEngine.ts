export const MEASUREMENT_FORMULA_TYPES = [
  "legacy_product",
  "direct",
  "count",
  "length",
  "area",
  "wall_area",
  "perimeter",
  "volume",
  "section_length",
  "weight",
  "reinforcement",
  "percentage",
] as const;

export type MeasurementFormulaType = (typeof MEASUREMENT_FORMULA_TYPES)[number];
export type MeasurementSign = 1 | -1;

export type MeasurementFormulaInput = {
  formulaType: MeasurementFormulaType;
  sign?: MeasurementSign | number | null;
  count?: number | null;
  length?: number | null;
  width?: number | null;
  height?: number | null;
  directQuantity?: number | null;
  coefficient?: number | null;
  unitWeight?: number | null;
  diameterMm?: number | null;
  baseQuantity?: number | null;
  percentage?: number | null;
};

export type MeasurementCalculation = {
  partial: number;
  unsignedPartial: number;
  sign: MeasurementSign;
  coefficient: number;
  formulaType: MeasurementFormulaType;
  expression: string;
};

const EPSILON = 1e-9;

function numberOr(value: number | null | undefined, fallback: number): number {
  return value == null || !Number.isFinite(value) ? fallback : value;
}

function requireNonNegative(name: string, value: number | null | undefined, allowZero = true): number {
  if (value == null || !Number.isFinite(value)) throw new Error(`${name} é obrigatório`);
  if (allowZero ? value < 0 : value <= 0) throw new Error(`${name} deve ser ${allowZero ? "positivo ou zero" : "positivo"}`);
  return value;
}

function normalizeSign(value: number | null | undefined): MeasurementSign {
  if (value == null || value === 1) return 1;
  if (value === -1) return -1;
  throw new Error("O sinal da medição deve ser +1 ou -1");
}

export function reinforcementUnitWeightKgPerM(diameterMm: number): number {
  if (!Number.isFinite(diameterMm) || diameterMm <= 0) throw new Error("Diâmetro do aço inválido");
  // Fórmula prática de obra: kg/m = d² / 162, com d em mm.
  return (diameterMm * diameterMm) / 162;
}

export function roundMeasurement(value: number, decimals = 6): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function recommendedFormulaForUnit(unit: string | null | undefined): MeasurementFormulaType {
  switch (unit) {
    case "m2": return "area";
    case "m3": return "volume";
    case "m":
    case "ml": return "length";
    case "kg": return "weight";
    case "un": return "count";
    case "h":
    case "vg": return "direct";
    default: return "direct";
  }
}

export function formulaLabel(type: MeasurementFormulaType): string {
  return {
    legacy_product: "Produto legado",
    direct: "Quantidade directa",
    count: "Contagem",
    length: "Comprimento",
    area: "Área horizontal",
    wall_area: "Área vertical",
    perimeter: "Perímetro",
    volume: "Volume",
    section_length: "Secção × comprimento",
    weight: "Peso por comprimento",
    reinforcement: "Aço por diâmetro",
    percentage: "Percentagem de base",
  }[type];
}

export function validateMeasurementFormula(input: MeasurementFormulaInput): string[] {
  const errors: string[] = [];
  try { normalizeSign(input.sign); } catch (error) { errors.push((error as Error).message); }
  const coefficient = numberOr(input.coefficient, 1);
  if (coefficient < 0 || !Number.isFinite(coefficient)) errors.push("O coeficiente deve ser positivo ou zero");

  const positive = (label: string, value: number | null | undefined, allowZero = false) => {
    if (value == null || !Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) errors.push(`${label} deve ser ${allowZero ? "positivo ou zero" : "positivo"}`);
  };

  switch (input.formulaType) {
    case "legacy_product":
      positive("N.º", input.count ?? 1);
      break;
    case "direct":
      positive("Quantidade", input.directQuantity, true);
      break;
    case "count":
      positive("N.º", input.count);
      break;
    case "length":
      positive("N.º", input.count ?? 1);
      positive("Comprimento", input.length, true);
      break;
    case "area":
      positive("N.º", input.count ?? 1);
      positive("Comprimento", input.length, true);
      positive("Largura", input.width, true);
      break;
    case "wall_area":
      positive("N.º", input.count ?? 1);
      positive("Comprimento", input.length, true);
      positive("Altura", input.height, true);
      break;
    case "perimeter":
      positive("N.º", input.count ?? 1);
      positive("Comprimento", input.length, true);
      positive("Largura", input.width, true);
      break;
    case "volume":
    case "section_length":
      positive("N.º", input.count ?? 1);
      positive("Comprimento", input.length, true);
      positive("Largura", input.width, true);
      positive("Altura", input.height, true);
      break;
    case "weight":
      positive("N.º", input.count ?? 1);
      positive("Comprimento", input.length, true);
      positive("Peso unitário", input.unitWeight, true);
      break;
    case "reinforcement":
      positive("N.º", input.count ?? 1);
      positive("Comprimento", input.length, true);
      if (!(Number(input.unitWeight) > 0) && !(Number(input.diameterMm) > 0)) errors.push("Indique o diâmetro ou peso unitário do aço");
      break;
    case "percentage":
      positive("Quantidade base", input.baseQuantity, true);
      positive("Percentagem", input.percentage, true);
      break;
  }
  return errors;
}

export function calculateMeasurementPartial(input: MeasurementFormulaInput): MeasurementCalculation {
  const errors = validateMeasurementFormula(input);
  if (errors.length) throw new Error(errors.join("; "));

  const sign = normalizeSign(input.sign);
  const coefficient = numberOr(input.coefficient, 1);
  const count = numberOr(input.count, 1);
  let raw = 0;
  let expression = "";

  switch (input.formulaType) {
    case "legacy_product": {
      const length = numberOr(input.length, 1);
      const width = numberOr(input.width, 1);
      const height = numberOr(input.height, 1);
      raw = count * length * width * height;
      expression = `${count} × ${length} × ${width} × ${height}`;
      break;
    }
    case "direct": {
      const qty = requireNonNegative("Quantidade", input.directQuantity, true);
      raw = qty;
      expression = `${qty}`;
      break;
    }
    case "count":
      raw = count;
      expression = `${count}`;
      break;
    case "length": {
      const length = requireNonNegative("Comprimento", input.length, true);
      raw = count * length;
      expression = `${count} × ${length}`;
      break;
    }
    case "area": {
      const length = requireNonNegative("Comprimento", input.length, true);
      const width = requireNonNegative("Largura", input.width, true);
      raw = count * length * width;
      expression = `${count} × ${length} × ${width}`;
      break;
    }
    case "wall_area": {
      const length = requireNonNegative("Comprimento", input.length, true);
      const height = requireNonNegative("Altura", input.height, true);
      raw = count * length * height;
      expression = `${count} × ${length} × ${height}`;
      break;
    }
    case "perimeter": {
      const length = requireNonNegative("Comprimento", input.length, true);
      const width = requireNonNegative("Largura", input.width, true);
      raw = count * 2 * (length + width);
      expression = `${count} × 2 × (${length} + ${width})`;
      break;
    }
    case "volume":
    case "section_length": {
      const length = requireNonNegative("Comprimento", input.length, true);
      const width = requireNonNegative("Largura", input.width, true);
      const height = requireNonNegative("Altura", input.height, true);
      raw = count * length * width * height;
      expression = `${count} × ${length} × ${width} × ${height}`;
      break;
    }
    case "weight": {
      const length = requireNonNegative("Comprimento", input.length, true);
      const unitWeight = requireNonNegative("Peso unitário", input.unitWeight, true);
      raw = count * length * unitWeight;
      expression = `${count} × ${length} × ${unitWeight}`;
      break;
    }
    case "reinforcement": {
      const length = requireNonNegative("Comprimento", input.length, true);
      const unitWeight = Number(input.unitWeight) > 0
        ? Number(input.unitWeight)
        : reinforcementUnitWeightKgPerM(Number(input.diameterMm));
      raw = count * length * unitWeight;
      expression = `${count} × ${length} × ${roundMeasurement(unitWeight, 6)} kg/m`;
      break;
    }
    case "percentage": {
      const base = requireNonNegative("Quantidade base", input.baseQuantity, true);
      const percentage = requireNonNegative("Percentagem", input.percentage, true);
      raw = base * percentage / 100;
      expression = `${base} × ${percentage}%`;
      break;
    }
  }

  const unsignedPartial = raw * coefficient;
  const partial = sign * unsignedPartial;
  if (!Number.isFinite(partial) || Math.abs(partial) > Number.MAX_SAFE_INTEGER) throw new Error("Resultado de medição inválido");
  return {
    partial: Math.abs(partial) < EPSILON ? 0 : partial,
    unsignedPartial,
    sign,
    coefficient,
    formulaType: input.formulaType,
    expression: `${sign < 0 ? "− " : ""}${expression}${coefficient !== 1 ? ` × ${coefficient}` : ""}`,
  };
}

export function sumMeasurementPartials(values: number[]): number {
  const total = values.reduce((sum, value) => sum + value, 0);
  return roundMeasurement(total, 6);
}

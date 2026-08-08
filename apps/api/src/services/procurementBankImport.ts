import ExcelJS from "exceljs";
import { createHash } from "node:crypto";

export type ImportedBankRow = {
  transactionDate: string;
  valueDate: string | null;
  amount: number;
  currency: "MZN" | "USD";
  description: string | null;
  reference: string | null;
  counterparty: string | null;
  fingerprint: string;
};

const aliases: Record<string, string[]> = {
  transactionDate: ["date", "data", "transactiondate", "dataoperacao", "dataoperacao", "bookingdate"],
  valueDate: ["valuedate", "datavalor", "datavalor"],
  amount: ["amount", "valor", "montante", "debitocredito", "debitcredit"],
  debit: ["debit", "debito", "levantamento", "withdrawal"],
  credit: ["credit", "credito", "deposito", "deposit"],
  currency: ["currency", "moeda"],
  description: ["description", "descricao", "detalhes", "narrative"],
  reference: ["reference", "referencia", "ref"],
  counterparty: ["counterparty", "contraparte", "beneficiario", "ordenante"],
};
function key(value: unknown) { return String(value ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, ""); }
function findColumn(headers: unknown[], target: keyof typeof aliases) {
  const accepted = new Set(aliases[target]);
  const idx = headers.findIndex((value) => accepted.has(key(value)));
  return idx >= 0 ? idx : null;
}
function text(value: unknown): string | null { const v = String(value ?? "").trim(); return v || null; }
function parseAmount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  let raw = String(value ?? "").trim().replace(/\s/g, "");
  if (!raw) return null;
  if (raw.includes(",") && raw.includes(".")) {
    if (raw.lastIndexOf(",") > raw.lastIndexOf(".")) raw = raw.replace(/\./g, "").replace(",", ".");
    else raw = raw.replace(/,/g, "");
  } else if (raw.includes(",")) raw = raw.replace(",", ".");
  raw = raw.replace(/[^0-9+\-.]/g, "");
  const parsed = Number(raw); return Number.isFinite(parsed) ? parsed : null;
}
function excelDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const dmy = raw.match(/^(\d{1,2})[\-/](\d{1,2})[\-/](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  const parsed = new Date(raw); return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}
function fingerprint(row: Omit<ImportedBankRow, "fingerprint">) {
  return createHash("sha256").update([row.transactionDate,row.valueDate ?? "",row.amount.toFixed(2),row.currency,row.reference ?? "",row.description ?? ""].join("|")).digest("hex");
}

function convertRows(rows: unknown[][], defaultCurrency: "MZN" | "USD"): ImportedBankRow[] {
  if (rows.length < 2) return [];
  const headers = rows[0];
  const dateIdx = findColumn(headers, "transactionDate");
  const amountIdx = findColumn(headers, "amount");
  const debitIdx = findColumn(headers, "debit");
  const creditIdx = findColumn(headers, "credit");
  if (dateIdx === null || (amountIdx === null && debitIdx === null && creditIdx === null)) throw new Error("Extracto deve conter Data/Date e Valor/Amount ou Débito/Crédito");
  const valueDateIdx = findColumn(headers, "valueDate");
  const currencyIdx = findColumn(headers, "currency");
  const descriptionIdx = findColumn(headers, "description");
  const referenceIdx = findColumn(headers, "reference");
  const counterpartyIdx = findColumn(headers, "counterparty");
  const result: ImportedBankRow[] = [];
  for (const cells of rows.slice(1)) {
    const transactionDate = excelDate(cells[dateIdx]);
    let amount = amountIdx === null ? null : parseAmount(cells[amountIdx]);
    if (amountIdx === null) {
      const debit = debitIdx === null ? 0 : Math.abs(parseAmount(cells[debitIdx]) ?? 0);
      const credit = creditIdx === null ? 0 : Math.abs(parseAmount(cells[creditIdx]) ?? 0);
      if (debit > 0 && credit > 0) continue;
      amount = credit > 0 ? credit : debit > 0 ? -debit : null;
    }
    if (!transactionDate || amount === null || Math.abs(amount) < 0.005) continue;
    const rawCurrency = currencyIdx === null ? defaultCurrency : String(cells[currencyIdx] ?? defaultCurrency).trim().toUpperCase();
    const currency = rawCurrency === "USD" ? "USD" : rawCurrency === "MZN" ? "MZN" : defaultCurrency;
    const base = {
      transactionDate,
      valueDate: valueDateIdx === null ? null : excelDate(cells[valueDateIdx]),
      amount,
      currency,
      description: descriptionIdx === null ? null : text(cells[descriptionIdx]),
      reference: referenceIdx === null ? null : text(cells[referenceIdx]),
      counterparty: counterpartyIdx === null ? null : text(cells[counterpartyIdx]),
    };
    result.push({ ...base, fingerprint: fingerprint(base) });
  }
  return result;
}

function parseDelimited(textValue: string): unknown[][] {
  const lines = textValue.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim().length);
  if (!lines.length) return [];
  const delimiter = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  return lines.map((line) => {
    const out: string[] = []; let current = ""; let quoted = false;
    for (let i=0;i<line.length;i++) { const c=line[i]; if(c==='"'){ if(quoted&&line[i+1]==='"'){current+='"';i++;}else quoted=!quoted; } else if(c===delimiter&&!quoted){out.push(current);current="";} else current+=c; }
    out.push(current); return out;
  });
}

export async function parseBankStatement(buffer: Buffer, filename: string, defaultCurrency: "MZN" | "USD"): Promise<ImportedBankRow[]> {
  if (filename.toLowerCase().endsWith(".xlsx")) {
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as any);
    const sheet = workbook.worksheets[0]; if (!sheet) return [];
    const rows: unknown[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row: any) => rows.push((row.values as unknown[]).slice(1)));
    return convertRows(rows, defaultCurrency);
  }
  return convertRows(parseDelimited(buffer.toString("utf8")), defaultCurrency);
}

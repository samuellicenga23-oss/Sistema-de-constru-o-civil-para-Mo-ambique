import puppeteer from "puppeteer";
import { logoDataUri, type CompanyBrand } from "./companyBrand.js";

function esc(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(value: number, currency: string) {
  return `${value.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

export type PracticeCompanyBrand = CompanyBrand;

export type PracticePdfLine = {
  phase?: string | null;
  specialty?: string | null;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  lineTotal: number;
  included?: boolean;
};

export type PracticeDocumentPdfInput = {
  kind: "proposta" | "factura" | "recibo";
  number: string | null;
  title?: string | null;
  clientName: string;
  clientNuit?: string | null;
  clientAddress?: string | null;
  issueDate: string | null;
  dueDate?: string | null;
  validUntil?: string | null;
  currency: string;
  ivaRate?: number;
  grossAmount?: number;
  netAmount?: number;
  amount?: number;
  notes?: string | null;
  lines?: PracticePdfLine[];
  company: PracticeCompanyBrand;
  proposal?: {
    projectDesignation?: string | null;
    location?: string | null;
    workType?: string | null;
    serviceLabel?: string | null;
    intro?: string | null;
    exclusions?: string | null;
    paymentTerms?: string | null;
    additionalNotes?: string | null;
    acceptanceText?: string | null;
    deadlineText?: string | null;
    validityText?: string | null;
    acceptedAmount?: number | null;
  };
};

function groupLinesHtml(lines: PracticePdfLine[], currency: string) {
  const included = lines.filter((line) => line.included !== false);
  const groups = new Map<string, PracticePdfLine[]>();
  for (const line of included) {
    const key = line.specialty || line.phase || "Honorários";
    const list = groups.get(key) ?? [];
    list.push(line);
    groups.set(key, list);
  }
  let html = "";
  for (const [group, groupLines] of groups) {
    const sub = groupLines.reduce((sum, line) => sum + line.lineTotal, 0);
    html += `<tr class="group"><td colspan="4"><strong>${esc(group)}</strong> · ${money(sub, currency)}</td></tr>`;
    html += groupLines
      .map(
        (line) =>
          `<tr><td>${esc(line.description)}</td><td class="num">${esc(line.quantity)} ${esc(line.unit)}</td><td class="num">${money(line.unitPrice, currency)}</td><td class="num">${money(line.lineTotal, currency)}</td></tr>`,
      )
      .join("");
  }
  return html;
}

export async function buildPracticeDocumentPdf(data: PracticeDocumentPdfInput) {
  const companyLabel = data.company.brandName || data.company.name;
  const accent = data.company.primaryColor || "#ED6C22";
  const logo = logoDataUri(data.company.logoUrl);
  const title =
    data.kind === "proposta" ? "PROPOSTA" : data.kind === "factura" ? "FACTURA" : "RECIBO";
  const linesHtml =
    data.kind === "proposta"
      ? groupLinesHtml(data.lines ?? [], data.currency)
      : (data.lines ?? [])
          .map(
            (line) =>
              `<tr><td>${esc(line.phase ? `${line.phase} — ${line.description}` : line.description)}</td><td class="num">${esc(line.quantity)} ${esc(line.unit)}</td><td class="num">${money(line.unitPrice, data.currency)}</td><td class="num">${money(line.lineTotal, data.currency)}</td></tr>`,
          )
          .join("");

  const totalsBlock =
    data.kind === "recibo"
      ? `<div class="total"><div class="row"><span>Valor recebido</span><strong>${money(Number(data.amount ?? 0), data.currency)}</strong></div></div>`
      : `<div class="total">
          <div class="row"><span>Subtotal / Honorários</span><strong>${money(Number(data.grossAmount ?? 0), data.currency)}</strong></div>
          <div class="row"><span>IVA ${((data.ivaRate ?? 0) * 100).toFixed(2)}%</span><strong>${money(Number(data.netAmount ?? 0) - Number(data.grossAmount ?? 0), data.currency)}</strong></div>
          <div class="row"><span>Total</span><strong>${money(Number(data.netAmount ?? data.grossAmount ?? 0), data.currency)}</strong></div>
          ${
            data.proposal?.acceptedAmount != null && data.proposal.acceptedAmount !== Number(data.grossAmount ?? 0)
              ? `<div class="row"><span>Valor aceite</span><strong>${money(data.proposal.acceptedAmount, data.currency)}</strong></div>`
              : ""
          }
        </div>`;

  const p = data.proposal;
  const prose =
    data.kind === "proposta"
      ? `
      ${p?.serviceLabel ? `<p class="section"><span class="k">Assunto</span><br/>${esc(p.serviceLabel)}</p>` : ""}
      ${p?.projectDesignation || p?.location || p?.workType ? `<div class="box" style="margin-bottom:16px"><div class="k">Identificação do projecto</div><div class="v">${esc(p.projectDesignation || data.title || "—")}</div><div class="meta" style="margin-top:8px">${[p.workType, p.location].filter(Boolean).map(esc).join(" · ")}</div></div>` : ""}
      ${p?.intro ? `<p class="prose">${esc(p.intro)}</p>` : ""}
      <h2 class="h">Âmbito dos serviços / Honorários</h2>
      `
      : "";

  const paymentBlock = data.company.bankDetails?.trim()
    ? `<div class="pay">
        <div class="pay-title">Meios de pagamento</div>
        <div class="pay-body">${esc(data.company.bankDetails.trim())}</div>
        ${
          data.kind === "proposta" && p?.paymentTerms
            ? `<div class="pay-terms"><strong>Condições:</strong> ${esc(p.paymentTerms)}</div>`
            : ""
        }
      </div>`
    : data.kind === "proposta" && p?.paymentTerms
      ? `<h2 class="h">Condições de pagamento</h2><p class="prose">${esc(p.paymentTerms)}</p>`
      : data.kind === "factura"
        ? `<div class="pay warn"><div class="pay-title">Meios de pagamento</div><div class="pay-body">Configure os meios de pagamento da empresa em Empresa → Dados gerais para aparecerem nas facturas.</div></div>`
        : "";

  const conditions =
    data.kind === "proposta"
      ? `
      ${p?.deadlineText ? `<h2 class="h">Prazo</h2><p class="prose">${esc(p.deadlineText)}</p>` : ""}
      ${p?.validityText ? `<h2 class="h">Validade</h2><p class="prose">${esc(p.validityText)}</p>` : ""}
      ${paymentBlock}
      ${p?.exclusions ? `<h2 class="h">Exclusões / Serviços adicionais</h2><p class="prose">${esc(p.exclusions)}</p>` : ""}
      ${p?.additionalNotes ? `<h2 class="h">Condições comerciais</h2><p class="prose">${esc(p.additionalNotes)}</p>` : ""}
      ${data.notes ? `<h2 class="h">Observações</h2><p class="prose">${esc(data.notes)}</p>` : ""}
      <h2 class="h">Aceitação</h2>
      <p class="prose">${esc(p?.acceptanceText || "A aceitação da presente proposta implica a concordância com o âmbito, honorários e condições comerciais aqui descritos.")}</p>
      <div class="sign"><div><div class="line"></div>O Prestador</div><div><div class="line"></div>O Cliente</div></div>
      `
      : `${paymentBlock}${data.notes ? `<div class="notes">${esc(data.notes)}</div>` : ""}`;

  const initial = (companyLabel || "E").trim().charAt(0).toUpperCase();

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{font:12px "Segoe UI",Arial,sans-serif;color:#0f172a;margin:28px}
.top{display:flex;justify-content:space-between;gap:24px;border-bottom:3px solid ${accent};padding-bottom:16px;margin-bottom:22px}
.brand{display:flex;gap:14px;align-items:center}
.brand img{max-height:64px;max-width:160px;object-fit:contain}
.brand-mark{width:56px;height:56px;border-radius:12px;background:${accent};color:#fff;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800;flex-shrink:0}
.brand h1{margin:0;font-size:20px;letter-spacing:.02em}
.meta{color:#64748b;font-size:11px;margin-top:4px;line-height:1.45}
.doc-title{text-align:right}
.doc-title .label{font-size:22px;font-weight:800;letter-spacing:.08em;color:#0f172a}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:18px}
.box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px}
.box .k{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#64748b}
.box .v{font-weight:700;margin-top:4px}
table{width:100%;border-collapse:collapse;margin:8px 0 18px}
th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;padding:8px 6px;border-bottom:1px solid #cbd5e1}
td{padding:9px 6px;border-bottom:1px solid #e2e8f0;vertical-align:top}
tr.group td{background:#f1f5f9;border-bottom:1px solid #cbd5e1;padding-top:10px}
.num{text-align:right;white-space:nowrap}
.total{background:#0f172a;color:#fff;border-radius:10px;padding:14px 16px;margin-bottom:16px}
.total .row{display:flex;justify-content:space-between;padding:4px 0}
.prose{font-size:11.5px;line-height:1.55;color:#334155;white-space:pre-wrap;margin:0 0 12px}
.h{font-size:12px;margin:18px 0 8px;color:#0f172a;border-bottom:1px solid #e2e8f0;padding-bottom:4px}
.section{margin:0 0 12px;font-size:12px}
.pay{margin:16px 0;padding:14px 16px;border:1px solid #cbd5e1;border-left:4px solid ${accent};border-radius:10px;background:#fff}
.pay.warn{border-left-color:#f59e0b;background:#fffbeb}
.pay-title{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#0f172a;margin-bottom:8px}
.pay-body{font-size:12px;line-height:1.55;color:#1e293b;white-space:pre-wrap}
.pay-terms{margin-top:10px;font-size:11px;color:#475569;line-height:1.45}
.notes{margin-top:14px;font-size:11px;color:#475569;white-space:pre-wrap}
.sign{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:36px;font-size:11px;color:#64748b}
.sign .line{border-top:1px solid #94a3b8;margin-top:48px;margin-bottom:8px}
.foot{margin-top:28px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:10px;color:#64748b;white-space:pre-wrap}
.k{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#64748b}
</style></head><body>
<div class="top">
  <div class="brand">
    ${logo ? `<img src="${logo}" alt="${esc(companyLabel)}" />` : `<div class="brand-mark">${esc(initial)}</div>`}
    <div>
      <h1>${esc(companyLabel)}</h1>
      <div class="meta">
        ${data.company.nuit ? `NUIT ${esc(data.company.nuit)}<br/>` : ""}
        ${data.company.address ? `${esc(data.company.address)}<br/>` : ""}
        ${[data.company.phone, data.company.email].filter(Boolean).map(esc).join(" · ")}
      </div>
    </div>
  </div>
  <div class="doc-title">
    <div class="label">${title}</div>
    <div class="meta">${esc(data.number ?? "Por emitir")}${data.title ? `<br/>${esc(data.title)}` : ""}</div>
  </div>
</div>
<div class="grid">
  <div class="box">
    <div class="k">Cliente</div>
    <div class="v">${esc(data.clientName)}</div>
    ${data.clientNuit ? `<div class="meta" style="margin-top:8px">NUIT ${esc(data.clientNuit)}</div>` : ""}
    ${data.clientAddress ? `<div class="meta">${esc(data.clientAddress)}</div>` : ""}
  </div>
  <div class="box">
    <div class="k">Datas</div>
    <div class="v">Emissão: ${esc(data.issueDate ?? "—")}</div>
    ${data.dueDate ? `<div class="meta" style="margin-top:8px">Vencimento: ${esc(data.dueDate)}</div>` : ""}
    ${data.validUntil ? `<div class="meta" style="margin-top:8px">Válida até: ${esc(data.validUntil)}</div>` : ""}
  </div>
</div>
${prose}
${
  data.lines?.length
    ? `<table><thead><tr><th>Descrição</th><th class="num">Qtd</th><th class="num">Preço</th><th class="num">Total</th></tr></thead><tbody>${linesHtml}</tbody></table>`
    : ""
}
${totalsBlock}
${conditions}
${data.company.documentFooter?.trim() ? `<div class="foot">${esc(data.company.documentFooter.trim())}</div>` : ""}
</body></html>`;

  const browser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    return Buffer.from(
      await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "12mm", bottom: "14mm", left: "12mm", right: "12mm" },
      }),
    );
  } finally {
    await browser.close();
  }
}

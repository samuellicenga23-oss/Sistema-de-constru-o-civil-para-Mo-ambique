import puppeteer from "puppeteer";
import { logoDataUri, type CompanyBrand } from "./companyBrand.js";

function esc(value: unknown) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function money(value: number, currency: string) {
  return `${value.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

type InvoicePdfData = {
  invoice: {
    invoiceNumber: string | null;
    clientName: string | null;
    issueDate: string | null;
    dueDate: string | null;
    grossAmount: string;
    ivaRate: string;
    retentionAmount: string;
    netAmount: string;
    currency: string;
    status: string;
  };
  project: { name: string; client: string | null };
  company: CompanyBrand;
  paidAmount: number;
  creditAmount: number;
  outstandingAmount: number;
};

export async function buildInvoicePdf(data: InvoicePdfData) {
  const i = data.invoice;
  const brandLabel = data.company.brandName || data.company.name;
  const accent = data.company.primaryColor || "#ED6C22";
  const logo = logoDataUri(data.company.logoUrl);
  const creditLine = data.creditAmount > 0
    ? `<div class="line no-border"><span>Notas de crédito</span><strong>− ${money(data.creditAmount, i.currency)}</strong></div>`
    : "";
  const paymentBlock = data.company.bankDetails?.trim()
    ? `<div class="pay"><div class="pay-title">Meios de pagamento</div><div class="pay-body">${esc(data.company.bankDetails.trim())}</div></div>`
    : `<div class="pay warn"><div class="pay-title">Meios de pagamento</div><div class="pay-body">Configure os meios de pagamento da empresa em Empresa → Dados gerais.</div></div>`;
  const companyMeta = [
    data.company.nuit ? `NUIT ${data.company.nuit}` : null,
    data.company.address,
    data.company.phone,
    data.company.email,
  ]
    .filter(Boolean)
    .map(esc)
    .join(" · ");
  const footer = data.company.documentFooter?.trim() || `Documento gerado por ${brandLabel}`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{font:12px Arial;color:#14213d;margin:34px}
.top{display:flex;justify-content:space-between;border-bottom:3px solid ${esc(accent)};padding-bottom:18px;gap:16px}
.brand-wrap{display:flex;align-items:center;gap:12px}
.logo{max-height:52px;max-width:140px;object-fit:contain}
.brand{font-weight:800;font-size:22px;letter-spacing:.5px}
.tag,.meta{color:#667085;margin-top:5px;font-size:11px}
.title{font-size:26px;font-weight:800;text-align:right;color:${esc(accent)}}
.meta{text-align:right}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:22px;margin:28px 0}
.box{background:#f8fafc;padding:14px;border-radius:8px}
.label{font-size:10px;text-transform:uppercase;color:#667085}
.value{font-weight:700;margin-top:4px}
.line{display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid #e5e7eb}
.no-border{border:0}
.total{background:#14213d;color:white;padding:16px;border-radius:8px;margin-top:16px}
.pay{margin-top:22px;padding:14px;border:1px solid #e5e7eb;border-radius:8px;background:#fafafa}
.pay.warn{background:#fffbeb;border-color:#fde68a}
.pay-title{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#667085;margin-bottom:6px}
.pay-body{white-space:pre-wrap;line-height:1.45}
.foot{margin-top:28px;font-size:9px;color:#667085}
</style></head><body>
<div class="top">
  <div class="brand-wrap">
    ${logo ? `<img class="logo" src="${logo}" alt=""/>` : ""}
    <div>
      <div class="brand">${esc(brandLabel)}</div>
      ${companyMeta ? `<div class="tag">${companyMeta}</div>` : ""}
    </div>
  </div>
  <div>
    <div class="title">FACTURA</div>
    <div class="meta">${esc(i.invoiceNumber ?? "POR EMITIR")}</div>
  </div>
</div>
<div class="grid">
  <div class="box">
    <div class="label">Cliente</div>
    <div class="value">${esc(i.clientName ?? data.project.client ?? "Por definir")}</div>
    <div class="label" style="margin-top:14px">Obra</div>
    <div class="value">${esc(data.project.name)}</div>
  </div>
  <div class="box">
    <div class="label">Emissão</div>
    <div class="value">${esc(i.issueDate ?? "—")}</div>
    <div class="label" style="margin-top:14px">Vencimento</div>
    <div class="value">${esc(i.dueDate ?? "—")}</div>
  </div>
</div>
<div class="line"><span>Auto de Medição aprovado</span><strong>${money(Number(i.grossAmount), i.currency)}</strong></div>
<div class="line"><span>IVA</span><strong>${(Number(i.ivaRate) * 100).toFixed(2)}%</strong></div>
<div class="line"><span>Retenção</span><strong>− ${money(Number(i.retentionAmount), i.currency)}</strong></div>
<div class="total">
  <div class="line no-border"><span>Valor líquido da factura</span><strong>${money(Number(i.netAmount), i.currency)}</strong></div>
  ${creditLine}
  <div class="line no-border"><span>Recebido</span><strong>${money(data.paidAmount, i.currency)}</strong></div>
  <div class="line no-border"><span>Saldo em aberto</span><strong>${money(data.outstandingAmount, i.currency)}</strong></div>
</div>
${paymentBlock}
<div class="foot">${esc(footer)} · Estado: ${esc(i.status)}</div>
</body></html>`;
  const browser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    return Buffer.from(await page.pdf({ format: "A4", printBackground: true, margin: { top: "12mm", bottom: "14mm", left: "12mm", right: "12mm" } }));
  } finally {
    await browser.close();
  }
}

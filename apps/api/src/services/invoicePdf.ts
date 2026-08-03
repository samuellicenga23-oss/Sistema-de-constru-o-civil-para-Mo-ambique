import puppeteer from "puppeteer";

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
  paidAmount: number;
  creditAmount: number;
  outstandingAmount: number;
};

export async function buildInvoicePdf(data: InvoicePdfData) {
  const i = data.invoice;
  const creditLine = data.creditAmount > 0
    ? `<div class="line no-border"><span>Notas de crédito</span><strong>− ${money(data.creditAmount, i.currency)}</strong></div>`
    : "";
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{font:12px Arial;color:#14213d;margin:34px}.top{display:flex;justify-content:space-between;border-bottom:3px solid #ed6a1f;padding-bottom:18px}.brand{font-weight:800;font-size:24px;letter-spacing:2px}.tag,.meta{color:#667085;margin-top:5px}.title{font-size:26px;font-weight:800;text-align:right}.meta{text-align:right}.grid{display:grid;grid-template-columns:1fr 1fr;gap:22px;margin:28px 0}.box{background:#f8fafc;padding:14px;border-radius:8px}.label{font-size:10px;text-transform:uppercase;color:#667085}.value{font-weight:700;margin-top:4px}.line{display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid #e5e7eb}.no-border{border:0}.total{background:#14213d;color:white;padding:16px;border-radius:8px;margin-top:16px}.foot{position:fixed;bottom:20px;font-size:9px;color:#667085}
</style></head><body><div class="top"><div><div class="brand">SIGO</div><div class="tag">Sistema Integrado de Gestão de Obras</div></div><div><div class="title">FACTURA</div><div class="meta">${esc(i.invoiceNumber ?? "POR EMITIR")}</div></div></div><div class="grid"><div class="box"><div class="label">Cliente</div><div class="value">${esc(i.clientName ?? data.project.client ?? "Por definir")}</div><div class="label" style="margin-top:14px">Obra</div><div class="value">${esc(data.project.name)}</div></div><div class="box"><div class="label">Emissão</div><div class="value">${esc(i.issueDate ?? "—")}</div><div class="label" style="margin-top:14px">Vencimento</div><div class="value">${esc(i.dueDate ?? "—")}</div></div></div><div class="line"><span>Auto de Medição aprovado</span><strong>${money(Number(i.grossAmount), i.currency)}</strong></div><div class="line"><span>IVA</span><strong>${(Number(i.ivaRate) * 100).toFixed(2)}%</strong></div><div class="line"><span>Retenção</span><strong>− ${money(Number(i.retentionAmount), i.currency)}</strong></div><div class="total"><div class="line no-border"><span>Valor líquido da factura</span><strong>${money(Number(i.netAmount), i.currency)}</strong></div>${creditLine}<div class="line no-border"><span>Recebido</span><strong>${money(data.paidAmount, i.currency)}</strong></div><div class="line no-border"><span>Saldo em aberto</span><strong>${money(data.outstandingAmount, i.currency)}</strong></div></div><div class="foot">Documento gerado pelo SIGO · Estado: ${esc(i.status)}</div></body></html>`;
  const browser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    return Buffer.from(await page.pdf({ format: "A4", printBackground: true, margin: { top: "12mm", bottom: "14mm", left: "12mm", right: "12mm" } }));
  } finally {
    await browser.close();
  }
}

import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../env.js";

/**
 * Envio de email transaccional. Sem SMTP_HOST/SMTP_USER/SMTP_PASS definidos, fica "desligado":
 * regista o email no log em vez de o enviar. Nunca lança — uma falha de email nunca deve
 * derrubar o pedido que a originou (ex: aprovar um comprovativo continua a activar a
 * subscrição mesmo que o SMTP esteja em baixo).
 */

export function isMailEnabled(): boolean {
  return Boolean(env.smtpHost && env.smtpUser && env.smtpPass);
}

let transporter: Transporter | null = null;
function getTransporter(): Transporter | null {
  if (!isMailEnabled()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtpHost!,
      port: env.smtpPort,
      secure: env.smtpPort === 465,
      auth: { user: env.smtpUser!, pass: env.smtpPass! },
    });
  }
  return transporter;
}

export type SendEmailInput = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
};

export async function sendEmail(input: SendEmailInput, logger?: { info: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void }): Promise<boolean> {
  const to = Array.isArray(input.to) ? input.to.filter(Boolean) : [input.to].filter(Boolean);
  if (!to.length) return false;

  const client = getTransporter();
  if (!client) {
    logger?.info({ to, subject: input.subject }, "Email não enviado — SMTP não configurado (SMTP_HOST/SMTP_USER/SMTP_PASS)");
    return false;
  }

  try {
    await client.sendMail({
      from: env.mailFrom ?? env.smtpUser!,
      to: to.join(", "),
      subject: input.subject,
      html: input.html,
      text: input.text ?? input.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
    });
    return true;
  } catch (error) {
    logger?.error({ error, to, subject: input.subject }, "Falha ao enviar email");
    return false;
  }
}

/** Escapa texto dinâmico antes de interpolar em HTML de email. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Nome de ficheiro seguro para Content-Disposition (sem aspas/quebra de cabeçalho). */
export function safeContentDispositionFilename(name: string | null | undefined, fallback: string): string {
  const cleaned = (name ?? fallback).replace(/[\r\n"]/g, "").replace(/[^\w.\- ()[\]]+/g, "_").slice(0, 180);
  return cleaned || fallback;
}

/** Moldura simples e consistente para todos os emails do SIGO — sem depender de imagens externas. */
export function emailLayout(title: string, bodyHtml: string, ctaUrl?: string, ctaLabel?: string): string {
  const cta = ctaUrl && ctaLabel
    ? `<p style="margin:24px 0;"><a href="${escapeHtml(ctaUrl)}" style="background:#1AADB4;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;">${escapeHtml(ctaLabel)}</a></p>`
    : "";
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;color:#0f172a;">
    <div style="background:#0f172a;padding:20px 24px;border-radius:12px 12px 0 0;">
      <span style="color:#fff;font-weight:900;font-size:18px;letter-spacing:.02em;">SIGO</span>
    </div>
    <div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;padding:24px;">
      <h1 style="font-size:18px;margin:0 0 16px;">${escapeHtml(title)}</h1>
      <div style="font-size:14px;line-height:1.6;color:#334155;">${bodyHtml}</div>
      ${cta}
      <p style="margin-top:24px;font-size:12px;color:#94a3b8;">SIGO — Sistema Integrado de Gestão de Obras</p>
    </div>
  </div>`;
}

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { LogoFull } from "../components/Logo";

type ShareSettings = {
  showProgress: boolean;
  showCertifiedValue: boolean;
  showContractValue: boolean;
  showSchedule: boolean;
  showCurrentPhase: boolean;
  showDiaryEvidences: boolean;
  showPaymentSchedule: boolean;
  showNextPayment: boolean;
};

type Installment = {
  id: string;
  sequence: number;
  title: string;
  dueDate: string;
  amount: number;
  status: "prevista" | "parcial" | "paga" | "atrasada";
  paidAmount: number;
};

type PublicSummary = {
  projectName: string;
  currency: string;
  settings: ShareSettings;
  currentPhase: { name: string; progressPercent: number } | null;
  progress: {
    hasCertificates: boolean;
    latestCertificateNumber?: number;
    percentExecutado?: number;
    certificadoAoDono?: number;
    valorContrato?: number;
  } | null;
  schedule: {
    hasSchedule: boolean;
    startDate?: string;
    endDate?: string;
    daysElapsed?: number;
    daysTotal?: number;
    percentTimeElapsed?: number;
  } | null;
  nextPayment: {
    title: string;
    dueDate: string;
    amount: number;
    daysUntil: number;
    status: Installment["status"];
  } | null;
  paymentSchedule: {
    mode: "total" | "parcelado";
    totalAmount: number;
    currency: string;
    installments: Installment[];
  } | null;
  diary: Array<{ date: string; workDone: string; photoUrls: string[] }>;
};

function money(value: number, currency: string) {
  return new Intl.NumberFormat("pt-MZ", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}

function fmtDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat("pt-MZ", { day: "2-digit", month: "short", year: "numeric" }).format(d);
}

function Bar({ percent, tone }: { percent: number; tone: "brand" | "amber" }) {
  const pct = Math.max(0, Math.min(100, percent));
  return (
    <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
      <div className={`h-full rounded-full ${tone === "brand" ? "bg-teal-600" : "bg-amber-500"}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function statusLabel(status: Installment["status"]) {
  if (status === "paga") return "Paga";
  if (status === "parcial") return "Parcial";
  if (status === "atrasada") return "Atrasada";
  return "Prevista";
}

export default function PublicProjectPage() {
  const { token } = useParams();
  const [summary, setSummary] = useState<PublicSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Progresso da obra — SIGO";
    fetch(`/api/public/obra/${token}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Link inválido");
        return res.json();
      })
      .then(setSummary)
      .catch((err) => setError(err instanceof Error ? err.message : "Não foi possível carregar"));
  }, [token]);

  if (error) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface px-5">
        <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-raised">
          <p className="font-display text-lg font-bold text-ink">Link indisponível</p>
          <p className="mt-2 text-sm leading-6 text-slate-500">{error}</p>
        </div>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface">
        <p className="text-sm text-slate-500">A carregar...</p>
      </div>
    );
  }

  const { progress, schedule, settings } = summary;
  const behindSchedule =
    progress?.hasCertificates &&
    schedule?.hasSchedule &&
    (schedule.percentTimeElapsed ?? 0) - (progress.percentExecutado ?? 0) > 10;

  return (
    <div className="min-h-dvh bg-surface pb-16">
      <header className="border-b border-slate-200/90 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-4">
          <LogoFull tagline={false} />
          <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Progresso da obra</span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-4 px-5 py-6">
        <h1 className="font-display text-2xl font-bold text-ink">{summary.projectName}</h1>

        {settings.showCurrentPhase && summary.currentPhase && (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-slate-700">Fase actual</p>
            <p className="mt-2 font-display text-xl font-bold text-ink">{summary.currentPhase.name}</p>
            <p className="mt-1 text-sm text-slate-500">{summary.currentPhase.progressPercent.toFixed(0)}% concluído nesta fase</p>
          </section>
        )}

        {progress && (settings.showProgress || settings.showCertifiedValue || settings.showContractValue) && (
          progress.hasCertificates || progress.valorContrato != null ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-baseline justify-between">
                <p className="text-sm font-semibold text-slate-700">Execução e valores</p>
                {progress.latestCertificateNumber != null && (
                  <span className="text-xs text-slate-400">Auto nº {progress.latestCertificateNumber}</span>
                )}
              </div>
              {settings.showProgress && progress.percentExecutado != null && (
                <>
                  <p className="mt-3 font-display text-3xl font-black text-ink">{progress.percentExecutado.toFixed(1)}%</p>
                  <div className="mt-2">
                    <Bar percent={progress.percentExecutado} tone="brand" />
                  </div>
                </>
              )}
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                {settings.showCertifiedValue && progress.certificadoAoDono != null && (
                  <div>
                    <p className="text-xs text-slate-400">Certificado ao dono</p>
                    <p className="font-semibold text-ink">{money(progress.certificadoAoDono, summary.currency)}</p>
                  </div>
                )}
                {settings.showContractValue && progress.valorContrato != null && (
                  <div>
                    <p className="text-xs text-slate-400">Valor do contrato</p>
                    <p className="font-semibold text-ink">{money(progress.valorContrato, summary.currency)}</p>
                  </div>
                )}
              </div>
            </section>
          ) : (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm">
              Ainda não há autos de medição aprovados para esta obra.
            </section>
          )
        )}

        {settings.showNextPayment && summary.nextPayment && (
          <section className="rounded-2xl border border-teal-100 bg-teal-50/60 p-5 shadow-sm">
            <p className="text-sm font-semibold text-teal-900">Próximo pagamento</p>
            <p className="mt-2 font-display text-2xl font-bold text-ink">{money(summary.nextPayment.amount, summary.currency)}</p>
            <p className="mt-1 text-sm text-slate-700">{summary.nextPayment.title}</p>
            <p className="mt-2 text-sm text-slate-600">
              {summary.nextPayment.daysUntil > 0
                ? `Daqui a ${summary.nextPayment.daysUntil} dia${summary.nextPayment.daysUntil === 1 ? "" : "s"}`
                : summary.nextPayment.daysUntil === 0
                  ? "Vence hoje"
                  : `Atrasado há ${Math.abs(summary.nextPayment.daysUntil)} dia${Math.abs(summary.nextPayment.daysUntil) === 1 ? "" : "s"}`}
              <span className="text-slate-400"> · {fmtDate(summary.nextPayment.dueDate)}</span>
            </p>
          </section>
        )}

        {schedule?.hasSchedule && (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-slate-700">Prazo</p>
            <p className="mt-3 font-display text-3xl font-black text-ink">
              Dia {schedule.daysElapsed} <span className="text-base font-normal text-slate-400">de {schedule.daysTotal}</span>
            </p>
            <div className="mt-2">
              <Bar percent={schedule.percentTimeElapsed ?? 0} tone={behindSchedule ? "amber" : "brand"} />
            </div>
            <p className="mt-3 text-xs text-slate-500">
              {fmtDate(schedule.startDate!)} — {fmtDate(schedule.endDate!)}
              {behindSchedule && <span className="ml-2 font-semibold text-amber-700">· execução abaixo do prazo decorrido</span>}
            </p>
          </section>
        )}

        {summary.paymentSchedule && summary.paymentSchedule.installments.length > 0 && (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-slate-700">Plano de pagamentos</p>
            <p className="mt-1 text-xs text-slate-500">
              Total {money(summary.paymentSchedule.totalAmount, summary.paymentSchedule.currency)} ·{" "}
              {summary.paymentSchedule.mode === "total" ? "pagamento único" : "parcelado"}
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-xs text-slate-400">
                    <th className="py-2 pr-2 font-medium">#</th>
                    <th className="py-2 pr-2 font-medium">Parcela</th>
                    <th className="py-2 pr-2 font-medium">Vencimento</th>
                    <th className="py-2 pr-2 font-medium text-right">Valor</th>
                    <th className="py-2 font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.paymentSchedule.installments.map((row) => (
                    <tr key={row.id} className="border-b border-slate-50">
                      <td className="py-2 pr-2 text-slate-400">{row.sequence}</td>
                      <td className="py-2 pr-2 text-slate-800">{row.title}</td>
                      <td className="py-2 pr-2 text-slate-600">{fmtDate(row.dueDate)}</td>
                      <td className="py-2 pr-2 text-right font-medium text-ink">
                        {money(row.amount, summary.paymentSchedule!.currency)}
                      </td>
                      <td className="py-2">
                        <span
                          className={
                            row.status === "paga"
                              ? "text-teal-700"
                              : row.status === "atrasada"
                                ? "font-semibold text-red-700"
                                : "text-slate-600"
                          }
                        >
                          {statusLabel(row.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {settings.showDiaryEvidences && summary.diary.length > 0 && (
          <section className="space-y-3">
            <p className="text-sm font-semibold text-slate-700">Diário de obra</p>
            {summary.diary.map((entry, i) => (
              <div key={i} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold text-slate-400">{fmtDate(entry.date)}</p>
                <p className="mt-1 text-sm leading-relaxed text-slate-700">{entry.workDone}</p>
                {entry.photoUrls.length > 0 && (
                  <div className="mt-3 flex gap-2 overflow-x-auto">
                    {entry.photoUrls.map((url) => (
                      <button key={url} type="button" onClick={() => setLightbox(url)} className="shrink-0">
                        <img src={url} alt="Foto da obra" className="h-20 w-20 rounded-lg object-cover" loading="lazy" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </section>
        )}
      </main>

      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightbox(null)}
        >
          <img src={lightbox} alt="Foto da obra" className="max-h-[90vh] max-w-full rounded-lg object-contain" />
        </div>
      )}
    </div>
  );
}

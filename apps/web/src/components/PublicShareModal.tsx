import { useEffect, useState } from "react";
import { request } from "../api/http";
import Modal from "./Modal";
import AlertBanner from "./AlertBanner";
import { useConfirmDialog } from "../hooks/useConfirmDialog";

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

type ShareStatus = { enabled: boolean; token: string | null; settings: ShareSettings };

const SETTING_LABELS: Array<{ key: keyof ShareSettings; label: string; hint: string }> = [
  { key: "showProgress", label: "Progresso da execução", hint: "Percentagem dos autos certificados" },
  { key: "showCertifiedValue", label: "Valor certificado ao dono", hint: "Montante já faturado/certificado — nunca custo interno" },
  { key: "showContractValue", label: "Valor do contrato", hint: "Valor contratado (com aditamentos aprovados)" },
  { key: "showSchedule", label: "Prazo / cronograma", hint: "Dias decorridos vs. total" },
  { key: "showCurrentPhase", label: "Fase actual", hint: "Tarefa em curso no cronograma" },
  { key: "showDiaryEvidences", label: "Evidências do diário", hint: "Texto e fotos do diário de obra" },
  { key: "showPaymentSchedule", label: "Plano de pagamentos", hint: "Tabela de parcelas do cliente" },
  { key: "showNextPayment", label: "Próximo pagamento", hint: "Próxima parcela e dias até ao vencimento" },
];

export default function PublicShareModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [status, setStatus] = useState<ShareStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { confirm, dialog } = useConfirmDialog();

  useEffect(() => {
    request<ShareStatus>(`/projects/${projectId}/public-share`).then(setStatus).catch((err) => setError(err.message));
  }, [projectId]);

  const url = status?.token ? `${window.location.origin}/obra/${status.token}` : null;
  const previewItems = SETTING_LABELS.filter((item) => status?.settings?.[item.key]);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const result = await request<ShareStatus>(`/projects/${projectId}/public-share`, { method: "POST" });
      setStatus(result);
      setCopied(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao gerar o link");
    } finally {
      setLoading(false);
    }
  }

  async function handleRevoke() {
    const ok = await confirm({
      title: "Desactivar o link?",
      message: "Quem tiver o link deixa de conseguir aceder. Pode gerar um novo depois.",
      confirmLabel: "Desactivar",
      danger: true,
    });
    if (!ok) return;
    setLoading(true);
    setError(null);
    try {
      const result = await request<{ enabled: false }>(`/projects/${projectId}/public-share`, { method: "DELETE" });
      setStatus((prev) => (prev ? { ...prev, enabled: result.enabled, token: null } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao desactivar o link");
    } finally {
      setLoading(false);
    }
  }

  async function toggleSetting(key: keyof ShareSettings) {
    if (!status) return;
    const next = { ...status.settings, [key]: !status.settings[key] };
    setStatus({ ...status, settings: next });
    setSavingSettings(true);
    setError(null);
    try {
      const settings = await request<ShareSettings>(`/projects/${projectId}/public-share/settings`, {
        method: "PUT",
        body: JSON.stringify({ [key]: next[key] }),
      });
      setStatus((prev) => (prev ? { ...prev, settings } : prev));
    } catch (err) {
      setStatus(status);
      setError(err instanceof Error ? err.message : "Erro ao guardar a visibilidade");
    } finally {
      setSavingSettings(false);
    }
  }

  function handleCopy() {
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <Modal title="Partilhar com o dono da obra" subtitle="Link público sem login" onClose={onClose}>
      <div className="space-y-4">
        {error && <AlertBanner tone="error">{error}</AlertBanner>}
        <p className="text-sm text-slate-600">
          Não mostra custos internos nem composições.
        </p>

        {status?.enabled && url ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
              <input readOnly value={url} className="input flex-1 border-0 bg-transparent text-xs" onFocus={(e) => e.target.select()} />
              <button type="button" onClick={handleCopy} className="btn btn-secondary btn-sm shrink-0">
                {copied ? "Copiado!" : "Copiar"}
              </button>
            </div>
            <div className="flex gap-2">
              <a href={url} target="_blank" rel="noreferrer" className="btn btn-secondary flex-1">
                Pré-visualizar
              </a>
              <button type="button" onClick={handleRevoke} disabled={loading} className="btn btn-secondary flex-1 text-red-700">
                Desactivar link
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={handleGenerate} disabled={loading || status === null} className="btn btn-primary w-full">
            {loading ? "A gerar..." : "Gerar link de partilha"}
          </button>
        )}

        {status && (
          <div className="space-y-2 border-t border-slate-100 pt-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-800">O que o dono vê</p>
              {savingSettings && <span className="text-xs text-slate-400">A guardar…</span>}
            </div>
            <div className="space-y-1.5">
              {SETTING_LABELS.map((item) => (
                <label key={item.key} className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={status.settings[item.key]}
                    onChange={() => toggleSetting(item.key)}
                    disabled={savingSettings}
                  />
                  <span>
                    <span className="block text-sm font-medium text-slate-800">{item.label}</span>
                    <span className="block text-xs text-slate-500">{item.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/80 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Pré-visualização</p>
              {previewItems.length ? (
                <ul className="mt-2 space-y-1 text-sm text-slate-700">
                  {previewItems.map((item) => (
                    <li key={item.key}>· {item.label}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-slate-500">Nenhuma secção activa — o dono só verá o nome da obra.</p>
              )}
            </div>
          </div>
        )}
      </div>
      {dialog}
    </Modal>
  );
}

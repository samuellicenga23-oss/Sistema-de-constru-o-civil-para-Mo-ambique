import { useEffect, useState } from "react";
import { request } from "../api/http";
import Modal from "./Modal";
import AlertBanner from "./AlertBanner";
import { useConfirmDialog } from "../hooks/useConfirmDialog";

type ShareStatus = { enabled: boolean; token: string | null };

export default function PublicShareModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [status, setStatus] = useState<ShareStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { confirm, dialog } = useConfirmDialog();

  useEffect(() => {
    request<ShareStatus>(`/projects/${projectId}/public-share`).then(setStatus).catch((err) => setError(err.message));
  }, [projectId]);

  const url = status?.token ? `${window.location.origin}/obra/${status.token}` : null;

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
      const result = await request<ShareStatus>(`/projects/${projectId}/public-share`, { method: "DELETE" });
      setStatus(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao desactivar o link");
    } finally {
      setLoading(false);
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
    <Modal title="Partilhar com o dono da obra" subtitle="Link público, sem login — progresso, valor certificado e diário de obra" onClose={onClose}>
      <div className="space-y-4">
        {error && <AlertBanner tone="error">{error}</AlertBanner>}
        <p className="text-sm text-slate-600">
          Nunca mostra preços internos, composições nem outros projectos — só o progresso, o valor já certificado (preço
          de venda) e as fotos do diário de obra.
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
      </div>
      {dialog}
    </Modal>
  );
}

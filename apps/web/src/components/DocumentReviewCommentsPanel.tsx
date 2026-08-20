import { useEffect, useState } from "react";
import { documentReviewApi, type DocumentReviewComment } from "../api/documentReview";

export default function DocumentReviewCommentsPanel({
  documentId,
  targetType = "document",
  targetId = null,
  targetLabel,
  canWrite = true,
}: {
  documentId: string;
  targetType?: "document" | "section" | "line_item" | "measurement_line";
  targetId?: string | null;
  targetLabel?: string;
  canWrite?: boolean;
}) {
  const [items, setItems] = useState<DocumentReviewComment[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const res = await documentReviewApi.list(documentId, {
      targetType,
      targetId: targetId ?? undefined,
    });
    setItems(res.items);
  }

  useEffect(() => {
    let cancelled = false;
    void documentReviewApi
      .list(documentId, { targetType, targetId: targetId ?? undefined })
      .then((res: { items: DocumentReviewComment[] }) => {
        if (!cancelled) setItems(res.items);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Erro ao carregar comentários");
      });
    return () => {
      cancelled = true;
    };
  }, [documentId, targetType, targetId]);

  async function submit() {
    if (!draft.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await documentReviewApi.create(documentId, {
        targetType,
        targetId,
        targetLabelSnapshot: targetLabel ?? null,
        comment: draft.trim(),
      });
      setDraft("");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao guardar comentário");
    } finally {
      setBusy(false);
    }
  }

  async function resolve(id: string) {
    setBusy(true);
    try {
      await documentReviewApi.resolve(id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao resolver");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-3">
      {targetLabel && (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Relativo a <span className="font-semibold text-slate-800">{targetLabel}</span>
        </p>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      <ul className="flex-1 space-y-3 overflow-y-auto">
        {items.length === 0 && <li className="text-sm text-slate-500">Sem comentários.</li>}
        {items.map((item) => (
          <li
            key={item.id}
            className={`rounded-lg border px-3 py-2 ${item.resolvedAt ? "border-slate-100 bg-slate-50 opacity-80" : "border-slate-200 bg-white"}`}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-semibold text-slate-800">{item.authorName}</p>
              <time className="shrink-0 text-[10px] text-slate-400">
                {new Date(item.createdAt).toLocaleString("pt-MZ", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
              </time>
            </div>
            {item.targetLabelSnapshot && item.targetType !== targetType && (
              <button
                type="button"
                className="mt-1 rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-800"
                onClick={() => {
                  if (item.targetId) {
                    document.getElementById(`line-item-${item.targetId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
                  }
                }}
              >
                {item.targetLabelSnapshot}
              </button>
            )}
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{item.comment}</p>
            {item.resolvedAt ? (
              <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-emerald-700">Resolvido</p>
            ) : canWrite ? (
              <button type="button" className="mt-2 text-[11px] font-semibold text-brand-700 hover:underline" disabled={busy} onClick={() => void resolve(item.id)}>
                Marcar resolvido
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {canWrite && (
        <div className="border-t border-slate-100 pt-3">
          <textarea
            className="input min-h-20 w-full text-sm"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Escrever comentário…"
          />
          <button type="button" className="btn btn-primary btn-sm mt-2" disabled={busy || !draft.trim()} onClick={() => void submit()}>
            {busy ? "A guardar…" : "Comentar"}
          </button>
        </div>
      )}
    </div>
  );
}

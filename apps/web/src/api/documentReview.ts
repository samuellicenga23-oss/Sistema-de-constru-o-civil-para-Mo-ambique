import { request } from "./http";

export type DocumentReviewComment = {
  id: string;
  documentId: string;
  targetType: "document" | "section" | "line_item" | "measurement_line" | string;
  targetId: string | null;
  targetLabelSnapshot: string | null;
  authorUserId: string;
  authorName: string;
  comment: string;
  parentCommentId: string | null;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
  createdAt: string;
};

export const documentReviewApi = {
  list: (documentId: string, opts?: { targetType?: string; targetId?: string }) => {
    const params = new URLSearchParams();
    if (opts?.targetType) params.set("targetType", opts.targetType);
    if (opts?.targetId) params.set("targetId", opts.targetId);
    const qs = params.toString();
    return request<{ items: DocumentReviewComment[] }>(
      `/budget-documents/${documentId}/review-comments${qs ? `?${qs}` : ""}`,
    );
  },
  create: (
    documentId: string,
    body: {
      targetType?: string;
      targetId?: string | null;
      targetLabelSnapshot?: string | null;
      comment: string;
      parentCommentId?: string | null;
    },
  ) =>
    request<DocumentReviewComment>(`/budget-documents/${documentId}/review-comments`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  resolve: (commentId: string) =>
    request<DocumentReviewComment>(`/review-comments/${commentId}/resolve`, { method: "POST" }),
};

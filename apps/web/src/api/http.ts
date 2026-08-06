export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public upgradeHint?: string,
    public actionPath?: string,
  ) {
    super(message);
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** Converte o shape de `zodError.flatten()` numa frase legível para a UI. */
function zodFlattenToMessage(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const { formErrors, fieldErrors } = raw as { formErrors?: unknown; fieldErrors?: unknown };
  const parts: string[] = [];
  if (Array.isArray(formErrors)) parts.push(...formErrors.filter((m): m is string => typeof m === "string"));
  if (fieldErrors && typeof fieldErrors === "object") {
    for (const messages of Object.values(fieldErrors as Record<string, unknown>)) {
      if (Array.isArray(messages)) parts.push(...messages.filter((m): m is string => typeof m === "string"));
    }
  }
  return parts.length ? parts.join(" ") : null;
}

export async function request<T>(path: string, options?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const hasFormData = typeof FormData !== "undefined" && options?.body instanceof FormData;
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchOptions } = options ?? {};
  const timeoutSignal =
    typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(timeoutMs)
      : undefined;
  const signal = fetchOptions.signal ?? timeoutSignal;

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      credentials: "include",
      ...fetchOptions,
      signal,
      headers: {
        ...(fetchOptions.body && !hasFormData ? { "Content-Type": "application/json" } : {}),
        ...fetchOptions.headers,
      },
    });
  } catch (error) {
    if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new ApiError(408, "O servidor demorou demasiado a responder. Tente novamente.");
    }
    throw error;
  }

  if (!res.ok) {
    const body = await res.json().catch(
      () => ({} as { error?: unknown; code?: unknown; upgradeHint?: unknown; actionPath?: unknown }),
    );
    const raw = body.error;
    const message =
      typeof raw === "string"
        ? raw
        : raw && typeof raw === "object"
          ? // Zod .flatten() → { formErrors: string[], fieldErrors: Record<string, string[]> }.
            // Junta as mensagens numa frase legível em vez de mostrar o JSON cru na UI.
            zodFlattenToMessage(raw) ?? `Erro ${res.status}`
          : `Erro ${res.status}`;
    throw new ApiError(
      res.status,
      message,
      typeof body.code === "string" ? body.code : undefined,
      typeof body.upgradeHint === "string" ? body.upgradeHint : undefined,
      typeof body.actionPath === "string" ? body.actionPath : undefined,
    );
  }
  return res.json();
}

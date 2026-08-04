export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;

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
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error ?? `Erro ${res.status}`, typeof body.code === "string" ? body.code : undefined);
  }
  return res.json();
}

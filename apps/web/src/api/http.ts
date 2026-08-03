export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const hasFormData = typeof FormData !== "undefined" && options?.body instanceof FormData;
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    ...options,
    headers: {
      ...(options?.body && !hasFormData ? { "Content-Type": "application/json" } : {}),
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error ?? `Erro ${res.status}`, typeof body.code === "string" ? body.code : undefined);
  }
  return res.json();
}

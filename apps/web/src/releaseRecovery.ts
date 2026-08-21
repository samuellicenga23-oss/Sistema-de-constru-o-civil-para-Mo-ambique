import { getPollingInterval } from "./lib/dataSaver";

const RELOAD_KEY = "sigo-release-reload";
const RELEASE_GUARD_BASE_MS = 5 * 60_000;

export async function clearApplicationCaches() {
  if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }
  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.update()));
  }
}

export async function recoverApplication(targetRelease?: string) {
  sessionStorage.setItem(RELOAD_KEY, targetRelease || "manual");
  await clearApplicationCaches().catch(() => undefined);
  window.location.reload();
}

/** Actualiza uma aba antiga uma única vez quando a API já pertence a outro deploy. */
export function startReleaseGuard() {
  if (__SIGO_RELEASE__ === "dev") return () => undefined;
  let stopped = false;
  const check = async () => {
    if (stopped || document.visibilityState === "hidden") return;
    try {
      const response = await fetch("/api/health", { cache: "no-store", credentials: "include" });
      if (!response.ok) return;
      const body = await response.json() as { release?: unknown };
      const serverRelease = typeof body.release === "string" ? body.release : "dev";
      if (serverRelease === "dev" || serverRelease === __SIGO_RELEASE__) {
        sessionStorage.removeItem(RELOAD_KEY);
        return;
      }
      if (sessionStorage.getItem(RELOAD_KEY) === serverRelease) return;
      await recoverApplication(serverRelease);
    } catch {
      // Rede temporariamente indisponível: não interromper o trabalho do utilizador.
    }
  };
  void check();
  const interval = window.setInterval(check, getPollingInterval(RELEASE_GUARD_BASE_MS));
  const onVisible = () => { if (document.visibilityState === "visible") void check(); };
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    stopped = true;
    window.clearInterval(interval);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

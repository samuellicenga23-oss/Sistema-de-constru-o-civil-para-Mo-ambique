import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App.tsx";
import AppErrorBoundary from "./components/AppErrorBoundary.tsx";
import { applyTheme, getStoredTheme } from "./theme.ts";
import { initMonitoring } from "./monitoring.ts";
import { startReleaseGuard } from "./releaseRecovery.ts";

// Ao mudar CACHE_EPOCH, browsers com PWA antigo apagam Cache Storage e pedem update do SW.
const CACHE_EPOCH = "20260812e";
const CACHE_EPOCH_KEY = "sigo-cache-epoch";
if (typeof window !== "undefined" && window.localStorage.getItem(CACHE_EPOCH_KEY) !== CACHE_EPOCH) {
  const finish = () => window.localStorage.setItem(CACHE_EPOCH_KEY, CACHE_EPOCH);
  const tasks: Promise<unknown>[] = [];
  if ("caches" in window) {
    tasks.push(caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key)))));
  }
  if ("serviceWorker" in navigator) {
    tasks.push(
      navigator.serviceWorker.getRegistrations().then((regs) => Promise.all(regs.map((reg) => reg.update()))),
    );
  }
  void Promise.all(tasks).finally(finish);
}

applyTheme(getStoredTheme());
initMonitoring();
startReleaseGuard();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AppErrorBoundary>
  </StrictMode>
);

import { useEffect, useState } from "react";
import { IconDownload } from "./icons";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Botão "Instalar aplicação" — só aparece quando o browser confirma que a app é instalável
// (manifest + service worker válidos) e ainda não foi instalada. Nada a configurar manualmente:
// o evento beforeinstallprompt só dispara quando as condições do PWA estão cumpridas.
export default function InstallAppButton() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    function onBeforeInstall(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    }
    function onInstalled() {
      setDeferredPrompt(null);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!deferredPrompt) return null;

  async function handleInstall() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  }

  return (
    <button onClick={handleInstall} className="btn btn-ghost btn-sm" title="Instalar o SIGA como aplicação">
      <IconDownload className="w-3.5 h-3.5" />
      <span className="hidden sm:inline">Instalar aplicação</span>
    </button>
  );
}

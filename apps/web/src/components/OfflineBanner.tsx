import { useEffect, useState } from "react";

// Mensagem clara quando a internet falta — pedido explícito do documento da Fase 1. A app em si
// continua a abrir offline (a casca fica em cache pelo service worker), mas nenhum dado é
// carregado/gravado sem rede, por isso o utilizador precisa de saber porquê.
export default function OfflineBanner() {
  const [offline, setOffline] = useState(!navigator.onLine);

  useEffect(() => {
    function onOnline() {
      setOffline(false);
    }
    function onOffline() {
      setOffline(true);
    }
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div className="bg-amber-50 border-b border-amber-200 px-5 md:px-8 py-2 text-xs text-amber-800 text-center">
      Sem ligação à internet — a aplicação continua aberta, mas não é possível carregar nem guardar dados até a ligação voltar.
    </div>
  );
}

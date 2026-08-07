import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App.tsx";
import { ToastProvider } from "./components/Toast.tsx";

// O site vive sempre sob "/fornecedor/" (em dev porque o Vite aplica `base` também ao servidor
// de desenvolvimento; em produção porque é aí que o Fastify o serve) — o router usa sempre esse
// prefixo, nunca a raiz do domínio.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);

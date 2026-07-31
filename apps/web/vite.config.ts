import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      // Nunca guardar em cache respostas de /api/ ou /uploads/ (dados de cada empresa, privados
      // ou não) — só a "casca" da aplicação (JS/CSS/ícones) fica disponível offline. Sem rede,
      // a app abre e mostra a interface, mas qualquer pedido de dados falha com um erro claro
      // (nunca dados desactualizados servidos silenciosamente como se fossem actuais).
      workbox: {
        navigateFallbackDenylist: [/^\/api\//, /^\/uploads\//],
        runtimeCaching: [
          {
            urlPattern: /^\/api\//,
            handler: "NetworkOnly",
          },
          {
            urlPattern: /^\/uploads\//,
            handler: "NetworkOnly",
          },
        ],
      },
      manifest: {
        lang: "pt",
        name: "SIGO — Sistema Integrado de Gestão de Obras",
        short_name: "SIGO",
        description: "Mapas de quantidades, orçamentos, autos de medição e catálogo de custos para construção civil.",
        theme_color: "#0E2033",
        background_color: "#f4f5f7",
        display: "standalone",
        start_url: "/painel",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
  server: {
    host: "127.0.0.1",
    port: 5273,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:4100",
        changeOrigin: true,
      },
      "/uploads": {
        target: "http://localhost:4100",
        changeOrigin: true,
      },
    },
  },
});

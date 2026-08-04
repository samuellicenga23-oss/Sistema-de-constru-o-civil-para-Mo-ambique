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
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        // Assets versionados são guardados pelo runtime. Não os incluir no precache evita que
        // o service worker volte a descarregar bundles antigos preservados para abas abertas.
        globPatterns: ["**/*.{html,ico,svg,webmanifest}", "favicon.png", "icon-*.png", "brand/*.png"],
        navigateFallbackDenylist: [/^\/api\//, /^\/uploads\//],
        runtimeCaching: [
          {
            urlPattern: /^\/assets\//,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "sigo-versioned-assets",
              expiration: { maxEntries: 80, maxAgeSeconds: 7 * 24 * 60 * 60 },
            },
          },
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
        theme_color: "#0A1A2F",
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
  build: {
    // Limpa dist em cada build para evitar misturar chunks de gerações antigas (PWA/cache).
    emptyOutDir: true,
  },
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

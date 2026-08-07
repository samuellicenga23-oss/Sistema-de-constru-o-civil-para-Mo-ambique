import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Site completamente à parte do SIGO principal — próprio processo de build, próprias rotas,
// nenhum código partilhado com apps/web. Em produção é servido sob "/fornecedor/" (ver
// apps/api/src/app.ts), por isso o "base" tem de corresponder para os assets resolverem.
export default defineConfig({
  base: "/fornecedor/",
  plugins: [react()],
  build: {
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:4100",
        changeOrigin: true,
      },
      // Logos oficiais vivem em apps/web/public/brand — mesma origem em produção.
      "/brand": {
        target: "http://127.0.0.1:5273",
        changeOrigin: true,
      },
    },
  },
});

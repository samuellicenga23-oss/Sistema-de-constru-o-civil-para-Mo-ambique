// Configuração do PM2 para a API Node (o plant-service Python corre à parte, via systemd —
// ver deploy/sigo-plant-service.service). Arrancar com:
//   pm2 start deploy/ecosystem.config.cjs
//   pm2 save && pm2 startup   (para sobreviver a reboots da VPS)
//
// Assume que o repositório está em /var/www/sigo na VPS — ajustar `cwd` se for outro
// caminho. As variáveis de ambiente vêm do apps/api/.env (carregado automaticamente por
// "dotenv/config" logo no topo de src/env.ts) — não é preciso repeti-las aqui.
module.exports = {
  apps: [
    {
      name: "sigo-api",
      cwd: "/var/www/sigo/apps/api",
      script: "dist/index.js",
      env: {
        NODE_ENV: "production",
      },
      max_memory_restart: "400M",
    },
  ],
};

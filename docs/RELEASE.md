# SIGO — Checklist de release (sem deploy)

Use este documento antes de promover uma versão para produção. **Não executa deploy** — apenas lista os passos verificáveis localmente ou na VPS.

## 1. Pré-requisitos locais

```bash
npm ci
npm run db:migrate          # BD de dev/staging actualizada
npm run quality:release     # estrutura + typecheck + testes
node scripts/backup-manifest.mjs
npm run smoke:production    # opcional, contra URL de staging
```

## 2. Gates obrigatórios

| Gate | Comando / endpoint | Critério |
|------|-------------------|----------|
| Typecheck | `npm run build:shared && npm run build --workspace=apps/api && npm run build --workspace=apps/web` | Zero erros TS |
| Testes API | `npm run test --workspace=apps/api` | Todos passam |
| Testes web | `npm run test --workspace=apps/web` | Todos passam |
| Migrations | `apps/api/drizzle/meta/_journal.json` vs BD | Sem pending |
| Segurança headers | `GET /api/ready` → `securityHeaders.ok: true` | 5 cabeçalhos presentes |
| Health | `GET /api/health` | `status: ok` |
| Readiness | `GET /api/ready` | `database: ok`; anotar stubs mail/storage |
| Backup manifest | `GET /api/admin/backup-manifest` ou script | Categorias uploads listadas |
| Secrets | `git ls-files` | Sem `.env`, chaves ou PEM |

## 3. Readiness — interpretação

- **mail.stub = true**: SMTP não configurado; emails só no log. Aceitável em dev; configurar SMTP antes de produção.
- **storage.status = error**: `UPLOADS_DIR` inacessível — bloqueante.
- **plantService degradado**: orçamento/diário/compras continuam; novos PDFs de planta aguardam.

## 4. Backup antes de deploy (VPS)

```bash
bash deploy/backup.sh          # PostgreSQL + manifest uploads
bash deploy/preflight.sh
bash deploy/deploy.sh
bash deploy/status.sh
```

Restore **não testado não conta** — validar num ambiente temporário.

## 5. Pós-deploy (manual)

1. `curl -s https://SEU_DOMINIO/api/health`
2. `curl -s https://SEU_DOMINIO/api/ready`
3. Login smoke + uma acção crítica (orçamento, compra, portal cliente)
4. Verificar último backup &lt; 54h no Super Admin

## 6. Rollback

```bash
bash deploy/rollback.sh
```

Documentar HEAD, migrations aplicadas e incidente em `docs/audit-*/FINAL-REPORT-MZ.md`.

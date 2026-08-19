# SIGO refactor baseline — 2026-08-19

## SHA inicial

- Branch: `main` (tracking `origin/main`)
- SHA: `0ec2f18b313116e61d0fd8edc45b31fb411ad9f8`
- Mensagem: `fix: submeter medições/orçamentos e confirmar vãos`
- Coincide com a base da auditoria do pacote overnight.

Working tree: alterações não commitadas só de artefactos locais (tmp, auditorias, scripts de arranque, pptx). Sem código funcional por commitar.

Package manager: **npm** (`package-lock.json`). Monorepo workspaces: `apps/web`, `apps/api`, `apps/supplier`, `packages/shared`. Plant-service Python fora dos workspaces.

## Comandos de validação

| Comando | Onde |
|---|---|
| `npm run build:shared` | tsc `packages/shared` |
| `npm run build --workspace=apps/api` | tsc API |
| `npm run build --workspace=apps/web` | tsc + vite |
| `npm run build --workspace=apps/supplier` | tsc + vite |
| `npm test` | vitest API + web |
| `npm run test --workspace=apps/api` | vitest API |
| `npm run test:unit --workspace=apps/api` | vitest unit (sem DB) |
| `npm run test --workspace=apps/web` | vitest web |
| `npm run quality:release` | `scripts/release-readiness.mjs` |
| `npm run smoke:production` | `scripts/production-smoke.mjs` |
| `npm run db:migrate` | Drizzle `apps/api` |
| plant-service: `.venv/Scripts/python.exe -m unittest` | `apps/plant-service` |

Verificado nesta fase: `npm run build:shared` — OK.

## Módulos e caminhos reais

| Módulo | Web | API | Notas |
|---|---|---|---|
| Levantamentos / medições | `ProjectsPage`, `BudgetDocumentPage`, `PlantManualIntakePage`, `api/boq.ts`, `api/measurement.ts`, `api/measurementLines.ts` | `budgetDocuments.ts`, `measurementLines.ts`, `boqEngine.ts`, `measurementEngine.ts`, `measurementImport.ts` | docs `documentType=medicao` |
| Plantas | `PlantReviewPage`, `PlantManualIntakePage`, `api/plants.ts` | `plants.ts`, `plantMeasurementLink.ts`, `plantMeasurementSync.ts`, `plantReviewRequests.ts` | `apps/plant-service/` FastAPI 8001 |
| Orçamento / BOQ | `BudgetDocumentPage`, `api/boq.ts` | `budgetDocuments.ts`, `boqEngine.ts`, `boqTemplate.ts`, `documentRules.ts` | `documentType=orcamento` |
| Composições / APU | `CatalogPage`, `CompositionDetailPage`, `api/catalog.ts`, `api/compositionTechnicalV2.ts` | `catalog.ts`, `costCompositions.ts`, `compositionV2Engine.ts`, `costEngine.ts` | |
| Cronograma / WBS | `ProjectSchedulePage`, `api/schedule.ts` | `schedule.ts`, `scheduleEngine.ts`, `schedulePlanning.ts` | |
| Procurement / stock | `ProjectProcurementPage`, `QuoteRequestsPage`, `api/purchasing.ts`, `api/procurement*.ts` | `purchasing.ts`, `procurement*.ts`, `quoteRequests.ts` | |
| Financeiro | `ProjectFinancialPage`, `api/financial.ts`, `api/clientPayments.ts` | `financial.ts`, `invoices.ts`, `clientPayments.ts`, `projectControl.ts` | |
| Diário | `ProjectSiteDiaryPage`, `api/siteDiary.ts` | `siteDiary.ts` | |
| Autos | `MeasurementCertificatePage`, `api/certificateFieldMeasurements.ts` | `measurementCertificates.ts`, `certificateFieldMeasurements.ts` | `/autos/:id` |
| Fornecedores | `SuppliersPage`, `api/suppliers.ts` | `suppliers.ts`, `adminSuppliers.ts` | |
| Comercial | `PracticeOfficePage`, `api/practice.ts` | `practice.ts`, `practiceLedger.ts` | `/escritorio` |
| Portal cliente | `PublicProjectPage`, `api/client.ts`, `api/clientPayments.ts` | `publicShare.ts`, `clientPayments.ts` | `/obra/:token` |
| Portal fornecedor | `apps/supplier/src/pages/*` | `supplierPortal.ts`, `supplierAuth.ts` | SPA separado `/fornecedor/` |
| Empresa / permissões | `CompanySettingsPage`, `ProfilePage` | `companies.ts`, `users.ts`, `accessControl.ts` | `/empresa` |
| Super-admin | `SuperAdminPage` | `companies.ts` (admin), `operationalHealth.ts`, `dashboard.ts` | `/admin` |
| Notificações / email / audit | `api/notifications.ts` | `notifications.ts`, `mailer.ts`, `auditTrail.ts`, `audit.ts` | SMTP opcional |

Rotas principais: `/painel`, `/medicoes`, `/orcamentos`, `/gestao`, `/projectos/:id`, `/documentos/:id`, `/plantas/:id`, `/autos/:id`, `/escritorio`, `/admin`.

## Migrations

Última no journal: **0078_performance_indexes** (idx 78). Ficheiros SQL em `apps/api/drizzle/0000`–`0078`. Sem migrations pendentes no código relativamente ao journal. Sem scripts `down`.

## Riscos de compatibilidade

- Plant-service em produção arranca via `nohup` (não systemd fiável); restart manual após parser bump.
- Cache PWA: `CACHE_EPOCH` em `apps/web/src/main.tsx` + `vite.config.ts`.
- Aprovação documentos: `planUsesDirectDocumentApproval` — Individual aprova directo; outros planos exigem submeter.
- SMTP/Sentry opcionais: email e monitorização podem estar desligados em prod.
- VPS não faz `git fetch`; deploy histórico por git bundle + SCP.
- `package-lock.json` na VPS já esteve dirty — checkout antes de pull.
- Parser version `PLANT_PARSER_VERSION` deve coincidir com `PARSER_VERSION` (varchar 40 + hash).
- Não destruir dados em rascunho/aprovado; workflows imutáveis após aprovação.

## Fase → ficheiros prováveis

| Fase | Ficheiros prováveis |
|---|---|
| 00 | `docs/refactor-2026-08/sigo-refactor-baseline.md` |
| 01 | `apps/web/src/pages/*`, `Layout.tsx`, `landing/*` |
| 02 | `notifications.ts`, `auth.ts`, `budgetDocuments.ts` (status) |
| 03–05 | `plants.ts`, `PlantReviewPage.tsx`, `plant-service/parser.py` |
| 06 | BOQ/plantas UI undo |
| 07 | `costCompositions.ts`, `CatalogPage.tsx` |
| 08 | `budgetDocuments.ts`, `boqEngine.ts`, `BudgetDocumentPage.tsx` |
| 09 | `DashboardPage.tsx`, `dashboard.ts`, `projectControl.ts` |
| 10 | `schedule.ts`, `scheduleEngine.ts`, `ProjectSchedulePage.tsx` |
| 11 | `procurement*.ts`, `ProjectProcurementPage.tsx` |
| 12 | `financial.ts`, `ProjectFinancialPage.tsx` |
| 13 | `siteDiary.ts`, `measurementCertificates.ts` |
| 14 | `practice.ts`, `PracticeOfficePage.tsx` |
| 15 | `apps/supplier/*`, `publicShare.ts`, `PublicProjectPage.tsx` |
| 16 | `companies.ts`, `accessControl.ts`, `CompanySettingsPage.tsx` |
| 17 | `App.tsx`, `Layout.tsx` |
| 18 | testes, `release-readiness.mjs`, `docs/refactor-2026-08/FINAL-REPORT.md` |

## Falhas preexistentes registadas

- Nenhuma falha nova nesta fase (só `build:shared`).
- Suite completa API/web não foi corrida aqui (fase 18). Plant-service Python usa `.venv` local.
- Alertas ops conhecidos: SMTP/Sentry vazios em produção; plant reviews já resolvidas em 13/08.

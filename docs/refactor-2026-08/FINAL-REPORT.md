# SIGO refactor — relatório final 2026-08-19

Fila nocturna 00–18. Base de auditoria: `0ec2f18`. Branch local `main`. **Sem push nem deploy.**

## Fases e commits locais

| Fase | SHA | Mensagem |
|---|---|---|
| 00 | `24550e1` | docs: baseline da fila de refactor 2026-08 |
| 01 | `08b31af` | chore(ui): remover copy pedagógica nas telas operacionais |
| 02 | `8bde02c` | feat: unificar aprovações com eventos, sino e email |
| 03 | `de003fd` | feat: auto-dismiss aviso de planta concluída |
| 04 | `2ce1042` | feat: manter o utilizador no levantamento após o assistente |
| 05 | `529bf31` | feat: quadro de pilares com betão, aço e alturas por piso |
| 06 | `c1e7f3a` | feat: sessão de edição BOQ com undo/redo e guardar em lote |
| 07 | `1587451` | feat: composições privadas, partilha e identidade por familyKey |
| 08 | `f33bf3a` | feat: proveniência no BOQ e comparação de revisões |
| 09 | `05ad009` | feat: painel como control tower com pendências priorizadas |
| 10 | `31a309e` | feat: CPM, lookahead e curva S no cronograma |
| 11 | `1151cc4` | feat: governação de fornecedores, scorecard e prazo de compra |
| 12 | `3b4a2a8` | feat: forecast EAC e ETC no financeiro da obra |
| 13 | `78e79d7` | feat: quantidades certificadas, variação e captura de foto no diário |
| 14 | `891655d` | feat: pipeline comercial com perda, métricas e fecho previsto |
| 15 | `635a8a6` | feat: decisões do cliente no portal e scorecard do fornecedor |
| 16 | `1ec474a` | feat: matriz de aprovação e preferências de email da empresa |
| 17 | `485da6d` | chore(ui): arquivo de cotações e labels de estado consistentes |
| 18 | `fc5a572` | chore: integra refactor transversal SIGO e release gates |

HEAD: `fc5a572`. Working tree de código limpa (só artefactos locais: `tmp/`, auditorias, scripts de arranque, pptx).

## Migrations (não destrutivas)

| Tag | Fase | Efeito |
|---|---|---|
| `0079_composition_ownership` | 07 | ownership/partilha de composições |
| `0080_vendor_governance` | 11 | `suppliers.governance_status`, bloqueio com motivo, `supplier_compliance_documents` |
| `0081_commercial_pipeline` | 14 | `practice_quotes.expected_close_date`, `loss_reason`, `owner_user_id` |
| `0082_client_change_decisions` | 15 | decisão do cliente em `contract_variations` (não altera BOQ) |
| `0083_company_notification_prefs` | 16 | `companies.email_notification_prefs` |
| `0084_company_approval_matrix` | pós-18 | `companies.approval_matrix` (jsonb) |
| `0085_company_vendor_governance` | pós-18 | override de governação marketplace por empresa |

Última no journal: **0085**. Sem `down`.

## Testes e gates (fase 18)

| Gate | Resultado |
|---|---|
| `npm run quality:release` | OK (aviso: árvore local com artefactos não rastreados) |
| `npm run build` (shared + api + web + supplier) | OK |
| `npm test` API | 54 ficheiros, 339 testes |
| `npm test` web | 10 ficheiros, 39 testes |
| `db:migrate` em produção | **não executado** (só local via vitest/globalSetup) |
| `npm run smoke:production` | **não executado** (requer VPS) |
| plant-service unittest | **não corrido nesta fase** |

Testes novos relevantes: `controlTower`, `scheduleCpm`, `vendorGovernance`, `projectForecast`, `certificateQuantities`, `approvalMatrix`, `commercial-pipeline`, `budgetRevisionDiff`, `measurementPrecision`, `boq-provenance`.

## O que ficou feito

- UI operacional sem copy pedagógica nas superfícies tocadas; estados normalizados (Rascunho / Submetido / Aprovado / Devolvido / Perdido).
- Aprovações com eventos, sino e email (fase 02); email de workflow desligável por empresa, sino crítico sempre ligado.
- Plantas: aviso temporário, permanência no levantamento, quadro de pilares.
- BOQ: undo/redo em lote, composições privadas/partilha, proveniência, diff de revisões.
- Painel: pendências priorizadas (segurança → financeiro → cronograma → material → documentação → info).
- Cronograma: CPM (ES/EF/LS/LF, float, crítico), lookahead 2/4/6 semanas, curva S em valor WBS sem misturar moedas.
- Procurement: fornecedor bloqueado não entra em RFQ/PO; scorecard OTIF só com ≥3 recebimentos (`Sem dados suficientes` caso contrário); `latestStartDate`.
- Financeiro: ETC = contratado − actual − committed (sem duplicar PO+factura); EAC = actual + ETC; margem ou indisponível.
- Autos: `measuredQty` / `proposedQty` / `certifiedQty` / `variationQty`; foto do diário com `capture="environment"`.
- Comercial: pipeline Lead→Projecto mapeado aos estados existentes; motivo de perda; métricas sem vanity.
- Portais: cliente `Progresso | Pagamentos | Fotos | Decisões`; aprovar/rejeitar adenda **não** escreve no BOQ — fica `client_decision` para o backoffice aplicar. Fornecedor vê scorecard insuficiente.
- Empresa: tabs Aprovações / Notificações; matriz default alinhada às rotas actuais.

## Gaps e riscos (revisão humana)

1. **CPM** continua calculado em leitura (durações + precedências + calendário Mon–Sáb), sem gravar ES/LF na BD.
2. **Decisões do portal** só aparecem para adendas `submetida`. Sem contrato/adenda, o tab fica vazio. Backoffice aplica via `POST .../apply-client-decision` (não escreve BOQ).
3. **Forecast de caixa** (4 semanas) no Financeiro reutiliza Procurement Intelligence; ETC/EAC no Control Tower sem FX implícito.
4. **0080–0085** sem snapshot Drizzle regenerado — `drizzle-kit generate` futuro deve partir do schema actual.
5. **SMTP/Sentry** opcionais; email pode estar desligado em produção.
6. Parser de plantas e PWA `CACHE_EPOCH` inalterados nesta cauda da fila.
7. `steelSource: "map"` não deve ser substituído por aço calculado (fase 05/08).
8. Bloqueio **global** de fornecedor marketplace (campo em `suppliers`) continua a afectar todos os tenants; o override por empresa (`company_vendor_governance`) só define a governação efectiva dessa empresa.

## Fecho de gaps (pós 18)

| Item | Notas |
|---|---|
| Control Tower `purchase_start_late` | Requisições abertas com `requiredByDate` fora do prazo seguro (lead+RFQ+aprovação+buffer) |
| Financeiro | KPIs ETC + caixa 4 semanas + margem / AR·AP |
| Comercial | Fecho previsto (`expectedCloseDate` / `validUntil`) na lista |
| Empresa | Matriz persistida + «Repor defaults»; Auto / medição / requisição / payment_request via `assertMatrixApproval` |
| Fornecedores | SIGO Preços: governação na ficha; marketplace: override por empresa (`0085`) em RFQ/PO |
| Portal → BO | «Aplicar decisão do portal» nas adendas do Financeiro |

## Deploy / migration (não executar agora)

1. Backup da BD.
2. `npm run db:migrate` em `apps/api` (aplica 0079–0085 se ainda não estiverem).
3. Build/restart API + web + supplier.
4. Só depois: `npm run smoke:production`.
5. Não fazer `git reset` / force-push sobre `0ec2f18` nem sobre estes commits.

# SIGO — Portas de qualidade da release

Uma versão só está pronta para produção quando todos os blocos abaixo passam. A compilação, por
si só, não constitui aprovação.

| Porta | O que comprova | Execução |
|---|---|---|
| Estrutura | Scripts, ambiente documentado, migrations e ausência de segredos no Git | `npm run quality:release` |
| Compilação | Shared, API, painel e portal do fornecedor compilam juntos | `npm run build` |
| Backend | Autenticação, papéis, empresas, catálogo, medição, orçamento, compras e financeiro | `npm run test --workspace=apps/api` |
| Frontend | Regras de apresentação e fluxos críticos testados | `npm run test --workspace=apps/web` |
| Leitor | Extração e regras do motor Python | `pytest -v` em `apps/plant-service` |
| Pré-deploy | VPS limpa, segura, com espaço e supervisores activos | `bash deploy/preflight.sh` |
| Pós-deploy | Release, website, assets, segurança, autenticação e dependências reais | `npm run smoke:production -- https://DOMINIO` |
| Operação | Filas, disco, backup, PostgreSQL e leitor continuam saudáveis | `bash deploy/status.sh` |

## Fluxos que bloqueiam uma release

- Empresa A nunca lê ou altera projectos, preços, compras ou financeiro da Empresa B.
- Um utilizador não executa operações fora do seu papel.
- Medições sem dados obrigatórios não podem ser aprovadas silenciosamente.
- Um orçamento aprovado mantém rastreabilidade e separação entre preparação e aprovação.
- Pedidos, recepções, stock, contas a pagar e pagamentos não duplicam movimentos.
- Recebimentos e notas de crédito respeitam idempotência e saldo.
- Migrações estão presentes antes de o código que depende delas ser activado.
- A release do HTML, assets e API é a mesma.
- Rotas privadas continuam protegidas depois da publicação.
- Backups existem e podem ser identificados antes de migrar a base.

## Resultado da decisão

- **Aprovado:** todas as portas obrigatórias passam.
- **Condicional:** apenas avisos documentados, sem risco de dados, segurança ou indisponibilidade.
- **Reprovado:** qualquer teste falha, existe segredo no Git, migration pendente, dependência crítica
  degradada ou smoke test público reprovado.

O deploy manual executa preflight, backup, build, migrations, readiness e smoke test. Se o smoke
test falhar, a release não é registada como aprovada e os builds anteriores são repostos.

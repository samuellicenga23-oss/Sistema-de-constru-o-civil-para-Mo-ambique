# SIGO — Baseline de segurança e preparação para produção

**Estado:** em implementação. Este documento é um plano técnico interno, não uma certificação de segurança.

## Decisão de lançamento

| Nível | Uso permitido |
|---|---|
| Hoje | Pilotos controlados, com validação humana de medições, preços e autos. |
| Após os bloqueadores | Venda a clientes privados com operação acompanhada. |
| Após validação externa | Operação alargada e candidaturas que exijam controlo contratual. |

O SIGO não deve ser apresentado como fonte final de verdade para quantidades extraídas automaticamente, aprovação contratual ou contabilidade certificada.

## Princípios obrigatórios

1. Uma empresa nunca lê, altera, exporta ou usa dados privados de outra.
2. Um documento aprovado é imutável; a alteração cria revisão.
3. Um valor financeiro deve explicar a sua origem e o seu aprovador.
4. A medição automática é uma sugestão rastreável, confirmada por técnico.
5. Backups só contam como backup depois de uma restauração testada.

## Achados tratados nesta etapa

| Achado | Risco | Correcção |
|---|---|---|
| Clonagem automática do catálogo aceitava qualquer UUID de origem. | Uma empresa podia copiar material, mão-de-obra, equipamento, composição ou zona privada de outra empresa. | As funções de clonagem aceitam apenas recursos globais (`company_id IS NULL`); zonas privadas ficaram bloqueadas. |
| Consulta de preços por zona podia usar um UUID de zona não visível. | Um preço de zona privada podia afectar a resposta de catálogo. | A zona é validada antes de consultar preços; a lista de preços é filtrada pela posse da zona. |

Os testes de regressão estão em `apps/api/test/isolation.test.ts`.

## Bloqueadores antes de venda alargada

### P0 — segurança e continuidade

- Implementar fila/worker isolado para leitura de plantas, com timeout, quotas, retentativas e cancelamento.
- Validar uploads além da assinatura do ficheiro: análise antimalware, limites por empresa e rejeição de PDFs anómalos.
- Criar backups cifrados fora da VPS e executar restauro de teste mensal.
- Monitorizar API, PostgreSQL, armazenamento, certificados, PM2 e plant-service com alertas.
- Criar auditoria imutável para alterações de orçamento, compra, stock, auto, financeiro e utilizadores.

### P1 — integridade de negócio

- Definir aprovação por valor e separação de funções para compras, autos e lançamentos financeiros.
- Bloquear/eliminar apenas por estorno ou revisão depois de aprovação; evitar remoção destrutiva de históricos.
- Registar a origem e a confiança de cada quantidade: planta, manual, Excel, regra técnica ou estimativa.
- Criar catálogo de casos de teste com plantas reais e medição de referência validada por técnico.

### P2 — confiança comercial e legal

- Termos de uso, política de privacidade, acordo de tratamento de dados e política de retenção.
- Processo de incidentes, exportação dos dados da empresa e eliminação contratual.
- Revisão jurídica do enquadramento de segurança cibernética, protecção de dados e contratação aplicável.
- Pentest independente, teste de carga e revisão de dependências antes de expansão nacional.

## Controlos que já existem

- Sessões em cookie HTTP-only, `sameSite=lax` e `secure` em produção.
- Passwords com bcrypt, expiração de sessão e gestão de sessões do utilizador.
- Rate limit no login.
- CORS fechado por omissão em produção sem origem explícita.
- Recursos de projecto e ficheiros privados verificados pela empresa autenticada.
- Documentos aprovados/submetidos bloqueados para edição.
- Stock não pode ficar negativo em saídas manuais e no diário.

## Validação mínima por release

1. Compilação completa.
2. Testes de autorização entre duas empresas.
3. Teste manual de cada perfil de utilizador.
4. Restauro de backup em ambiente isolado.
5. Verificação de health checks e logs após deploy.
6. Registo em `CHANGELOG_DEV.md` com migrações, rollback e resultado.

## Próxima execução técnica

1. Terminar a matriz de autorização por rota e perfil.
2. Criar testes negativos para projectos, orçamento, compras, autos, diário, ficheiros e catálogo.
3. Introduzir serviço/fila de processamento de plantas.
4. Implementar base de auditoria e aprovações.

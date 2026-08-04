# SIGO — Auditoria e aprovações operacionais

## O que esta etapa já entrega

- Tabela `audit_events` exclusivamente acrescentável, sem rotas de alteração ou eliminação.
- Registo de autoria, empresa, obra, entidade, acção, data e fotografia antes/depois quando existe.
- Histórico autenticado por obra em `GET /api/projects/:projectId/audit-events`; outra empresa recebe `404`.
- Eventos ligados, nesta primeira entrega, a mudanças de estado de Mapas de Quantidades,
  Autos de Medição e Ordens de Compra, e à criação, actualização e eliminação de movimentos
  financeiros e de stock manuais.

O evento preserva contexto operacional, não palavras-passe, cookies, tokens ou hashes.

## Matriz de decisão a implementar na próxima etapa

| Processo | Preparação | Submissão | Aprovação | Efeito automático |
| --- | --- | --- | --- | --- |
| Medição / orçamento | Orçamentista | Orçamentista | Admin da empresa ou perfil aprovador | Bloqueia edição e fixa versão |
| Auto de medição | Engenheiro/Fiscal ou Orçamentista | Engenheiro/Fiscal | Admin / aprovador contratual | Cria conta a receber pendente |
| Ordem de compra | Orçamentista | Orçamentista | Admin da empresa | Cria compromisso a pagar; recepção gera entrada em stock |
| Movimento de stock | Orçamentista | — | Não exige aprovação no MVP, mas exige motivo | Actualiza saldo da obra |
| Lançamento financeiro manual | Orçamentista | — | Admin para pagamento/baixa, acima de limite configurável | Actualiza fluxo de caixa |

Antes de aplicar esta matriz, o SIGO precisa de perfis de aprovação configuráveis por empresa
(valor limite, substituto, separação entre quem cria e quem aprova). Não se deve fingir que um
simples campo `status` é uma aprovação formal enquanto estas regras não existem.

## Salvaguardas ainda necessárias para produção crítica

1. Escrever a alteração de negócio e o evento de auditoria na mesma transacção de base de dados.
2. Guardar motivo obrigatório para devolução, cancelamento, baixa financeira e ajustes de stock.
3. Adicionar ecrã de histórico com filtros e exportação, mantendo-o só de leitura.
4. Impedir que o mesmo utilizador aprove a sua própria ordem/auto quando a política da empresa
   exigir segregação de funções.
5. Criar retenção, backup imutável e revisão periódica dos eventos de auditoria.

## Migração

`apps/api/drizzle/0031_concerned_mandrill.sql` cria a tabela de auditoria. Aplicar pela rotina
normal do SIGO (`npm run db:migrate --workspace=apps/api`) apenas no deploy aprovado, depois de
backup testado. Esta alteração ainda não foi aplicada à produção.

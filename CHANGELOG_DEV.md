# Registo de desenvolvimento — SIGA

Este ficheiro coordena o trabalho paralelo entre Codex e Claude. Antes de iniciar uma alteração,
consultar o estado do Git e as entradas mais recentes. Cada intervenção deve indicar branch,
âmbito, validação e estado de publicação.

## 2026-07-27 — Codex — Renovação visual, primeira fase

- **Branch:** `codex/siga-visual-refresh`
- **Âmbito:** sistema visual global, navegação, login, painel inicial e identidade SIGA.
- **Alterações:** nova paleta verde profunda inspirada em engenharia/construção; cartões, botões,
  campos, interacções e animação de entrada renovados; sidebar e navegação móvel redesenhadas;
  login com nova proposta de marca; painel com cabeçalho operacional e indicadores mais claros;
  referências visíveis em exportações e PWA actualizadas de SIGO para SIGA.
- **Preservado:** arquitectura React/Fastify, rotas, permissões, contratos da API e identificadores
  técnicos `@sigo/*`, para evitar uma migração estrutural insegura nesta fase.
- **Validação:** 12 testes do frontend aprovados; build de produção aprovado.
- **Produção:** ainda não publicada.

## 2026-07-27 — Codex — Correcção da direcção visual

- **Motivo:** a primeira proposta tinha excesso de padrões visuais associados a interfaces
  geradas por IA: gradientes, cartões flutuantes, decoração circular e texto promocional.
- **Referências analisadas:** Procore, Autodesk Construction Cloud e Fieldwire.
- **Nova direcção:** software empresarial de construção, com azul-marinho e superfícies neutras,
  laranja reservado às acções principais, cantos moderados, navegação previsível e maior densidade
  informativa.
- **Alterações:** simplificação do login, sidebar, cabeçalho, indicadores e introdução do painel;
  removidos brilhos, elevação excessiva, gradientes decorativos e linguagem promocional no produto.
- **Validação:** 12 testes do frontend aprovados; build de produção aprovado.
- **Produção:** ainda não publicada.

## 2026-07-27 — Codex — Renovação das áreas operacionais

- **Âmbito:** Projectos, detalhe do projecto, Catálogo, Financeiro, Compras/Armazém e Mapas de
  Quantidades.
- **Base comum:** novos componentes `SectionHeader`, `MetricCard` e `InlineNotice`, além de tabs e
  barras de ferramentas reutilizáveis.
- **Projectos:** pesquisa por nome/cliente/zona, indicadores de carteira e lista tabular responsiva.
- **Detalhe do projecto:** indicadores de documentos, plantas e autos; secções com cabeçalhos
  operacionais consistentes.
- **Catálogo:** separadores compactos, maior largura útil e barra de contexto de preços por zona.
- **Financeiro:** seis indicadores normalizados, fluxo de caixa e formulários com hierarquia clara.
- **Compras:** indicadores de stock e ordens, destaque para pendências e organização do fluxo de
  aprovação/recepção.
- **Documentos:** cabeçalhos de secção, importação organizada e resumo orçamental sóbrio com total
  destacado.
- **Validação:** 12 testes do frontend aprovados; build de produção aprovado.
- **Produção:** ainda não publicada.

## 2026-07-27 — Codex — Nova navegação lateral

- **Referências:** Linear (interface 2026), Shopify Polaris e nova navegação Atlassian/Jira.
- **Direcção:** sidebar neutra e secundária ao conteúdo, em vez do bloco azul-marinho dominante.
- **Alterações:** fundo claro, largura reduzida, modo recolhido, marca compacta, empresa mostrada como
  contexto de trabalho, itens agrupados em Trabalho/Operações/Administração, rótulos mais curtos,
  estado activo discreto com acento laranja e perfil integrado no rodapé.
- **Mobile:** gaveta lateral actualizada para a mesma linguagem clara.
- **Validação:** 12 testes do frontend aprovados; build de produção aprovado.
- **Produção:** ainda não publicada.

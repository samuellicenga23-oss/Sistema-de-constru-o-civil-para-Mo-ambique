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

## 2026-07-27 — Codex — UX funcional, fase 1

- **Referências:** Autodesk Build Project Home e navegação por ferramentas, Fieldwire e Buildertrend.
- **Problema corrigido:** cada módulo abria como uma página isolada e as acções da obra competiam
  no cabeçalho, sem continuidade de contexto.
- **Navegação da obra:** novo menu persistente entre Visão geral, Diário de obra, Compras/stock e
  Financeiro, com estado activo e comportamento responsivo.
- **Orientação:** a visão geral recomenda dinamicamente o próximo passo com base em documentos,
  plantas e autos existentes.
- **Criação de projecto:** formulário transferido para modal focado, com dados essenciais e
  cancelamento claro.
- **Acções destrutivas:** eliminação de projecto passou de `window.confirm` para confirmação
  contextual, não bloqueante e com estado de processamento.
- **Validação:** 12 testes do frontend aprovados; build de produção aprovado.
- **Produção:** ainda não publicada.

## 2026-07-27 — Codex — Integração de custos e prontidão das medições

- **Objectivo:** tornar explícita a cadeia fornecedor → material → zona → composição → orçamento
  e impedir estimativas automáticas sem diagnóstico prévio dos dados em falta.
- **Cotações:** a API do Catálogo passa a resolver a melhor cotação de fornecedor aplicável à
  zona; cotações específicas da zona vencem cotações gerais e, no mesmo nível, vence o menor
  preço.
- **Segurança de custos:** a cotação é apresentada como sugestão de mercado e nunca substitui
  silenciosamente o preço do Catálogo. O utilizador precisa seleccionar “Adoptar”; só então o
  preço passa a alimentar composições e novos snapshots de orçamento.
- **Catálogo:** materiais mostram fornecedor, cotação, âmbito geral/específico da zona e acção de
  adopção.
- **Obra:** novo painel “Cadeia de custos” mostra em ordem a zona, cobertura de cotações, cobertura
  de preços adoptados e composições disponíveis.
- **Medições:** o Assistente começa com diagnóstico de prontidão em oito grupos: compartimentos,
  perímetros/pés-direitos, fundações, vigas, lajes, aço, redes hidráulicas e preços críticos.
- **Plantas:** ficheiros cujo processamento falhou passam a oferecer “Tentar novamente”, usando o
  PDF já guardado, sem obrigar o utilizador a procurar e carregar o ficheiro outra vez.
- **Transparência:** cada ausência explica o impacto e o rácio que seria usado; o utilizador pode
  prosseguir conscientemente e os pressupostos continuam identificados no relatório final.
- **Persistência:** nenhuma migração necessária; diagnóstico e cotações são derivados das relações
  PostgreSQL já existentes.
- **Validação:** build completo de shared/API/web aprovado; 12 testes do frontend aprovados.
- **Produção:** ainda não publicada.

## 2026-07-27 — Codex — Fecho da cadeia catálogo, orçamento e compras

- **Objectivo:** garantir que fornecedor, cotação, zona, catálogo, composição, orçamento, ordem de
  compra e stock formam um fluxo controlado, sem preços implícitos ou alterações retroactivas.
- **Orçamentos:** nova operação `POST /api/budget-documents/:id/reprice` recalcula apenas itens
  associados a composições, usando a zona actual da obra. O lote é validado antes da gravação e
  actualizado numa transacção; dados em falta impedem alterações parciais.
- **Controlo documental:** o recálculo é sempre iniciado pelo utilizador e só funciona em rascunhos.
  Documentos submetidos/aprovados mantêm o snapshot original e exigem nova revisão.
- **Interface do orçamento:** novo painel explica a origem dos preços, conta itens ligados a
  composições, desactiva a acção quando o documento só tem preços manuais, pede confirmação e
  mostra quantos itens e qual total foram alterados.
- **Compras por zona:** ao escolher fornecedor/material, a ordem usa primeiro a cotação da zona da
  obra e depois a cotação geral. Entre opções equivalentes usa a mais económica.
- **Segurança monetária:** uma cotação noutra moeda deixou de ser renomeada silenciosamente para a
  moeda da obra; o sistema identifica a incompatibilidade e pede um preço convertido/manual.
- **Orientação:** obras sem zona recebem aviso claro; empresas sem fornecedores recebem ligação
  directa para registar fornecedor e cotações.
- **Validação funcional:** login, cadeia de custos, confirmação de recálculo, compras e diagnóstico
  de medições verificados no ambiente local. O diagnóstico apresentou 8 grupos de prontidão e
  identificou explicitamente os dados estruturais e hidráulicos em falta.
- **Validação técnica:** 22 testes da API e 12 testes do frontend aprovados; build completo de
  shared/API/web aprovado.
- **Persistência:** nenhuma migração de base de dados necessária.
- **Produção:** ainda não publicada.

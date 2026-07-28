# Registo de desenvolvimento — SIGO

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

## 2026-07-27 — Codex — Percurso directo dos projectos técnicos às medições

- **Objectivo:** retirar a estrutura manual do caminho principal e transformar o processo em
  projecto → análise dos PDFs → confirmação → diagnóstico de lacunas → medição/orçamento.
- **Criação da obra:** o formulário de novo projecto aceita logo a planta de arquitectura e o
  projecto estrutural. Quando há ficheiros, abre directamente a revisão do que foi extraído;
  quando ainda não há, leva à área de carregamento, sem abrir o orçamento manual.
- **Visão geral da obra:** novo percurso visual de quatro etapas com estado real, chamada de acção
  única e acesso à última análise. O carregamento posterior também abre imediatamente a revisão.
- **Revisão da planta:** apresenta a confirmação como passo 2, lista de forma explícita tudo o que
  não pôde ser extraído e segue directamente para o diagnóstico das medições.
- **Mapa automático seguro:** novo `POST /api/projects/:id/measurement-workspace` reutiliza apenas
  um rascunho MZN com a estrutura SIGA compatível; documentos importados/manuais nunca são
  escolhidos por coincidência de código. Quando necessário, cria o mapa automático em segundo
  plano, sem expor a construção de capítulos ao utilizador.
- **Compatibilidade:** a API valida códigos e descrições sentinela da estrutura padrão antes de
  aplicar quantidades. Um documento incompatível devolve conflito orientado e permanece intacto.
- **Moeda:** custos automáticos do catálogo deixam de poder ser rotulados como USD sem conversão.
  Mapas automáticos usam MZN; documentos externos/manuais em USD continuam permitidos e separados.
- **Custos no assistente:** removida a edição escondida do catálogo dentro da medição. O passo
  “Custos” é só de leitura e mostra o preço efectivo de cimento, aço e bloco e a sua origem — zona
  do projecto ou preço base aprovado.
- **Nota anterior:** a mensagem laranja/vermelha sobre “apenas preços manuais” foi substituída por
  um estado neutro “Documento com preços próprios”, que explica a preservação do documento e
  oferece preparar uma medição automática separada.
- **Opções avançadas:** criação manual de secções e importação Excel passaram para um bloco
  recolhido. A importação declara correctamente que altera apenas quantidades e preserva preços e
  ligações existentes.
- **Validação funcional no browser:** confirmado o percurso da obra Dona Mayza desde “Preparar
  medições” até ao diagnóstico; dados arquitectónicos pré-preenchidos, oito verificações de
  prontidão, custos efectivos por zona/base, documento USD preservado e ausência da nota antiga.
  Sem erros de consola.
- **Validação técnica:** build completo de shared/API/web aprovado; 25 testes da API e 12 do
  frontend aprovados. Três novos testes cobrem moeda MZN do mapa automático, recusa de estrutura
  automática USD e protecção de documentos manuais incompatíveis.
- **Persistência:** nenhuma migração de base de dados necessária.
- **Produção:** ainda não publicada.

## 2026-07-27 — Codex — Correcção dos modais em páginas longas

- **Problema observado:** ao escolher “Preparar medição pelas plantas” ou abrir o Assistente num
  Mapa de Quantidades longo, a camada escura aparecia, mas o painel ficava centrado fora da área
  visível e escondido por baixo do cabeçalho.
- **Causa:** a animação aplicada ao conteúdo principal cria um contexto próprio de posicionamento
  e empilhamento; os painéis `position: fixed` deixavam de usar directamente o viewport.
- **Correcção:** novo `ModalPortal` renderiza os painéis no `body`, acima da aplicação e separado
  da altura do orçamento. Aplicado ao Assistente de Medições, Materiais por Fase, Relatório de
  Cálculos, diálogos de confirmação, formulários genéricos e mudança de palavra-passe.
- **Regressão:** o teste de componentes confirma que a camada modal é montada directamente no
  `body`, impedindo que volte a ficar presa dentro do conteúdo animado.
- **Validação funcional:** reproduzido no documento `281c6729-1347-4e4e-ac78-5f54d4751994`;
  depois da correcção, o Assistente ficou entre 36 px e 684 px num viewport de 720 px, com
  cabeçalho, conteúdo e acções visíveis. Sem erros de consola.
- **Validação técnica:** 12 testes do frontend e build completo de shared/API/web aprovados.
- **Produção:** ainda não publicada.

## 2026-07-27 — Codex — Operação integrada, autos genuínos e cronograma A3

- **Objectivo:** fechar a cadeia operacional entre composições, cotações, orçamento, cronograma,
  compras, stock, Diário de Obra, Autos de Medição e financeiro. Nenhuma destas áreas deve voltar a
  ser uma ilha de dados.
- **Aprovisionamento automático:** o mapa aprovado é decomposto pelas composições e pelas fases da
  obra. Para cada material, o SIGA compara necessidade total, consumo já aplicado, saldo em stock e
  ordens abertas; a sugestão respeita embalagem comercial e não volta a comprar material já
  consumido.
- **Fornecedor e zona:** a sugestão escolhe primeiro a cotação exacta da zona, depois a cotação geral
  mais económica e só usa o Catálogo como fallback. Materiais sem composição são apresentados como
  pendência, em vez de aparecer uma falsa cobertura total.
- **Compras e cronograma:** as necessidades são associadas automaticamente à primeira actividade da
  fase correspondente. Ao preparar a ordem, vêm preenchidas a actividade e a data em que o material
  deve estar na obra; a API valida que a tarefa pertence ao mesmo projecto.
- **Stock e Diário:** receber uma ordem cria entradas de stock idempotentes na data real de recepção.
  O Diário permite declarar consumos estruturados e cria as saídas correspondentes, bloqueando
  quantidades sem saldo. Movimentos automáticos não podem ser eliminados fora do documento de origem.
- **Financeiro:** aprovar uma ordem cria uma conta a pagar; aprovar um Auto cria uma conta a receber.
  Ambos são idempotentes e ficam protegidos contra alteração ou eliminação manual, mantendo a origem
  documental. O utilizador apenas confirma o pagamento ou regista movimentos excepcionais.
- **Autos de Medição:** o campo editável passa a ser a quantidade do período. O acumulado nasce
  exclusivamente do último Auto aprovado; excedentes exigem justificação e um novo Auto só pode ser
  criado depois de o anterior estar aprovado. Fluxo explícito rascunho → submetido → aprovado, com
  devolução fundamentada e documentos aprovados imutáveis.
- **Cronograma:** nova área com WBS gerada a partir dos capítulos do orçamento, calendário de obra de
  segunda a sábado, linha de base, durações ponderadas pelo valor, dependências FS/SS/FF/SF, estados e
  progresso. Autos aprovados e registos do Diário alimentam automaticamente o progresso físico; o
  valor medido continua separado e vem apenas dos Autos aprovados.
- **PDF A3:** exportação horizontal inspirada na leitura operacional do MS Project, com cabeçalho do
  projecto, métricas, tabela WBS, datas, duração útil, barras de base/progresso, meses e legenda. O PDF
  final foi renderizado e inspeccionado visualmente; confirmou-se 1 página em formato A3
  (1191,12 × 841,92 pt) para o cronograma de validação com 9 actividades.
- **Cálculos Rápidos:** Laje, Betão e composição genérica aceitam zona de preços, carregam materiais e
  composições do Catálogo e mostram preço unitário, origem e custo total também no PDF.
- **Persistência:** nova migração `0022_low_smiling_tiger.sql`, com tarefas/dependências, progresso do
  Diário, origem documental financeira, ligação de stock ao Diário e campos adicionais de Autos e
  ordens de compra.
- **Validação funcional:** revistos no browser Diário, ligação de actividade, necessidades de compra,
  ordem ligada ao cronograma, Financeiro sincronizado, Auto com excedente justificado, Cálculos
  Rápidos por zona e Gantt. A migração local pendente que causava `Erro 500` no Diário foi aplicada e
  o fluxo foi retestado sem o erro.
- **Validação técnica:** build completo de shared/API/web aprovado; 30 testes da API e 12 do frontend
  aprovados. Os novos testes cobrem acumulados/excedentes dos Autos, distribuição/calendário do
  cronograma e prevenção de recompra após consumo.
- **Produção:** ainda não publicada; as alterações permanecem na branch de trabalho para revisão.

## 2026-07-27 — Codex — Website público, planos comerciais e cronograma hierárquico

- **Website antes do login:** a rota `/` deixou de abrir o painel privado e passou a apresentar o
  novo site comercial do SIGA. O painel autenticado encontra-se agora em `/painel`; login, menu,
  permissões e retorno do Google OAuth foram actualizados para essa rota.
- **Direcção visual:** página editorial, responsiva e sem fotografias genéricas no conteúdo, com
  paleta marfim/navy/laranja, demonstração visual do produto, proposta de valor, fluxo operacional,
  contactos e navegação móvel. A composição tomou como referência os padrões actuais de clareza de
  produto e preços de Procore, Buildertrend, Fieldwire e Buildxact, sem copiar textos ou layouts.
- **Planos sugeridos:** Fundamento por `4.900 MZN/mês` (3 obras, 5 utilizadores), Profissional por
  `12.900 MZN/mês` (15 obras, 20 utilizadores) e Empresa por `29.900 MZN/mês` (50 obras,
  utilizadores ilimitados), com proposta de 15% de desconto anual. O Profissional é destacado como
  recomendação comercial.
- **Conversão comercial:** todos os planos abrem uma mensagem já preparada para o WhatsApp
  `+58 846 63 84 194` (`wa.me/588466384194`) e têm alternativa por email para
  `licsenga.samuel@mechanical.co.mz`. A página final repete os dois contactos.
- **Partilha social:** novo `apps/web/public/og-siga.png`, gerado especificamente para a marca, e
  metadados Open Graph/Twitter no `index.html` para uma apresentação cuidada ao partilhar o domínio.
- **Cronograma WBS:** ao gerar/recriar a linha de base, cada capítulo do Mapa de Quantidades passa a
  ser uma actividade principal e os nós imediatamente abaixo tornam-se subactividades. As durações
  respeitam mínimos por nível e são distribuídas pelo peso financeiro; dependências FS são criadas
  dentro de cada grupo e entre as actividades principais.
- **Edição do plano:** novos comandos para criar actividade principal ou subactividade, selector de
  nível WBS, edição do código, recolher/expandir grupos, indentação visual e resumo automático. Uma
  actividade principal com filhos recebe datas, duração, estado e progresso a partir das
  subactividades e não permite edição manual desses valores agregados.
- **Integridade:** a API valida que o pai pertence à mesma obra, impede auto-referência, limita a WBS
  a um nível de subactividades e impede mover um resumo já estruturado. Tarefas são devolvidas na
  ordem pai → filhos, incluindo subactividades adicionadas posteriormente.
- **Valores sem duplicação:** totais e progresso global usam apenas o primeiro nível agregado. O
  detalhe não duplica o valor do orçamento; cronogramas antigos e actividades manuais continuam a
  preservar o valor do capítulo. A sugestão de compras prefere a tarefa executável da fase em vez
  do resumo.
- **PDF A3:** actividades principais recebem estilo de resumo, subactividades ficam indentadas e as
  barras-resumo têm leitura própria. Cabeçalhos repetem em várias páginas e as linhas evitam quebra
  a meio.
- **Compatibilidade:** cronogramas já existentes continuam válidos, mas só recebem as
  subactividades automáticas depois de o utilizador escolher **Recriar WBS e linha de base**; essa
  acção continua a pedir confirmação porque substitui o plano actual.
- **Ambiente local:** frontend fixado em `http://127.0.0.1:5273`, com porta estrita, para evitar o
  erro anterior de ligação local e não mudar silenciosamente de endereço.
- **Validação:** build completo de shared/API/web aprovado; 31 testes da API e 12 do frontend
  aprovados. Website verificado no browser em desktop e 390 px, incluindo menu móvel, contactos e
  três planos. Cronograma, selecção, editor WBS e PDF A3 verificados sem erros de consola.
- **Persistência:** nenhuma nova migração; `parent_id` já fazia parte da migração `0022`.
- **Produção:** ainda não publicada; as alterações permanecem na branch de trabalho para revisão.

## 2026-07-27 — Codex — Publicação do website e cronograma na produção

- **GitHub:** a branch `codex/siga-visual-refresh` foi integrada por fast-forward no `main`, sem
  conflitos ou commits paralelos por incorporar. Versão funcional publicada: `0814f4f`.
- **VPS:** checkout `/home/sigo/htdocs/sud30s.org` actualizado para o `main`, build completo de
  shared/API/web concluído e API recarregada no PM2 com estado `online`.
- **Base de dados:** backup anterior ao deploy guardado em
  `/home/sigo/backups/sigo-predeploy-20260727-fa41876.dump`; migração `0022` aplicada com sucesso.
- **Preservação do servidor:** a diferença local do `package-lock.json`, causada pelo npm da VPS,
  foi guardada em `/home/sigo/backups/package-lock-predeploy-fa41876.patch` antes de restaurar o
  ficheiro versionado e actualizar por fast-forward.
- **Plant-service:** o serviço permaneceu activo; a única diferença de Python desta publicação era
  o título interno `SIGO` → `SIGA`, sem alteração de processamento ou API, pelo que não exigiu
  interrupção funcional.
- **Validação:** `http://127.0.0.1:4100/api/health` e `https://sud30s.org/api/health` responderam
  `status: ok`; página pública, três planos, contactos e ecrã de login foram verificados no domínio
  HTTPS sem erros de consola.
- **Produção:** `https://sud30s.org` está publicada com o novo website público e o sistema privado
  em `/painel`.

## 2026-07-28 — Codex — Website editorial e cronograma adaptativo

- **Branch:** `codex/siga-visual-refresh`.
- **Referências:** Procore, Fieldwire, PlanRadar, Buildertrend e orientação oficial do Microsoft
  Project para grelha Gantt, tarefas-resumo, subtarefas, níveis de detalhe e escala temporal.
- **Website público:** a página deixou a sequência linear de cartões e passou a apresentar uma
  demonstração navegável do produto em Custos, Planeamento e Execução, casos por perfil
  (Construtora, Fiscalização e Dono da obra), cadeia de decisão, planos mensais/anuais e FAQ.
- **Conversão:** planos e contactos anteriores foram preservados; o selector anual calcula e
  explica o desconto de 15%, e os pedidos continuam a abrir WhatsApp ou email já preenchidos.
- **Partilha social:** criada a capa `og-siga-v2.png`, coerente com a nova mensagem “Da estimativa
  à obra, tudo ligado”, e actualizados os metadados Open Graph.
- **Cronograma:** a grelha WBS passou a usar linhas compactas, árvore visual contínua para
  subactividades, fases-resumo claramente diferenciadas, controlo global para expandir/recolher,
  escala temporal compacta/normal/detalhada, linha do dia e editor organizado por contexto.
- **PDF adaptativo:** o utilizador pode escolher folha automática, A3, A2 ou A1 e ajustar todo o
  cronograma à folha ou usar escala manual de 100%, 85%, 70% ou 55%. No modo automático, a API
  escolhe a menor folha confortável conforme número de tarefas e duração; o nome do ficheiro e os
  cabeçalhos indicam folha e escala efectivas.
- **Regressão:** novo teste cobre selecção A3/A2/A1 e redução de escala em cronogramas densos.
- **Validação funcional:** website revisto no browser em desktop e 390 px; abas, menu móvel e
  alternância mensal/anual confirmados. Cronograma revisto com fase e subactividade reais;
  recolher/expandir confirmado e PDF A2 a 70% gerado com sucesso.
- **Validação técnica:** build completo de shared/API/web aprovado; 32 testes da API e 12 do
  frontend aprovados.
- **Persistência:** nenhuma migração de base de dados necessária.
- **Produção:** pronta para publicação após confirmação de que o `main` remoto não recebeu uma
  alteração paralela.

## 2026-07-28 — Codex — Publicação da revisão editorial e PDF adaptativo

- **GitHub:** `main` e `codex/siga-visual-refresh` actualizados com a versão funcional `9cc9032`;
  o `main` remoto estava exactamente em `44b84a8`, sem alterações paralelas do Claude por integrar.
- **VPS:** `/home/sigo/htdocs/sud30s.org` actualizado por fast-forward, build completo concluído e
  processo `sigo-api` recarregado no PM2 com estado `online`.
- **Base de dados:** nenhuma migração necessária e nenhum dado de produção alterado por esta
publicação.

## 2026-07-28 — Codex — Identidade SIGO, planos anuais e governação de acessos

- **Branch:** `codex/siga-visual-refresh` (mantida para compatibilidade com o trabalho já publicado).
- **Identidade:** nome público corrigido para **SIGO — Sistema Integrado de Gestão de Obras** na
  landing page, login, navegação, PWA, serviços e exportações PDF; identificadores técnicos
  `@sigo/*` permanecem inalterados.
- **Landing:** contacto WhatsApp corrigido para `+258 86 638 4194`; a vista anual passa a mostrar o
  total efectivo por ano com 15% de desconto e a poupança anual, em vez do equivalente mensal;
  novo cartão social Open Graph `og-sigo-v3.png`.
- **Gestão de utilizadores:** novo painel de equipa com pesquisa, filtros, consumo do plano, estado,
  último acesso, método de autenticação, edição de nome/perfil, suspensão/reactivação e redefinição
  de palavra-passe temporária.
- **Segurança:** contas suspensas deixam imediatamente de autenticar e perdem as sessões activas;
  novos acessos e palavras-passe redefinidas exigem troca no primeiro acesso; o próprio utilizador
  não pode alterar o seu perfil/estado e a empresa não pode ficar sem administrador activo.
- **Histórico:** utilizadores que já entraram deixam de ser eliminados; são desactivados para manter
  autoria, aprovações e referências das obras.
- **Contexto entre módulos:** o Painel apresenta agora a ordem operacional preços/composições →
  orçamento → cronograma → compras/campo → Autos/financeiro.
- **Persistência:** migração `0023_tricky_nocturne.sql` adiciona `users.is_active` e
  `users.must_change_password`, com valores seguros para as contas existentes.
- **Validação:** build completo aprovado; 35 testes da API e 12 testes do frontend aprovados;
  landing, preços anuais, WhatsApp e gestão da equipa verificados no navegador local.
- **Produção:** publicada em `https://sud30s.org` no commit `05cde21`; backup PostgreSQL criado
  antes da migração, migração aplicada, PM2 reiniciado e API/landing verificadas via HTTPS.
- **Validação:** a API interna respondeu `status: ok`; o novo website foi confirmado em
  `https://sud30s.org` com a mensagem, navegação e demonstração novas, sem erros de consola.
- **Produção:** revisão disponível em `https://sud30s.org`; sistema privado continua em `/painel`.

## 2026-07-28 — Codex — Engenharia de custos e catálogo auditável

- **Branch:** `codex/siga-visual-refresh` (sincronizada com `origin/main` antes da intervenção).
- **Pesquisa:** estrutura funcional contrastada com SINAPI/CAIXA e IBGE, RICS NRM, Autodesk Build,
  Procore, CYPE e publicações oficiais do INE de Moçambique sobre preços de insumos de construção.
- **Materiais:** nova ficha técnica com código, categoria, especificação, unidade de medição e de
  compra, conteúdo da embalagem, perda padrão, factor de importação, origem/data do preço, IVA,
  referência documental, estado activo e preço efectivo explicado.
- **Mão-de-obra:** custo/hora passa a considerar horas produtivas, encargos sociais e custos
  complementares, mantendo compatibilidade com a fórmula anterior quando esses dados não estão
  definidos; cada categoria suporta código, fonte, vigência e activação.
- **Zonas:** província, distrito, âmbito e fonte passam a acompanhar os factores de materiais,
  transporte, mão-de-obra e equipamento. Preços específicos documentados prevalecem; na ausência
  deles, o motor aplica os factores gerais da zona ao preço base de forma explícita.
- **Composições:** nova revisão numerada, código, descrição, critério de medição/pagamento,
  condições de execução, fonte, perdas por material e separação entre custo directo, auxiliares,
  indirectos e margem. Um indicador de qualidade mostra o que falta antes do uso comercial.
- **Integração:** a explosão de materiais usada por compras/stock passa a considerar a perda da
  composição; documentos existentes mantêm os snapshots de preço já gravados.
- **Persistência:** migração `0024_dark_micromacro.sql` adiciona os metadados técnicos e financeiros
  sem remover ou recalcular dados existentes.
- **Validação:** build completo aprovado; 38 testes da API e 12 do frontend aprovados, incluindo
  regressões para custo horário carregado e formação sequencial do preço.
- **Produção:** publicada em `https://sud30s.org` no commit `3678897`; `main` remoto não tinha
  alterações paralelas por integrar. Backup PostgreSQL criado em
  `/home/sigo/backups/sigo-predeploy-20260728-3678897.dump`, migração `0024` aplicada, build da
  VPS concluído, processo `sigo-api` recarregado e saúde interna/HTTPS confirmada.

## 2026-07-28 — Codex — Progresso real da análise de plantas

- **Problema:** a criação do projecto mantinha uma única chamada aberta até o analisador terminar;
  o utilizador via apenas “A processar”, embora o PDF estivesse a avançar página por página.
- **Serviço de plantas:** novo fluxo NDJSON transmite a página actual e o total de páginas durante
  a extracção, sem inventar uma percentagem baseada apenas no tempo.
- **API:** cada planta recebe o identificador antes da análise e grava percentagem, etapa, página
  actual/total e instantes de início/actualização. O upload continua protegido e só termina quando
  a análise e a gravação dos resultados estiverem concluídas.
- **Interface:** o modal “Novo projecto”, o carregamento dentro da obra e o reprocessamento mostram
  percentagem, barra de progresso, etapa corrente, nome do ficheiro e página em leitura. Quando são
  enviados arquitectura e estrutura, apresenta também o progresso global dos dois ficheiros.
- **Diagnóstico de produção:** os dois ficheiros mais recentes do projecto submetido pelo utilizador
  terminaram com estado `concluido`; o defeito estava na falta de feedback intermediário, não numa
  planta permanentemente bloqueada.
- **Persistência:** migração `0025_puzzling_gwen_stacy.sql` adiciona os campos de progresso sem
  alterar resultados de plantas existentes.
- **Validação:** build completo aprovado; 38 testes da API e 12 do frontend aprovados; parser Python
  validado com PDF sintético de três páginas e eventos reais `1/3`, `2/3`, `3/3`.
- **Produção:** pronta para publicação depois da verificação final do `main` remoto.

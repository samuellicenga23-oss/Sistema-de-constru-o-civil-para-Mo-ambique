# Script Cursor — Comercial Avançado SIGO

Fonte: `Comercial Avançado SIGO.pdf` (G. Comercial avançado — Projectos, Consultoria, Fiscalização, Equipa e Honorários).

Copia o bloco **Prompt** para um chat Agent novo. O agente deve implementar por fases e não misturar honorários profissionais com empreitada.

---

## Prompt (copiar daqui)

```
# Comercial Avançado SIGO — implementar conforme especificação

## Contexto técnico
Monorepo: C:\Users\Expert Sam\Documents\MediObra
- Web: apps/web · API: apps/api (Fastify + Drizzle)
- Módulo: key `practice`, rota `/escritorio`, permissões `escritorio.ver` / `escritorio.gerir`
- UI actual: PracticeOfficePage.tsx, api/practice.ts
- API: routes/practice.ts, services/practiceDocumentPdf.ts
- Já existe: clients, quotes (+ aceitação/desconto), quote_lines.phase, series PRO/FT/RC, engagements, milestones, invoices, receipts, PDF básico, painel aging

NÃO editar planos em `.cursor/plans/`. NÃO portal do cliente, Stripe, e-assinatura, SAF-T/AT.

## Princípio de produto (obrigatório)
O Comercial NÃO é só emitir cotações. Deve gerir o ciclo:

Cliente → Oportunidade → Proposta → Negociação → Aceitação → Contrato → Equipa → Cronograma → Entregáveis → Honorários → Cobrança → Rentabilidade → Encerramento

Dois fluxos DISTINTOS:
A) Serviços profissionais (arquitectura, engenharia, fiscalização, consultoria):
   Comercial → Contrato → Gestão de Serviço → Honorários → Cobrança
B) Execução de obra:
   Comercial → Medição/Orçamento → Proposta → Contrato → Obra SIGO
   NUNCA digitar preço global de empreitada no Comercial sem medição/orçamento.

## Implementar por FASES. Completa cada fase antes da seguinte.

---

### FASE 1 — Tipos de serviço + assistente de proposta (prioridade máxima)

1) Ao criar proposta, seleccionar **tipo de serviço**:

**Projectos:** Arquitectura; Estrutural; Hidrossanitário; Eléctrico; AVAC; SCI; Telecom/IT; Drenagem; Arranjos exteriores; Especialidade personalizada; Completo Arquitectura+Especialidades; Projecto Base/Estudo Preliminar; Compatibilização.

**Serviços técnicos:** Fiscalização de Obra; Gestão/Coordenação de Projecto; Assistência Técnica; Consultoria Técnica; Levantamento Arquitectónico/Técnico; Avaliação/Diagnóstico; Revisão de Projecto; Preparação Documentação; Outro personalizado.

**Construção:** Execução de Obra — REGRA BLOQUEANTE:
- Não permitir preço global manual.
- Mostrar: «Para elaborar proposta de execução é necessário efectuar primeiro Medição e Orçamento.»
- Botões: Criar nova Medição · Abrir Medições · Associar Medição existente.
- Valor nasce de Medições/Orçamentos. Comercial só apresenta comercialmente o resultado.

2) **Assistente em 7 passos:**
- Passo 1 Cliente (seleccionar/criar; mostrar nome, empresa, telefone, email, NUIT, localização, contacto)
- Passo 2 Tipo de serviço
- Passo 3 Dados do projecto (designação, tipo obra, localização, dono obra, área estimada, nº pisos, descrição, observações, data início prevista, prazo pretendido — nem todos obrigatórios)
- Passo 4 Escopo: carregar itens sugeridos do template; incluir/excluir/editar/apagar/adicionar/reorganizar/valores/prazos
- Passo 5 Honorários: global | por fase | por especialidade | mês | visita | hora | dia | qtd×PU | % | personalizado
- Passo 6 Condições: validade, prazo, pagamento, nº revisões, observações, exclusões, impostos, desconto, despesas reembolsáveis, notas
- Passo 7 PDF profissional

3) **Templates com itens sugeridos** (editáveis) pelo menos para:
- Projecto de Arquitectura (levantamento, estudo preliminar, anteprojecto, projecto, entrega + opcionais 3D/licenciamento/assistência)
- Projecto Estrutural
- Hidrossanitário
- Eléctrico
- Completo multi-especialidade (subtotal por especialidade + total; desconto global/por especialidade; especialidade oferecida/excluída)
- Fiscalização (mensal/semanal/visita/global/etapa; nº visitas, frequência, duração, deslocações)
- Consultoria (hora/dia/visita/sessão/mês/actividade/entregável/global)

4) Biblioteca de textos comerciais editáveis (prazo, validade, alterações, infos cliente, serviços adicionais, revisões, pagamentos, início trabalhos) — inserir no PDF.

5) PDF profissional (não só tabela): logo, dados empresa, nº, data, validade, cliente, identificação projecto, assunto, introdução, objecto, âmbito, fases, entregáveis, exclusões, cronograma, honorários, plano pagamento, condições, aceitação, assinaturas, rodapé.

6) Schema/API conforme necessário: serviceType, project fields na quote, pricingMode, conditions JSON, line included flag, specialty grouping. Migração 0048+.

Critérios Fase 1:
[ ] Criar proposta arquitectura / estrutural / hidráulica / eléctrica / multi-especialidade / fiscalização / consultoria
[ ] Cada tipo com itens sugeridos editáveis
[ ] Assistente 7 passos
[ ] PDF com texto profissional
[ ] Execução de obra bloqueada sem medição
[ ] Serviços profissionais NÃO exigem passar por Medições

---

### FASE 2 — Contrato, equipa, honorários e rentabilidade

Após aceitação da proposta:
1) Criar Contrato/Engagement (já parcial) + «Criar Projecto de Serviços» (tipo: Arquitectura/Engenharia/Fiscalização/Consultoria/Coordenação/Outro) — NÃO confundir com obra de execução. Separadamente: Ligar/Criar Obra SIGO se houver execução.

2) Equipa do contrato: arquitecto, eng. estrutural/hidráulico/eléctrico, desenhador, BIM, fiscal, consultor, coordenador, outro.
   Por membro: nome, função, especialidade, contacto, interno/externo, forma pagamento, valor/%, €/h, €/dia, por entregável, fixo, data prevista pagamento, estado pagamento.

3) Calcular automaticamente: receita contratada/recebida/por receber; custo previsto/realizado; honorários colaboradores previstos/pagos/pendentes; despesas; margem prevista/real; rentabilidade %.

4) Distribuição honorários: fixo | % | hora | entregável | por fase. Mostrar: previsto / pago / a pagar.

5) Custos/despesas: deslocações, plotagem, taxas, consultores, subcontratações, etc. Distinguir custo interno vs despesa reembolsável.

Critérios Fase 2:
[ ] Atribuir responsáveis e quanto cada um recebe
[ ] Saber quanto já foi pago a cada colaborador
[ ] Custos internos + margem do contrato
[ ] Dashboard financeiro do contrato (contratado/facturado/recebido/a receber/custos/margem)

---

### FASE 3 — Cronograma, entregáveis, revisões, adendas

1) Cronograma por contrato: fase, responsável, início, fim, duração, estado (não iniciado, em preparação, em curso, aguardando cliente/terceiro, em revisão, concluído, suspenso, atrasado). Vistas: lista + timeline/Gantt simples.

2) Entregáveis por fase: responsável, prazo, estado (pendente→aprovado), data entregue, revisão, versão, observação.

3) Revisões do cliente: data, descrição, responsável, impacto prazo/financeiro, incluída no contrato?, trabalho adicional? Se fora do âmbito → «Criar Adenda».

4) Adenda / proposta adicional ligada ao contrato (série tipo PRO-AAAA-NNNN-A01): trabalho adicional, alteração escopo, nova especialidade, revisão extraordinária, extensão fiscalização, consultoria adicional.

Critérios Fase 3:
[ ] Fases, entregáveis e prazos
[ ] Timeline do serviço
[ ] Revisões do cliente
[ ] Trabalho adicional/adenda

---

### FASE 4 — Dashboards + medição→proposta execução

1) Dashboard atelier: Comercial (rascunhos, enviadas, a fechar, aceites, rejeitadas, conversão, valor em negociação/ganho); Financeiro; Produção; Equipa.

2) Dashboard por contrato: KPIs financeiros + operacionais (progresso, prazo, dias restantes, entregáveis, equipa, próximas actividades).

3) De medição/orçamento concluído: «Gerar Proposta Comercial» puxando descrição, cliente, localização, capítulos, resumo financeiro, impostos, prazo, refs. Opção anexar: nada / resumo / mapa completo. Comercial NÃO recalcula quantidades.

Critérios Fase 4:
[ ] Dashboard comercial+operacional+financeiro
[ ] Medição concluída gera proposta de execução
[ ] Impossível preço arbitrário de execução sem medição

---

## Regras de engenharia
- Reutilizar practice_* existente; estender com migrações.
- Manter série documental e PDF com marca da empresa (sem SIGO hardcoded).
- Perfil/Sair só no UserMenu do cabeçalho.
- UI em português; um fluxo claro de assistente (não dashboard genérico na criação).
- Typecheck; migrar DB; smoke nos critérios da fase em curso.

## Ordem
Começa já pela FASE 1 e não pares até aos critérios da Fase 1 estarem verdes.
Depois FASE 2 → 3 → 4.
Marca todos; actualiza o script docs/scripts/prompt-comercial-atelier.md se mudares o contrato de implementação.
```

---

## Mapa rápido (para ti)

| Fase | Entrega |
|------|---------|
| **1** | Tipos de serviço + assistente 7 passos + templates + PDF profissional + bloqueio execução sem medição |
| **2** | Contrato serviço + equipa + honorários + margem |
| **3** | Cronograma + entregáveis + revisões + adendas |
| **4** | Dashboards atelier/contrato + gerar proposta a partir de medição |

**Regra de ouro do PDF:** honorários profissionais ≠ empreitada. Execução de obra só via Medição → Orçamento → Proposta.

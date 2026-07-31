import { useState } from "react";
import { Link } from "react-router-dom";
import { calculateVatTotals } from "@sigo/shared";
import { useAuth } from "../auth/AuthContext";
import { COMMERCIAL_PLANS, SIGO_CONTACT_EMAIL, SIGO_WHATSAPP_NUMBER, formatMzn } from "../commercialPlans";
import { LogoIcon } from "../components/Logo";
import { IconClipboard, IconChart, IconRuler, IconFolder, IconDoc, IconMap } from "../components/icons";

const productViews = {
  orcamento: {
    step: "01 · Custos",
    title: "O preço certo chega ao orçamento com contexto.",
    copy: "Cada item mantém a ligação à composição, ao fornecedor e à zona de preços. Quando uma cotação muda, sabe exactamente o que precisa de rever.",
    points: ["Composições rastreáveis", "Comparação de fornecedores", "MZN e USD por zona"],
  },
  cronograma: {
    step: "02 · Planeamento",
    title: "O orçamento transforma-se num plano executável.",
    copy: "A WBS organiza actividades e subactividades, preserva a linha de base e mostra dependências, progresso e marcos numa única leitura.",
    points: ["Gantt hierárquico", "Dependências e marcos", "PDF adaptativo A3, A2 e A1"],
  },
  campo: {
    step: "03 · Execução",
    title: "O que acontece no estaleiro actualiza a gestão.",
    copy: "Diário, compras, stock e autos deixam de ser registos isolados. O sistema confronta o planeado com o executado e mostra o próximo passo.",
    points: ["Diário ligado ao cronograma", "Necessidades de compra automáticas", "Autos com acumulados e validação"],
  },
} as const;

type ProductKey = keyof typeof productViews;

const FEATURE_GRID = [
  { Icon: IconClipboard, label: "Orçamento vivo", copy: "Cada preço mantém a ligação à composição, ao fornecedor e à zona — nunca um número solto." },
  { Icon: IconChart, label: "Cronograma real", copy: "WBS com linha de base, dependências e progresso alimentado pelo que acontece no estaleiro." },
  { Icon: IconRuler, label: "Medições rastreáveis", copy: "Nº × comprimento × largura × altura, sempre auditável até à planta de origem." },
  { Icon: IconFolder, label: "Compras ligadas ao plano", copy: "Necessidades calculadas a partir do cronograma e do stock, não de folhas soltas." },
  { Icon: IconDoc, label: "Diário e Autos", copy: "O campo confirma o executado e o auto valida-se contra o acumulado anterior." },
  { Icon: IconMap, label: "Zonas, MZN e USD", copy: "Cada projecto e fornecedor mantém a sua moeda e o seu preço regional." },
] as const;

const PAIN_POINTS = [
  "Excel espalhado por obra, sem versão única a valer",
  "Preço do material chega ao orçamento já desactualizado",
  "Diário e Autos que não se cruzam com o cronograma",
  "Compra decidida sem saber o que já está em stock",
] as const;

const SIGO_ANSWERS = [
  "Um orçamento vivo, ligado a fornecedores e zonas",
  "Preço actualizado assim que uma cotação muda",
  "Cronograma, Diário e Autos a confirmarem-se uns aos outros",
  "Compra sugerida a partir do que falta e do que já existe",
] as const;

function whatsappHref(plan?: string) {
  const message = plan
    ? `Olá Samuel. Tenho interesse no plano ${plan} do SIGO. Gostaria de receber mais informações.`
    : "Olá Samuel. Gostaria de conhecer melhor o SIGO para a minha empresa de construção.";
  return `https://wa.me/${SIGO_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

function emailHref(plan?: string) {
  const subject = plan ? `Interesse no plano ${plan} do SIGO` : "Pedido de demonstração do SIGO";
  const body = plan
    ? `Olá Samuel,\n\nTenho interesse no plano ${plan} do SIGO e gostaria de receber mais informações.\n\nEmpresa:\nNome:\nTelefone:`
    : "Olá Samuel,\n\nGostaria de agendar uma apresentação do SIGO.\n\nEmpresa:\nNome:\nTelefone:";
  return `mailto:${SIGO_CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function Brand({ light = false }: { light?: boolean }) {
  return <div className="flex items-center gap-3">
    <LogoIcon className="h-10 w-10 rounded-[11px]" />
    <div><p className={`text-lg font-display font-black tracking-[0.2em] ${light ? "text-white" : "text-[#142033]"}`}>SIGO</p><p className={`text-[8px] font-semibold uppercase tracking-[0.12em] ${light ? "text-slate-400" : "text-slate-500"}`}>Sistema Integrado de Gestão de Obras</p></div>
  </div>;
}

function HeroProduct() {
  return <div className="relative mx-auto w-full max-w-[650px] lg:ml-auto">
    <div className="absolute -left-4 top-16 hidden w-44 rounded-xl border border-[#d7e6e7] bg-white p-4 shadow-[0_16px_36px_rgba(20,32,51,.12)] sm:block">
      <p className="text-[9px] font-bold uppercase tracking-[.14em] text-slate-400">Compra recomendada</p>
      <p className="mt-2 text-sm font-display font-black text-[#142033]">Aço A500 · 3,8 t</p>
      <p className="mt-1 text-[11px] text-slate-500">Necessário em 12 dias</p>
    </div>
    <div className="overflow-hidden rounded-[24px] border border-slate-700 bg-[#142033] p-2.5 shadow-[0_34px_80px_rgba(20,32,51,.2)]">
      <div className="overflow-hidden rounded-[17px] bg-[#f8f9fb]">
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3.5 sm:px-5"><div><p className="text-sm font-display font-black">Residencial Horizonte</p><p className="mt-0.5 text-[10px] text-slate-400">Visão da execução · Actualizado hoje</p></div><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700">Em curso</span></div>
        <div className="grid gap-3 p-3 sm:grid-cols-[1fr_1.7fr] sm:p-4">
          <div className="space-y-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Execução física</p><div className="mt-2 flex items-end justify-between"><strong className="text-3xl font-display font-black tracking-tight">42%</strong><span className="text-[10px] font-bold text-emerald-700">+6% este mês</span></div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100"><i className="block h-full w-[42%] bg-[#ed6c22]" /></div></div>
            <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Decisões desta semana</p>{["Aprovar cotação de aço", "Validar Auto n.º 04", "Reprogramar alvenarias"].map((item, index) => <div key={item} className="mt-3 flex gap-2 text-[11px] font-semibold"><span className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border ${index === 0 ? "border-[#ed6c22] bg-orange-50" : "border-slate-300"}`} /><span>{item}</span></div>)}</div>
          </div>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="grid grid-cols-[1.15fr_.85fr] bg-[#17233b] px-3 py-2.5 text-[9px] font-bold uppercase tracking-wider text-white"><span>Plano de execução</span><span>Calendário</span></div>
            {[
              {code:"1",name:"Fundações",sub:"4 subactividades",left:"2%",width:"34%",done:"100%",summary:true},
              {code:"1.4",name:"Betonagem das sapatas",sub:"Concluída",left:"22%",width:"14%",done:"100%"},
              {code:"2",name:"Estrutura",sub:"5 subactividades",left:"32%",width:"46%",done:"36%",summary:true},
              {code:"2.2",name:"Pilares do piso 1",sub:"Em curso",left:"43%",width:"17%",done:"68%"},
              {code:"2.3",name:"Laje do piso 1",sub:"Programada",left:"61%",width:"17%",done:"0%"},
              {code:"3",name:"Alvenarias",sub:"3 subactividades",left:"76%",width:"23%",done:"0%",summary:true},
            ].map((row) => <div key={row.code} className={`grid grid-cols-[1.15fr_.85fr] items-center border-b border-slate-100 px-3 last:border-0 ${row.summary ? "bg-slate-50 py-2.5" : "py-2"}`}><div className={row.summary ? "" : "pl-4 border-l border-slate-200"}><p className={`truncate text-[11px] ${row.summary ? "font-display font-black" : "font-semibold"}`}><span className={`mr-2 ${row.summary ? "text-slate-500" : "text-blue-700"}`}>{row.code}</span>{row.name}</p><p className="mt-0.5 text-[8px] text-slate-400">{row.sub}</p></div><div className="relative h-5 border-l border-slate-100"><span className={`absolute top-1.5 overflow-hidden ${row.summary ? "h-1.5 rounded-sm bg-slate-400" : "h-2.5 rounded bg-blue-100"}`} style={{left:row.left,width:row.width}}><i className={`block h-full ${row.summary ? "bg-[#142033]" : "bg-[#ed6c22]"}`} style={{width:row.done}} /></span></div></div>)}
          </div>
        </div>
      </div>
    </div>
    <div className="absolute -bottom-6 right-5 hidden rounded-xl border border-[#bfe8ea] bg-[#effafb] px-4 py-3 shadow-[0_16px_36px_rgba(20,32,51,.1)] sm:block"><p className="text-[9px] font-bold uppercase tracking-[.14em] text-[#0f7a80]">Auto n.º 04</p><p className="mt-1 text-sm font-display font-black">Pronto para validação</p></div>
  </div>;
}

function ProductPreview({ active }: { active: ProductKey }) {
  if (active === "orcamento") return <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_60px_rgba(20,32,51,.09)]">
    <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><div><p className="text-sm font-display font-black">Mapa de Quantidades · Rev. 03</p><p className="mt-0.5 text-[11px] text-slate-400">Preços actualizados para Maputo</p></div><span className="rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-bold text-emerald-700">98% validado</span></div>
    <div className="grid grid-cols-[minmax(0,1fr)_84px_108px] bg-[#17233b] px-5 py-2.5 text-[9px] font-bold uppercase tracking-wider text-white"><span>Descrição</span><span>Quant.</span><span>Total</span></div>
    {[{code:"03.01",name:"Betão C25/30 em fundações",qty:"46,2 m³",total:"612.840",tag:"Composição"},{code:"03.02",name:"Aço A500 nervurado",qty:"3.840 kg",total:"468.480",tag:"3 cotações"},{code:"03.03",name:"Cofragem para sapatas",qty:"284 m²",total:"198.800",tag:"Zona Maputo"}].map((row) => <div key={row.code} className="grid grid-cols-[minmax(0,1fr)_84px_108px] items-center border-b border-slate-100 px-5 py-4 last:border-0"><div><p className="text-xs font-bold"><span className="mr-2 text-blue-700">{row.code}</span>{row.name}</p><span className="mt-1 inline-block rounded bg-orange-50 px-2 py-0.5 text-[9px] font-bold text-[#a84a16]">{row.tag}</span></div><span className="text-xs text-slate-600">{row.qty}</span><strong className="text-right text-xs">{row.total} MZN</strong></div>)}
    <div className="flex flex-wrap justify-between gap-3 bg-slate-50 px-5 py-4 text-xs"><span className="font-semibold text-slate-500">Fornecedor, composição e zona preservados em cada linha.</span><strong>1.280.120 MZN</strong></div>
  </div>;

  if (active === "cronograma") return <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_60px_rgba(20,32,51,.09)]">
    <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><div><p className="text-sm font-display font-black">Cronograma de execução</p><p className="mt-0.5 text-[11px] text-slate-400">WBS · linha de base · progresso real</p></div><span className="text-[10px] font-bold text-slate-500">Mar — Ago 2026</span></div>
    <div className="grid grid-cols-[1.05fr_.95fr] bg-[#17233b] px-4 py-2.5 text-[9px] font-bold uppercase tracking-wider text-white"><span>WBS e actividade</span><span>Linha temporal</span></div>
    {[{code:"1",name:"TRABALHOS PRELIMINARES",level:0,left:2,width:22,progress:100,summary:true},{code:"1.1",name:"Implantação e estaleiro",level:1,left:2,width:10,progress:100},{code:"1.2",name:"Limpeza do terreno",level:1,left:11,width:13,progress:100},{code:"2",name:"FUNDAÇÕES",level:0,left:20,width:42,progress:61,summary:true},{code:"2.1",name:"Escavação",level:1,left:20,width:13,progress:100},{code:"2.2",name:"Sapatas em betão armado",level:1,left:31,width:22,progress:58},{code:"2.3",name:"Vigas de fundação",level:1,left:48,width:14,progress:18},{code:"3",name:"ESTRUTURA",level:0,left:58,width:40,progress:0,summary:true}].map((row) => <div key={row.code} className={`grid grid-cols-[1.05fr_.95fr] items-center border-b border-slate-100 px-4 ${row.summary ? "bg-slate-50 py-3" : "py-2.5"}`}><div className={row.level ? "relative ml-5 border-l border-slate-300 pl-4 before:absolute before:-left-px before:top-1/2 before:w-3 before:border-t before:border-slate-300" : ""}><p className={`truncate text-[11px] ${row.summary ? "font-display font-black" : "font-semibold"}`}><span className={`mr-2 ${row.summary ? "text-slate-500" : "text-blue-700"}`}>{row.code}</span>{row.name}</p></div><div className="relative h-5 border-l border-slate-100"><i className="absolute inset-y-0 left-1/3 border-l border-dashed border-slate-200" /><i className="absolute inset-y-0 left-2/3 border-l border-dashed border-slate-200" /><span className={`absolute top-1.5 overflow-hidden ${row.summary ? "h-1.5 bg-slate-400" : "h-2.5 rounded bg-blue-100"}`} style={{left:`${row.left}%`,width:`${row.width}%`}}><b className={`block h-full ${row.summary ? "bg-[#142033]" : "bg-[#ed6c22]"}`} style={{width:`${row.progress}%`}} /></span></div></div>)}
    <div className="flex gap-5 bg-slate-50 px-5 py-3 text-[10px] font-semibold text-slate-500"><span>— Linha de base</span><span className="text-[#d85f18]">■ Execução</span><span>◆ Marco</span></div>
  </div>;

  return <div className="grid gap-4 sm:grid-cols-[1.15fr_.85fr]">
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_24px_60px_rgba(20,32,51,.08)]"><div className="flex items-center justify-between"><div><p className="text-sm font-display font-black">Diário · 28 Julho</p><p className="mt-0.5 text-[11px] text-slate-400">Residencial Horizonte</p></div><span className="rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-bold text-blue-700">Em revisão</span></div><div className="mt-5 grid grid-cols-3 gap-2">{[["18","Trabalhadores"],["2","Equipas"],["7h","Tempo útil"]].map(([value,label]) => <div key={label} className="rounded-lg bg-slate-50 p-3"><strong className="block text-xl">{value}</strong><span className="text-[9px] text-slate-400">{label}</span></div>)}</div><div className="mt-5 border-t border-slate-100 pt-4"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Avanço registado</p><div className="mt-3 flex items-center justify-between text-xs"><span>2.2 · Sapatas em betão armado</span><strong>+12%</strong></div><div className="mt-2 h-2 rounded-full bg-slate-100"><i className="block h-full w-[58%] rounded-full bg-[#ed6c22]" /></div></div></div>
    <div className="space-y-4"><div className="rounded-2xl border border-slate-200 bg-[#142033] p-5 text-white"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Auto de medição</p><p className="mt-4 text-3xl font-display font-black">742.860 <small className="text-xs">MZN</small></p><p className="mt-2 text-xs text-slate-400">Período validado contra o acumulado anterior.</p><button type="button" className="mt-5 w-full rounded-lg bg-white px-3 py-2.5 text-xs font-bold text-[#142033]">Rever 4 itens</button></div><div className="rounded-2xl border border-orange-200 bg-orange-50 p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-[#a84a16]">Próxima acção</p><p className="mt-2 text-xs font-semibold">Confirmar entrega do cimento antes de fechar o Diário.</p></div></div>
  </div>;
}

export default function PublicLandingPage() {
  const { user } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeProduct, setActiveProduct] = useState<ProductKey>("cronograma");
  const [billingView, setBillingView] = useState<"mensal" | "anual">("mensal");
  const platformHref = user ? (user.role === "super_admin" ? "/admin" : "/painel") : "/login";
  const closeMenu = () => setMenuOpen(false);

  return <div className="min-h-screen overflow-x-hidden bg-[#f6f8f8] text-[#142033] selection:bg-[#bdeef0]">
    <header className="fixed inset-x-0 top-0 z-50 border-b border-[#142033]/10 bg-[#f6f8f8]/95 backdrop-blur-md">
      <div className="mx-auto flex h-[76px] max-w-[1280px] items-center justify-between px-5 lg:px-8">
        <a href="#inicio" aria-label="SIGO — início"><Brand /></a>
        <nav className="hidden items-center gap-7 text-sm font-semibold text-slate-600 md:flex"><a className="hover:text-slate-950" href="#plataforma">Plataforma</a><a className="hover:text-slate-950" href="#solucoes">Soluções</a><a className="hover:text-slate-950" href="#planos">Planos</a><a className="hover:text-slate-950" href="#perguntas">Perguntas</a></nav>
        <div className="hidden items-center gap-2 md:flex"><Link className="rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-white" to={platformHref}>{user ? "Abrir plataforma" : "Entrar"}</Link><a className="rounded-lg bg-[#142033] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#24324a]" href={whatsappHref()} target="_blank" rel="noreferrer">Pedir demonstração</a></div>
        <button type="button" className="grid h-10 w-10 place-items-center rounded-lg border border-slate-300 bg-white text-xl md:hidden" onClick={() => setMenuOpen((value) => !value)} aria-expanded={menuOpen} aria-label={menuOpen ? "Fechar menu" : "Abrir menu"}>{menuOpen ? "×" : "≡"}</button>
      </div>
      {menuOpen && <nav className="border-t border-slate-200 bg-[#f6f8f8] px-5 py-4 md:hidden"><div className="mx-auto grid max-w-[1280px] gap-1 text-sm font-semibold">{[["#plataforma","Plataforma"],["#solucoes","Soluções"],["#planos","Planos"],["#perguntas","Perguntas"]].map(([href,label]) => <a key={href} className="rounded-lg px-3 py-3 hover:bg-white" href={href} onClick={closeMenu}>{label}</a>)}<Link className="mt-2 rounded-lg bg-[#142033] px-3 py-3 text-center text-white" to={platformHref}>{user ? "Abrir plataforma" : "Entrar no SIGO"}</Link></div></nav>}
    </header>

    <main id="inicio" className="pt-[76px]">
      <section className="relative border-b border-[#142033]/10">
        <div className="mx-auto grid max-w-[1280px] items-center gap-16 px-5 py-16 sm:py-20 lg:grid-cols-[.86fr_1.14fr] lg:px-8 lg:py-24">
          <div className="relative z-10"><p className="mb-5 inline-flex items-center gap-2 border-l-2 border-[#ed6c22] pl-3 text-[11px] font-display font-black uppercase tracking-[0.14em] text-[#8f4d25] sm:mb-6 sm:text-xs">Da estimativa à obra, tudo ligado</p><h1 className="max-w-[650px] text-[40px] font-display font-black leading-[1.03] tracking-[-0.05em] text-[#101a2c] sm:text-6xl lg:text-[68px]">Controle a obra como ela realmente acontece.</h1><p className="mt-6 max-w-xl text-base leading-7 text-slate-600 sm:mt-7 sm:text-lg sm:leading-8">O SIGO liga orçamento, planeamento, compras, campo e medição. A sua equipa trabalha no mesmo fluxo e sabe o que mudou, o que falta e qual é a próxima decisão.</p><div className="mt-8 flex flex-col gap-3 sm:mt-9 sm:flex-row"><a className="rounded-lg bg-[#ed6c22] px-6 py-3.5 text-center text-sm font-display font-black text-white shadow-[0_10px_26px_rgba(237,108,34,.2)] hover:bg-[#d85f18]" href={whatsappHref()} target="_blank" rel="noreferrer">Ver o SIGO em funcionamento</a><a className="rounded-lg border border-slate-300 bg-white px-6 py-3.5 text-center text-sm font-bold text-slate-800 hover:border-slate-400" href="#plataforma">Explorar a plataforma ↓</a></div><div className="mt-8 grid max-w-xl grid-cols-2 gap-x-6 gap-y-3 border-t border-[#142033]/10 pt-5 text-xs font-semibold text-slate-600 sm:mt-10 sm:grid-cols-3 sm:pt-6 sm:text-sm"><span>✓ MZN e USD</span><span>✓ Computador e telemóvel</span><span>✓ Implementação acompanhada</span></div></div>
          <HeroProduct />
        </div>
        <div className="mx-auto max-w-[1280px] border-t border-[#142033]/10 px-5 lg:px-8"><div className="grid py-5 text-center text-[10px] font-display font-black uppercase tracking-[.13em] text-slate-500 sm:grid-cols-5"><span className="py-2">Orçamentar</span><span className="py-2 sm:border-l sm:border-slate-300">Planear</span><span className="py-2 sm:border-l sm:border-slate-300">Comprar</span><span className="py-2 sm:border-l sm:border-slate-300">Executar</span><span className="py-2 sm:border-l sm:border-slate-300">Medir</span></div></div>
      </section>

      <section className="border-b border-[#142033]/10 bg-[#f4f6f8] py-20 lg:py-28">
        <div className="mx-auto max-w-[1280px] px-5 lg:px-8">
          <div className="max-w-2xl"><p className="text-xs font-display font-black uppercase tracking-[0.16em] text-[#0f8a90]">Uma obra, uma só fonte de verdade</p><h2 className="mt-4 text-3xl font-display font-black leading-tight tracking-[-0.03em] sm:text-4xl">Ganhe rapidez de operação e máximo controlo na execução.</h2></div>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURE_GRID.map(({ Icon, label, copy }, index) => (
              <div key={label} className="group rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(20,32,51,.04)] transition hover:-translate-y-0.5 hover:border-[#1AADB4]/40 hover:shadow-[0_20px_40px_rgba(20,32,51,.09)]">
                <div className="flex items-center justify-between"><span className="grid h-11 w-11 place-items-center rounded-xl bg-[#142033] text-white transition group-hover:bg-[#1AADB4]"><Icon className="h-5 w-5" /></span><span className="text-xs font-display font-black text-slate-300">0{index + 1}</span></div>
                <h3 className="mt-5 text-base font-display font-black text-[#142033]">{label}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-500">{copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="plataforma" className="scroll-mt-24 bg-white py-20 lg:py-28">
        <div className="mx-auto max-w-[1280px] px-5 lg:px-8"><div className="grid gap-10 lg:grid-cols-[.78fr_1.22fr] lg:items-end"><div><p className="text-xs font-display font-black uppercase tracking-[0.16em] text-[#d85f18]">Uma operação, não cinco ferramentas</p><h2 className="mt-4 text-4xl font-display font-black leading-tight tracking-[-0.04em] sm:text-5xl">Veja a informação a passar de uma fase para a seguinte.</h2></div><p className="max-w-2xl text-lg leading-8 text-slate-600">O orçamento não termina quando é aprovado. Ele alimenta o cronograma, antecipa compras e dá a referência que o Diário e os Autos precisam para comparar o planeado com o realizado.</p></div>
          <div className="mt-14 grid gap-8 lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start">
            <div className="space-y-2" role="tablist" aria-label="Áreas da plataforma">{(Object.keys(productViews) as ProductKey[]).map((key) => { const view = productViews[key]; const active = key === activeProduct; return <button key={key} type="button" role="tab" aria-selected={active} onClick={() => setActiveProduct(key)} className={`w-full rounded-xl border p-5 text-left transition ${active ? "border-[#142033] bg-[#142033] text-white shadow-lg" : "border-slate-200 bg-white hover:border-slate-400"}`}><span className={`text-[10px] font-display font-black uppercase tracking-[.14em] ${active ? "text-orange-300" : "text-[#d85f18]"}`}>{view.step}</span><strong className="mt-2 block text-lg leading-tight">{view.title}</strong>{active && <><p className="mt-3 text-sm leading-6 text-slate-300">{view.copy}</p><ul className="mt-4 space-y-2 text-xs font-semibold">{view.points.map((point) => <li key={point}>→ {point}</li>)}</ul></>}</button>; })}</div>
            <div role="tabpanel"><ProductPreview active={activeProduct} /></div>
          </div>
        </div>
      </section>

      <section id="solucoes" className="scroll-mt-24 bg-[#142033] py-20 text-white lg:py-28"><div className="mx-auto max-w-[1280px] px-5 lg:px-8"><div className="grid gap-10 lg:grid-cols-[.8fr_1.2fr]"><div><p className="text-xs font-display font-black uppercase tracking-[0.16em] text-[#5FE0E4]">Cada pessoa vê o que precisa</p><h2 className="mt-4 text-4xl font-display font-black leading-tight tracking-[-0.04em] sm:text-5xl">Um sistema comum para decisões diferentes.</h2><p className="mt-6 max-w-md leading-7 text-slate-300">A mesma informação serve quem prepara o preço, quem coordena o estaleiro e quem precisa de aprovar custos e medições.</p></div><div className="grid gap-4 md:grid-cols-3">{[
          ["Construtora", "Margem e produção", "Veja custos previstos, necessidades de compra, avanço e desvios antes de afectarem a obra."],
          ["Fiscalização", "Evidência e medição", "Confirme quantidades, Diário, anexos e acumulados com um histórico claro de aprovação."],
          ["Dono da obra", "Prazo e compromisso", "Acompanhe marcos, execução financeira e decisões pendentes sem entrar no detalhe operacional."],
        ].map(([role, outcome, copy], index) => <article key={role} className="flex min-h-[220px] flex-col rounded-2xl border border-white/10 bg-white/[.045] p-6 md:min-h-[300px]"><span className="text-sm font-display font-black text-[#5FE0E4]">0{index + 1}</span><div className="mt-auto"><p className="text-xs font-bold uppercase tracking-[.13em] text-slate-400">{role}</p><h3 className="mt-2 text-xl font-display font-black">{outcome}</h3><p className="mt-4 text-sm leading-6 text-slate-300">{copy}</p></div></article>)}</div></div></div></section>

      <section className="bg-[#eef1f4] py-20 lg:py-28"><div className="mx-auto max-w-[1280px] px-5 lg:px-8"><div className="grid gap-12 lg:grid-cols-[.72fr_1.28fr]"><div><p className="text-xs font-display font-black uppercase tracking-[0.16em] text-[#d85f18]">A cadeia de decisão</p><h2 className="mt-4 text-4xl font-display font-black tracking-[-0.04em]">Sem atalhos invisíveis.</h2><p className="mt-5 leading-7 text-slate-600">O SIGO mostra o que falta antes de avançar e conserva a origem de cada valor.</p></div><ol className="relative border-l border-slate-300 pl-8">{[
          ["Preço de origem", "Cotações, fornecedor e zona definem o custo do material."],
          ["Composição", "Material, mão-de-obra e equipamento formam o preço unitário."],
          ["Orçamento aprovado", "Quantidades e custos criam a referência da obra."],
          ["Cronograma e compras", "O prazo transforma quantidades em necessidades por data."],
          ["Diário e Autos", "O campo confirma o executado e actualiza o controlo."],
        ].map(([title, copy], index) => <li key={title} className="relative pb-8 last:pb-0"><span className="absolute -left-[43px] grid h-7 w-7 place-items-center rounded-full border-4 border-[#eef1f4] bg-[#142033] text-[9px] font-display font-black text-white">{index + 1}</span><h3 className="font-display font-black">{title}</h3><p className="mt-1 text-sm leading-6 text-slate-600">{copy}</p></li>)}</ol></div></div></section>

      <section className="bg-white py-20 lg:py-28">
        <div className="mx-auto max-w-[1280px] px-5 lg:px-8">
          <div className="text-center"><p className="text-xs font-display font-black uppercase tracking-[0.16em] text-[#0f8a90]">O que muda de facto</p><h2 className="mx-auto mt-4 max-w-xl text-3xl font-display font-black tracking-[-0.03em] sm:text-4xl">A mesma obra, gerida de outra forma.</h2></div>
          <div className="mx-auto mt-14 grid max-w-4xl overflow-hidden rounded-[28px] border border-slate-200 shadow-[0_30px_70px_rgba(20,32,51,.08)] md:grid-cols-2">
            <div className="bg-slate-50 p-8 sm:p-10">
              <p className="text-xs font-display font-black uppercase tracking-[0.14em] text-slate-400">Sem o SIGO</p>
              <ul className="mt-6 space-y-4">{PAIN_POINTS.map((point) => <li key={point} className="flex gap-3 text-sm leading-6 text-slate-500"><span className="mt-0.5 font-display font-black text-slate-400">✕</span><span>{point}</span></li>)}</ul>
            </div>
            <div className="bg-[#142033] p-8 text-white sm:p-10">
              <p className="text-xs font-display font-black uppercase tracking-[0.14em] text-[#5FE0E4]">Com o SIGO</p>
              <ul className="mt-6 space-y-4">{SIGO_ANSWERS.map((point) => <li key={point} className="flex gap-3 text-sm font-semibold leading-6"><span className="mt-0.5 font-display font-black text-[#5FE0E4]">✓</span><span>{point}</span></li>)}</ul>
            </div>
          </div>
        </div>
      </section>

      <section id="planos" className="scroll-mt-24 bg-[#f6f8f8] py-20 lg:py-28"><div className="mx-auto max-w-[1280px] px-5 lg:px-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-xs font-display font-black uppercase tracking-[0.16em] text-[#d85f18]">Planos</p><h2 className="mt-4 max-w-2xl text-4xl font-display font-black tracking-[-0.04em] sm:text-5xl">Escolha a capacidade certa para a sua operação.</h2></div>
          <div className="inline-flex self-start rounded-full border border-slate-200 bg-white p-1 lg:self-auto">
            <button type="button" onClick={() => setBillingView("mensal")} className={`rounded-full px-4 py-2 text-sm font-display font-black transition ${billingView === "mensal" ? "bg-[#142033] text-white" : "text-slate-500"}`}>Por mês</button>
            <button type="button" onClick={() => setBillingView("anual")} className={`rounded-full px-4 py-2 text-sm font-display font-black transition ${billingView === "anual" ? "bg-[#142033] text-white" : "text-slate-500"}`}>Por ano</button>
          </div>
        </div>
        <div className="mt-14 grid items-stretch gap-5 lg:grid-cols-3">{COMMERCIAL_PLANS.map((plan) => {
          const totals = calculateVatTotals(plan.annualPrice);
          const regularTotals = calculateVatTotals(plan.regularAnnualPrice);
          const monthlyEquivalent = Math.round(totals.total / 12);
          const savingsPct = Math.round((1 - plan.annualPrice / plan.regularAnnualPrice) * 100);
          return <article key={plan.slug} className={`relative flex min-w-0 flex-col rounded-2xl border p-6 sm:p-7 ${plan.featured ? "border-[#1AADB4] bg-white shadow-[0_24px_60px_rgba(20,32,51,.12)] lg:-translate-y-3" : "border-slate-200 bg-white/75"}`}>
            {plan.featured && <span className="absolute right-5 top-0 -translate-y-1/2 rounded-full bg-[#1AADB4] px-3 py-1 text-[10px] font-display font-black uppercase tracking-wider text-white">Recomendado</span>}
            <p className="text-sm font-display font-black uppercase tracking-[0.1em] text-slate-500">{plan.name}</p>
            <p className="mt-2 text-xs font-semibold text-[#a84a16]">{plan.audience}</p>
            {billingView === "mensal" ? (
              <div className="mt-5">
                <div className="flex items-baseline gap-1"><strong className="block break-words text-4xl font-display font-black tracking-[-0.04em]">{formatMzn(monthlyEquivalent)}</strong><span className="text-sm font-semibold text-slate-500">/mês</span></div>
                <p className="mt-2 text-xs text-slate-500">Facturado {formatMzn(totals.total)}/ano (IVA incluído) · poupa {savingsPct}% face ao preço de tabela</p>
              </div>
            ) : (
              <div className="mt-5">
                <div className="flex items-baseline gap-1"><strong className="block break-words text-4xl font-display font-black tracking-[-0.04em]">{formatMzn(totals.total)}</strong><span className="text-sm font-semibold text-slate-500">/ano</span></div>
                <p className="mt-2 text-xs text-slate-500">Equivale a {formatMzn(monthlyEquivalent)}/mês · poupa {formatMzn(regularTotals.total - totals.total)} face ao preço de tabela</p>
              </div>
            )}
            <p className="mt-5 text-sm leading-6 text-slate-600">{plan.description}</p>
            <p className="mt-4 border-y border-slate-100 py-3 text-xs font-bold">{plan.limits}</p>
            <ul className="my-6 flex-1 space-y-3">{plan.features.map((feature) => <li key={feature} className="flex gap-3 text-sm text-slate-700"><span className="font-display font-black text-[#1AADB4]">✓</span><span>{feature}</span></li>)}</ul>
            <Link className={`rounded-lg px-4 py-3 text-center text-sm font-display font-black ${plan.featured ? "bg-[#ed6c22] text-white hover:bg-[#d85f18]" : "bg-[#142033] text-white hover:bg-[#24324a]"}`} to={`/checkout/${plan.slug}`}>Escolher {plan.name} →</Link>
            <a className="mt-2 rounded-lg px-4 py-2.5 text-center text-xs font-bold text-slate-500 hover:bg-slate-50 hover:text-slate-900" href={emailHref(plan.name)}>Tirar uma dúvida</a>
          </article>; })}</div>
        <p className="mt-7 text-center text-xs leading-5 text-slate-500">A subscrição é facturada anualmente, num só pagamento; o valor mensal mostrado é o equivalente para comparação. O checkout confirma o pedido — a activação é acompanhada pela equipa SIGO.</p>
      </div></section>

      <section id="perguntas" className="scroll-mt-24 bg-white py-20 lg:py-28"><div className="mx-auto grid max-w-[1080px] gap-10 px-5 lg:grid-cols-[.7fr_1.3fr] lg:px-8"><div><p className="text-xs font-display font-black uppercase tracking-[0.16em] text-[#0f8a90]">Antes de decidir</p><h2 className="mt-4 text-4xl font-display font-black tracking-[-0.04em]">Perguntas honestas, respostas directas.</h2></div><div className="divide-y divide-slate-200 border-y border-slate-200">{[
          ["Preciso de abandonar os meus ficheiros actuais?", "Não de uma vez. A implementação começa por uma obra-piloto e organiza gradualmente catálogo, composições, modelos e utilizadores."],
          ["O SIGO funciona no telemóvel?", "Sim. As áreas de consulta e registo foram preparadas para computador, tablet e telemóvel; operações extensas, como o orçamento, são mais confortáveis num ecrã maior."],
          ["Posso trabalhar em MZN e USD?", "Sim. Cada projecto e documento mantém a sua moeda, e os preços podem variar por fornecedor e zona."],
          ["Como escolho o plano?", "Na demonstração avaliamos número de obras, tamanho da equipa e fluxo actual. A recomendação parte da sua operação, não apenas do número de utilizadores."],
        ].map(([question, answer]) => <details key={question} className="group py-5"><summary className="flex cursor-pointer list-none items-center justify-between gap-5 font-display font-black"><span>{question}</span><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-100 text-lg font-normal group-open:rotate-45">+</span></summary><p className="max-w-2xl pt-4 text-sm leading-7 text-slate-600">{answer}</p></details>)}</div></div></section>

      <section id="contacto" className="bg-white pb-20 lg:pb-28"><div className="mx-auto max-w-[1280px] px-5 lg:px-8"><div className="overflow-hidden rounded-[28px] bg-[#ed6c22] px-7 py-12 text-white md:px-12 lg:flex lg:items-center lg:justify-between lg:px-16 lg:py-16"><div><p className="text-xs font-display font-black uppercase tracking-[0.16em] text-orange-100">Uma conversa, uma obra real</p><h2 className="mt-3 max-w-2xl text-4xl font-display font-black leading-tight tracking-[-0.04em]">Mostre-nos como gere a obra hoje.</h2><p className="mt-4 max-w-xl leading-7 text-orange-50">Usamos o seu fluxo para mostrar onde o SIGO reduz repetição, falhas e decisões tardias.</p></div><div className="mt-9 flex min-w-fit flex-col gap-3 lg:mt-0"><a className="rounded-lg bg-white px-6 py-3.5 text-center text-sm font-display font-black text-[#b8470a]" href={whatsappHref()} target="_blank" rel="noreferrer">WhatsApp · +258 86 638 4194</a><a className="rounded-lg border border-white/40 px-6 py-3.5 text-center text-sm font-bold text-white hover:bg-white/10" href={emailHref()}>{SIGO_CONTACT_EMAIL}</a></div></div></div></section>
    </main>

    <footer className="border-t border-slate-800 bg-[#101827] py-10 text-white"><div className="mx-auto flex max-w-[1280px] flex-col gap-8 px-5 sm:flex-row sm:items-end sm:justify-between lg:px-8"><div><Brand light /><p className="mt-5 max-w-sm text-sm leading-6 text-slate-400">Custos, prazo e execução no mesmo sistema de gestão de obras.</p></div><div className="text-sm text-slate-400 sm:text-right"><p>Moçambique · MZN e USD</p><p className="mt-2">© 2026 SIGO. Todos os direitos reservados.</p></div></div></footer>
  </div>;
}

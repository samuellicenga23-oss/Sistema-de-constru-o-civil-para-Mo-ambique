import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

const WHATSAPP_NUMBER = "588466384194";
const CONTACT_EMAIL = "licsenga.samuel@mechanical.co.mz";

const plans = [
  {
    name: "Fundamento",
    price: "4.900",
    description: "Para pequenas empresas que querem deixar as folhas dispersas e começar a controlar a obra.",
    limits: "Até 3 obras activas · 5 utilizadores",
    features: ["Orçamentos e composições", "Catálogo de preços por zona", "Documentos e relatórios PDF", "Cálculos rápidos com custos"],
  },
  {
    name: "Profissional",
    price: "12.900",
    description: "A operação completa para equipas que executam várias frentes e precisam de controlo diário.",
    limits: "Até 15 obras activas · 20 utilizadores",
    features: ["Tudo do Fundamento", "Cronograma Gantt e subactividades", "Autos de medição e Diário de Obra", "Compras, stock e financeiro", "Acompanhamento de implementação"],
    featured: true,
  },
  {
    name: "Empresa",
    price: "29.900",
    description: "Para construtoras com várias equipas, mais governação e acompanhamento prioritário.",
    limits: "Até 50 obras activas · utilizadores ilimitados",
    features: ["Tudo do Profissional", "Perfis e controlo avançado de acessos", "Migração inicial de dados", "Formação da equipa", "Suporte prioritário"],
  },
];

function whatsappHref(plan?: string) {
  const message = plan
    ? `Olá Samuel. Tenho interesse no plano ${plan} do SIGA. Gostaria de receber mais informações.`
    : "Olá Samuel. Gostaria de conhecer melhor o SIGA para a minha empresa de construção.";
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

function emailHref(plan?: string) {
  const subject = plan ? `Interesse no plano ${plan} do SIGA` : "Pedido de demonstração do SIGA";
  const body = plan
    ? `Olá Samuel,\n\nTenho interesse no plano ${plan} do SIGA e gostaria de receber mais informações.\n\nEmpresa:\nNome:\nTelefone:`
    : "Olá Samuel,\n\nGostaria de agendar uma apresentação do SIGA.\n\nEmpresa:\nNome:\nTelefone:";
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function Brand({ light = false }: { light?: boolean }) {
  return <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#ed6c22] text-lg font-black text-white">S</span><div><p className={`text-lg font-black tracking-[0.18em] ${light ? "text-white" : "text-[#142033]"}`}>SIGA</p><p className={`text-[9px] font-semibold uppercase tracking-[0.16em] ${light ? "text-slate-400" : "text-slate-500"}`}>Gestão inteligente de obras</p></div></div>;
}

export default function PublicLandingPage() {
  const { user } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const platformHref = user ? (user.role === "super_admin" ? "/admin" : "/painel") : "/login";

  return <div className="min-h-screen overflow-x-hidden bg-[#f6f4ef] text-[#142033]">
    <header className="fixed inset-x-0 top-0 z-50 border-b border-slate-900/10 bg-[#f6f4ef]/95 backdrop-blur-md">
      <div className="mx-auto flex h-[74px] max-w-[1240px] items-center justify-between px-5 lg:px-8">
        <a href="#inicio" aria-label="SIGA — início"><Brand /></a>
        <nav className="hidden items-center gap-7 text-sm font-semibold text-slate-600 md:flex">
          <a className="transition hover:text-slate-950" href="#produto">Produto</a>
          <a className="transition hover:text-slate-950" href="#processo">Como funciona</a>
          <a className="transition hover:text-slate-950" href="#planos">Planos</a>
          <a className="transition hover:text-slate-950" href="#contacto">Contacto</a>
        </nav>
        <div className="hidden items-center gap-2 md:flex"><Link className="rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-white" to={platformHref}>{user ? "Abrir plataforma" : "Entrar"}</Link><a className="rounded-lg bg-[#142033] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#24324a]" href="#planos">Ver planos</a></div>
        <button className="grid h-10 w-10 place-items-center rounded-lg border border-slate-300 bg-white text-xl md:hidden" onClick={() => setMenuOpen((value) => !value)} aria-label={menuOpen ? "Fechar menu" : "Abrir menu"}>{menuOpen ? "×" : "≡"}</button>
      </div>
      {menuOpen && <nav className="border-t border-slate-200 bg-[#f6f4ef] px-5 py-4 md:hidden"><div className="mx-auto grid max-w-[1240px] gap-1 text-sm font-semibold"><a className="rounded-lg px-3 py-3 hover:bg-white" href="#produto" onClick={() => setMenuOpen(false)}>Produto</a><a className="rounded-lg px-3 py-3 hover:bg-white" href="#processo" onClick={() => setMenuOpen(false)}>Como funciona</a><a className="rounded-lg px-3 py-3 hover:bg-white" href="#planos" onClick={() => setMenuOpen(false)}>Planos</a><a className="rounded-lg px-3 py-3 hover:bg-white" href="#contacto" onClick={() => setMenuOpen(false)}>Contacto</a><Link className="mt-2 rounded-lg bg-[#142033] px-3 py-3 text-center text-white" to={platformHref}>{user ? "Abrir plataforma" : "Entrar no SIGA"}</Link></div></nav>}
    </header>

    <main id="inicio" className="pt-[74px]">
      <section className="relative border-b border-slate-900/10">
        <div className="mx-auto grid max-w-[1240px] items-center gap-14 px-5 py-20 lg:grid-cols-[0.92fr_1.08fr] lg:px-8 lg:py-28">
          <div>
            <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#e2d7ca] bg-white px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] text-[#8f4d25]"><span className="h-2 w-2 rounded-full bg-[#ed6c22]" /> Feito para a construção em Moçambique</p>
            <h1 className="max-w-2xl text-[46px] font-black leading-[1.03] tracking-[-0.045em] text-[#101a2c] sm:text-6xl lg:text-[68px]">A obra avança.<br /><span className="text-[#d85f18]">O controlo também.</span></h1>
            <p className="mt-7 max-w-xl text-lg leading-8 text-slate-600">Orçamente, planeie, compre, registe e meça no mesmo lugar. O SIGA liga o escritório à obra para que cada decisão tenha preço, prazo e responsável.</p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row"><a className="rounded-lg bg-[#ed6c22] px-6 py-3.5 text-center text-sm font-bold text-white shadow-[0_8px_24px_rgba(237,108,34,.2)] transition hover:bg-[#d85f18]" href="#planos">Conhecer os planos</a><a className="rounded-lg border border-slate-300 bg-white px-6 py-3.5 text-center text-sm font-bold text-slate-800 transition hover:border-slate-400" href={whatsappHref()} target="_blank" rel="noreferrer">Pedir uma demonstração</a></div>
            <div className="mt-10 flex flex-wrap gap-x-7 gap-y-3 text-sm text-slate-600"><span>✓ Implementação acompanhada</span><span>✓ MZN e USD</span><span>✓ Acesso em computador e telemóvel</span></div>
          </div>

          <div className="relative lg:translate-x-6">
            <div className="absolute -inset-8 -z-10 rounded-full bg-[#ed6c22]/10 blur-3xl" />
            <div className="overflow-hidden rounded-[22px] border border-slate-700 bg-[#101a2c] p-2 shadow-[0_36px_90px_rgba(20,32,51,.22)]">
              <div className="overflow-hidden rounded-2xl bg-[#f7f8fa]">
                <div className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4"><div><p className="text-sm font-black">Edifício Marés</p><p className="text-[10px] text-slate-400">Visão de execução · Julho 2026</p></div><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700">Em curso</span></div>
                <div className="grid grid-cols-3 gap-2 p-4"><div className="rounded-xl border border-slate-200 bg-white p-3"><p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Progresso</p><p className="mt-1 text-xl font-black">38%</p></div><div className="rounded-xl border border-slate-200 bg-white p-3"><p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Prazo</p><p className="mt-1 text-xl font-black">146 d</p></div><div className="rounded-xl border border-slate-200 bg-white p-3"><p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Desvio</p><p className="mt-1 text-xl font-black text-emerald-700">+1,8%</p></div></div>
                <div className="mx-4 mb-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <div className="grid grid-cols-[1.1fr_.9fr] bg-[#17233b] px-4 py-2.5 text-[9px] font-bold uppercase tracking-wider text-white"><span>Plano de execução</span><span>Linha temporal</span></div>
                  {[{code:"1",name:"Preliminares",width:"20%",left:"2%",done:"100%"},{code:"2",name:"Fundações",width:"34%",left:"18%",done:"74%"},{code:"3",name:"Estrutura",width:"40%",left:"45%",done:"18%"},{code:"4",name:"Alvenarias",width:"32%",left:"68%",done:"0%"}].map((row) => <div key={row.code} className="grid grid-cols-[1.1fr_.9fr] items-center border-b border-slate-100 px-4 py-3 last:border-0"><div><p className="text-xs font-bold"><span className="mr-2 text-blue-700">{row.code}</span>{row.name}</p><p className="mt-0.5 text-[9px] text-slate-400">Orçamento · Diário · Autos</p></div><div className="relative h-5 rounded bg-slate-50"><span className="absolute top-1 h-3 overflow-hidden rounded bg-slate-300" style={{ left: row.left, width: row.width }}><i className="block h-full bg-[#ed6c22]" style={{ width: row.done }} /></span></div></div>)}
                </div>
                <div className="grid grid-cols-2 gap-2 px-4 pb-4"><div className="rounded-xl bg-[#fff3eb] p-3"><p className="text-[9px] font-bold uppercase text-[#a84a16]">Próxima decisão</p><p className="mt-1 text-xs font-semibold">Aprovar compra de aço antes de 31 Jul.</p></div><div className="rounded-xl bg-blue-50 p-3"><p className="text-[9px] font-bold uppercase text-blue-700">Auto de medição</p><p className="mt-1 text-xs font-semibold">Auto n.º 03 pronto para revisão.</p></div></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="produto" className="bg-white py-20 lg:py-28">
        <div className="mx-auto max-w-[1240px] px-5 lg:px-8">
          <div className="grid gap-10 lg:grid-cols-[.75fr_1.25fr]"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#d85f18]">Uma única fonte de verdade</p><h2 className="mt-4 text-4xl font-black leading-tight tracking-[-0.035em] sm:text-5xl">O orçamento deixa de ser um ficheiro parado.</h2></div><p className="max-w-2xl self-end text-lg leading-8 text-slate-600">No SIGA, a composição define os materiais, o cronograma define quando serão necessários, a compra alimenta o stock, o Diário regista o consumo e o Auto confirma o que foi executado.</p></div>
          <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-slate-200 bg-slate-200 md:grid-cols-2 lg:grid-cols-4">{[
            ["01", "Orçamentar", "Composições, preços por zona e Mapas de Quantidades com rastreabilidade."],
            ["02", "Planear", "WBS, subactividades, dependências, linha de base e cronograma A3."],
            ["03", "Executar", "Compras, armazém, Diário de Obra e ocorrências ligadas ao plano."],
            ["04", "Medir", "Autos por período, acumulados aprovados e reflexo automático no financeiro."],
          ].map(([number, title, copy]) => <article key={number} className="min-h-64 bg-[#f8f9fa] p-7"><p className="text-sm font-black text-[#ed6c22]">{number}</p><h3 className="mt-14 text-xl font-black">{title}</h3><p className="mt-3 text-sm leading-6 text-slate-600">{copy}</p></article>)}</div>
        </div>
      </section>

      <section id="processo" className="bg-[#142033] py-20 text-white lg:py-28">
        <div className="mx-auto grid max-w-[1240px] gap-12 px-5 lg:grid-cols-[.8fr_1.2fr] lg:px-8">
          <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#f1985f]">Construído para a realidade da obra</p><h2 className="mt-4 text-4xl font-black leading-tight tracking-[-0.035em] sm:text-5xl">Menos relatórios soltos.<br />Mais decisões no tempo certo.</h2><p className="mt-6 max-w-lg leading-7 text-slate-300">Cada área conversa com a seguinte. O sistema mostra o que está em falta antes de permitir avançar e mantém o histórico das decisões importantes.</p></div>
          <div className="grid gap-4 sm:grid-cols-2">{[
            ["Custos ligados", "Fornecedor, zona, material, composição e orçamento na mesma cadeia."],
            ["Prazo executável", "Actividades e subactividades com dependências e progresso real."],
            ["Campo conectado", "Diário, stock e evidências actualizam o estado da obra."],
            ["Medição segura", "Período, acumulado, excedentes justificados e aprovação formal."],
          ].map(([title, copy]) => <article key={title} className="rounded-2xl border border-white/10 bg-white/[.045] p-6"><span className="mb-8 block h-px w-12 bg-[#ed6c22]" /><h3 className="text-lg font-bold">{title}</h3><p className="mt-3 text-sm leading-6 text-slate-400">{copy}</p></article>)}</div>
        </div>
      </section>

      <section id="planos" className="bg-[#f6f4ef] py-20 lg:py-28">
        <div className="mx-auto max-w-[1240px] px-5 lg:px-8">
          <div className="mx-auto max-w-3xl text-center"><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#d85f18]">Planos SIGA</p><h2 className="mt-4 text-4xl font-black tracking-[-0.035em] sm:text-5xl">Escolha o nível de controlo da sua empresa.</h2><p className="mt-5 text-lg leading-8 text-slate-600">Preços mensais em Meticais. Poupe 15% com pagamento anual. A activação é feita com acompanhamento da nossa equipa.</p></div>
          <div className="mt-14 grid items-stretch gap-5 lg:grid-cols-3">{plans.map((plan) => <article key={plan.name} className={`relative flex flex-col rounded-2xl border p-7 ${plan.featured ? "border-[#ed6c22] bg-white shadow-[0_24px_60px_rgba(20,32,51,.12)] lg:-translate-y-3" : "border-slate-200 bg-white/75"}`}>{plan.featured && <span className="absolute right-5 top-0 -translate-y-1/2 rounded-full bg-[#ed6c22] px-3 py-1 text-[10px] font-black uppercase tracking-wider text-white">Mais escolhido</span>}<p className="text-sm font-black uppercase tracking-[0.1em] text-slate-500">{plan.name}</p><div className="mt-5 flex items-end gap-2"><strong className="text-4xl font-black tracking-[-0.04em]">{plan.price}</strong><span className="pb-1 text-sm font-semibold text-slate-500">MZN / mês</span></div><p className="mt-5 min-h-20 text-sm leading-6 text-slate-600">{plan.description}</p><p className="mt-3 border-y border-slate-100 py-3 text-xs font-bold text-slate-800">{plan.limits}</p><ul className="my-6 flex-1 space-y-3">{plan.features.map((feature) => <li key={feature} className="flex gap-3 text-sm text-slate-700"><span className="font-black text-[#ed6c22]">✓</span><span>{feature}</span></li>)}</ul><a className={`rounded-lg px-4 py-3 text-center text-sm font-bold ${plan.featured ? "bg-[#ed6c22] text-white hover:bg-[#d85f18]" : "bg-[#142033] text-white hover:bg-[#24324a]"}`} href={whatsappHref(plan.name)} target="_blank" rel="noreferrer">Escolher {plan.name}</a><a className="mt-2 rounded-lg px-4 py-2.5 text-center text-xs font-bold text-slate-500 hover:bg-slate-50 hover:text-slate-900" href={emailHref(plan.name)}>Pedir detalhes por email</a></article>)}</div>
          <p className="mt-7 text-center text-xs leading-5 text-slate-500">Os valores não incluem integrações ou desenvolvimento à medida. Esses serviços são orçamentados depois do diagnóstico da empresa.</p>
        </div>
      </section>

      <section id="contacto" className="bg-white py-20 lg:py-28">
        <div className="mx-auto max-w-[1240px] px-5 lg:px-8"><div className="overflow-hidden rounded-[28px] bg-[#ed6c22] px-7 py-12 text-white md:px-12 lg:flex lg:items-center lg:justify-between lg:px-16 lg:py-16"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-orange-100">Vamos conversar</p><h2 className="mt-3 max-w-2xl text-4xl font-black leading-tight tracking-[-0.035em]">Mostre-nos como gere as suas obras hoje.</h2><p className="mt-4 max-w-xl leading-7 text-orange-50">Em uma conversa curta, indicamos o plano certo e como preparar os primeiros projectos no SIGA.</p></div><div className="mt-9 flex min-w-fit flex-col gap-3 lg:mt-0"><a className="rounded-lg bg-white px-6 py-3.5 text-center text-sm font-black text-[#b8470a]" href={whatsappHref()} target="_blank" rel="noreferrer">WhatsApp · +58 846 63 84 194</a><a className="rounded-lg border border-white/40 px-6 py-3.5 text-center text-sm font-bold text-white hover:bg-white/10" href={emailHref()}>{CONTACT_EMAIL}</a></div></div></div>
      </section>
    </main>

    <footer className="border-t border-slate-800 bg-[#101827] py-10 text-white"><div className="mx-auto flex max-w-[1240px] flex-col gap-8 px-5 sm:flex-row sm:items-end sm:justify-between lg:px-8"><div><Brand light /><p className="mt-5 max-w-sm text-sm leading-6 text-slate-400">Uma plataforma de gestão de obras pensada para equipas que precisam de ligar custos, prazo e execução.</p></div><div className="text-sm text-slate-400 sm:text-right"><p>Moçambique · MZN e USD</p><p className="mt-2">© 2026 SIGA. Todos os direitos reservados.</p></div></div></footer>
  </div>;
}

import { Link, Navigate, useParams } from "react-router-dom";
import { Logo } from "../components/landing/brand/Logo";

const sections = {
  termos: {
    title: "Termos de utilização",
    intro: "Regras essenciais para utilizar o SIGO de forma segura e responsável.",
    blocks: [
      ["Serviço", "O SIGO apoia levantamentos, orçamentos e gestão de obras. Os resultados automáticos são auxiliares de trabalho e devem ser confirmados pelo responsável técnico antes de contratação, compra ou execução."],
      ["Conta e acesso", "A empresa é responsável pelos utilizadores que autoriza, pela confidencialidade das credenciais e pela exactidão dos dados introduzidos."],
      ["Dados da obra", "A empresa mantém a titularidade dos documentos e registos que submete. O SIGO trata esses dados apenas para prestar, proteger e melhorar o serviço."],
      ["Subscrição", "Preços, período, impostos e condições comerciais são apresentados antes da activação. Um pedido no checkout não constitui cobrança automática."],
      ["Disponibilidade e responsabilidade", "Procuramos manter o serviço disponível e os cálculos consistentes, mas nenhuma plataforma substitui validação profissional, normas aplicáveis, fiscalização ou decisões de segurança em obra."],
      ["Contacto", "Questões contratuais ou técnicas: licsenga.samuel@mechanical.co.mz."],
    ],
  },
  privacidade: {
    title: "Política de privacidade",
    intro: "Como o SIGO utiliza e protege dados pessoais e dados das obras.",
    blocks: [
      ["Dados recolhidos", "Dados de conta e empresa, contactos, registos de utilização, documentos submetidos, dados operacionais de obras e informação técnica necessária ao serviço."],
      ["Finalidades", "Autenticar utilizadores, executar funcionalidades contratadas, processar plantas, prestar suporte, prevenir abuso, manter auditoria e cumprir obrigações legais."],
      ["Partilha", "Não vendemos dados pessoais. O acesso por prestadores técnicos limita-se ao necessário para alojamento, email, segurança e suporte, sujeito a deveres de confidencialidade."],
      ["Conservação", "Os dados são conservados durante a prestação do serviço e pelo período necessário para segurança, auditoria, obrigações legais ou resolução de litígios."],
      ["Direitos e segurança", "Pode pedir acesso, correcção ou eliminação dos seus dados, quando aplicável. Usamos controlo de acesso, sessões protegidas e registos de auditoria, mas nenhuma medida elimina todos os riscos."],
      ["Contacto", "Pedidos sobre privacidade: licsenga.samuel@mechanical.co.mz."],
    ],
  },
} as const;

export default function LegalPage() {
  const { page } = useParams();
  const content = sections[page as keyof typeof sections];
  if (!content) return <Navigate to="/" replace />;
  return (
    <div className="min-h-dvh bg-surface text-ink">
      <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex min-h-20 max-w-4xl items-center justify-between px-5"><Link to="/"><Logo size={48} /></Link><Link to="/" className="text-sm font-semibold text-teal-700">← Voltar ao site</Link></div></header>
      <main className="mx-auto max-w-4xl px-5 py-10 sm:py-14">
        <p className="eyebrow text-accent">SIGO · actualizado em 12 de Agosto de 2026</p>
        <h1 className="mt-3 font-display text-3xl font-black sm:text-4xl">{content.title}</h1>
        <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">{content.intro}</p>
        <div className="mt-9 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white px-5 sm:px-8">
          {content.blocks.map(([title, body]) => <section key={title} className="py-6"><h2 className="font-display text-lg font-black">{title}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{body}</p></section>)}
        </div>
      </main>
    </div>
  );
}

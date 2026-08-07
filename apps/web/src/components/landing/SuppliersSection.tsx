import { Link } from "react-router-dom";
import { CheckIcon } from "lucide-react";
import { Eyebrow } from "./ui/Card";
import { Button } from "./ui/Button";
import { suppliersSection } from "../../data/landingContent";

export function SuppliersSection() {
  const { eyebrow, title, lead, forBuilders, forSuppliers } = suppliersSection;

  return (
    <section id="fornecedores" className="relative overflow-hidden border-y border-slate-200 bg-surface">
      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 10% 20%, rgba(13, 148, 136, 0.12), transparent 55%), radial-gradient(ellipse 60% 40% at 90% 80%, rgba(15, 23, 42, 0.06), transparent 50%)",
        }}
        aria-hidden="true"
      />
      <div className="relative mx-auto w-full max-w-[1500px] px-5 py-20 sm:px-8">
        <div className="max-w-2xl">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h2 className="mt-3 font-display text-[32px] font-bold leading-tight tracking-[-0.025em] text-ink sm:text-[42px]">
            {title}
          </h2>
          <p className="mt-4 text-[16px] leading-relaxed text-ink-400">{lead}</p>
        </div>

        <div className="mt-12 grid gap-8 lg:grid-cols-2 lg:gap-12">
          <div>
            <h3 className="font-display text-[19px] font-bold tracking-tight text-ink">{forBuilders.title}</h3>
            <ul className="mt-5 space-y-3.5">
              {forBuilders.points.map((point) => (
                <li key={point} className="flex gap-3 text-[14px] leading-relaxed text-ink-400">
                  <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" aria-hidden="true" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
            <div className="mt-7 flex flex-wrap gap-2.5">
              <a href="#planos">
                <Button>Ver plano Profissional</Button>
              </a>
              <Link to="/registar">
                <Button variant="secondary">Criar conta grátis</Button>
              </Link>
            </div>
          </div>

          <div>
            <h3 className="font-display text-[19px] font-bold tracking-tight text-ink">{forSuppliers.title}</h3>
            <ul className="mt-5 space-y-3.5">
              {forSuppliers.points.map((point) => (
                <li key={point} className="flex gap-3 text-[14px] leading-relaxed text-ink-400">
                  <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" aria-hidden="true" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
            <div className="mt-7 flex flex-wrap gap-2.5">
              <a href="/fornecedor/registar">
                <Button>Registar como fornecedor</Button>
              </a>
              <a href="/fornecedor/login">
                <Button variant="secondary">Entrar no portal</Button>
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

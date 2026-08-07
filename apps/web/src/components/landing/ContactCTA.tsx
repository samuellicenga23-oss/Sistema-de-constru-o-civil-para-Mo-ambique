import { Link } from "react-router-dom";
import { MailIcon, PhoneIcon } from "lucide-react";
import { SIGO_CONTACT_EMAIL } from "../../commercialPlans";
import { Button } from "./ui/Button";

export function ContactCTA() {
  return (
    <section className="mx-auto w-full max-w-[1500px] px-5 pb-20 sm:px-8">
      <div className="relative overflow-hidden rounded-2xl bg-brand-orange px-6 py-12 sm:px-12">
        <div
          className="absolute inset-0 opacity-[0.14]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
          aria-hidden="true"
        />
        <div className="relative flex flex-col items-start justify-between gap-8 lg:flex-row lg:items-center">
          <div className="max-w-2xl">
            <p className="text-eyebrow font-bold uppercase text-white/70">Comece esta semana</p>
            <h2 className="mt-3 font-display text-[30px] font-bold leading-tight tracking-[-0.025em] text-white sm:text-[40px]">
              Traga um mapa de quantidades e mostramos a obra inteira no SIGO
            </h2>
            <p className="mt-3 max-w-xl text-[15.5px] leading-relaxed text-white/85">
              Demonstração de 30 minutos com a nossa equipa, sobre os seus próprios dados de obra.
            </p>
          </div>
          <div className="flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row lg:flex-col">
            <Link to="/registar" className="w-full sm:w-auto">
              <Button variant="navy" size="lg" fullWidth className="sm:w-auto">
                Criar conta grátis
              </Button>
            </Link>
            <a href="tel:+258866384194" className="w-full sm:w-auto">
              <Button
                variant="secondary"
                size="lg"
                fullWidth
                className="border-white/40 bg-white/10 text-white hover:border-white hover:bg-white/20 sm:w-auto"
              >
                <PhoneIcon className="h-4 w-4" />
                +258 86 638 4194
              </Button>
            </a>
            <a
              href={`mailto:${SIGO_CONTACT_EMAIL}`}
              className="inline-flex items-center justify-center gap-2 text-[13px] font-semibold text-white/85 underline-offset-4 hover:underline"
            >
              <MailIcon className="h-3.5 w-3.5" />
              {SIGO_CONTACT_EMAIL}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

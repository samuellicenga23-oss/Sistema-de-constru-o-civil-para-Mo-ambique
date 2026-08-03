import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRightIcon, PlayCircleIcon } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { SIGO_WHATSAPP_NUMBER } from "../../commercialPlans";
import { Button } from "./ui/Button";
import { ProductMock } from "./ProductMock";

function whatsappHref() {
  const message = "Olá Samuel. Gostaria de ver o SIGO em funcionamento para a minha empresa.";
  return `https://wa.me/${SIGO_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

export function Hero() {
  const { user } = useAuth();
  const demoHref = user ? (user.role === "super_admin" ? "/admin" : "/painel") : whatsappHref();
  const demoExternal = !user;

  return (
    <section id="inicio" className="relative overflow-hidden">
      <div className="sigo-grid absolute inset-0 opacity-70" aria-hidden="true" />
      <div
        className="absolute inset-x-0 top-0 h-[560px]"
        style={{
          background:
            "radial-gradient(40rem 34rem at 18% 0%, rgba(26,173,180,0.16), transparent 62%), radial-gradient(36rem 30rem at 88% 8%, rgba(237,108,34,0.12), transparent 60%)",
        }}
        aria-hidden="true"
      />

      <div className="relative mx-auto w-full max-w-[1500px] px-5 pb-16 pt-14 sm:px-8 sm:pt-20">
        <div className="mx-auto max-w-3xl text-center">
          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="inline-flex items-center gap-2 rounded-full border border-teal-100 bg-white px-3 py-1.5 text-eyebrow font-bold uppercase text-teal-700 shadow-card"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-brand-orange" />
            SIGO · Software de gestão de obras · Moçambique
          </motion.p>

          <motion.h1
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.05 }}
            className="mt-6 font-display text-[40px] font-bold leading-[1.02] tracking-[-0.03em] text-ink sm:text-[62px] lg:text-[76px]"
          >
            Controle a obra como
            <br className="hidden sm:block" /> ela realmente acontece.
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.12 }}
            className="mx-auto mt-5 max-w-2xl text-[16.5px] leading-relaxed text-ink-400 sm:text-[18px]"
          >
            O SIGO liga o orçamento ao planeamento, às compras, ao campo e à medição — num só fluxo,
            para que cada quantidade medida no estaleiro chegue ao auto e à facturação sem folhas de
            cálculo paralelas.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.18 }}
            className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row"
          >
            {demoExternal ? (
              <a href={demoHref} target="_blank" rel="noreferrer" className="w-full sm:w-auto">
                <Button size="lg" fullWidth className="sm:w-auto">
                  <PlayCircleIcon className="h-4 w-4" />
                  Ver o SIGO em funcionamento
                </Button>
              </a>
            ) : (
              <Link to={demoHref} className="w-full sm:w-auto">
                <Button size="lg" fullWidth className="sm:w-auto">
                  <PlayCircleIcon className="h-4 w-4" />
                  Abrir plataforma
                </Button>
              </Link>
            )}
            <a href="#produto" className="w-full sm:w-auto">
              <Button size="lg" variant="secondary" fullWidth className="sm:w-auto">
                Explorar a plataforma
                <ArrowRightIcon className="h-4 w-4" />
              </Button>
            </a>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.24, ease: [0.22, 1, 0.36, 1] }}
          className="mx-auto mt-14 max-w-[1240px]"
        >
          <ProductMock />
        </motion.div>

        <div className="mx-auto mt-12 flex max-w-4xl flex-wrap items-center justify-center gap-x-10 gap-y-3">
          <p className="text-eyebrow font-bold uppercase text-slate-400">Usado por equipas de obra em</p>
          {["Maputo", "Matola", "Beira", "Nampula", "Tete"].map((c) => (
            <span key={c} className="font-display text-[15px] font-bold tracking-tight text-ink/45">
              {c}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { MinusIcon, PlusIcon } from 'lucide-react';
import { Eyebrow } from './ui/Card';
import { faqs } from '../../data/landingContent';

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" className="mx-auto w-full max-w-[1500px] px-5 py-20 sm:px-8">
      <div className="grid gap-10 lg:grid-cols-[0.75fr_1.25fr]">
        <div>
          <Eyebrow tone="orange">Perguntas frequentes</Eyebrow>
          <h2 className="mt-3 font-display text-[32px] font-bold leading-tight tracking-[-0.025em] text-ink sm:text-[40px]">
            Dúvidas de quem trabalha em obra
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-ink-400">
            Não encontra a sua pergunta? Fale com a nossa equipa em Maputo — respondemos por WhatsApp
            no mesmo dia útil.
          </p>
        </div>

        <div className="divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
          {faqs.map((f, i) => {
            const isOpen = open === i;
            return (
              <div key={f.q}>
                <h3>
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : i)}
                    aria-expanded={isOpen}
                    className="flex w-full items-start justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal">
                    
                    <span className="font-display text-[15px] font-bold tracking-tight text-ink">
                      {f.q}
                    </span>
                    <span
                      className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${
                      isOpen ? 'bg-ink text-teal-bright' : 'bg-slate-100 text-ink-400'}`
                      }>
                      
                      {isOpen ? <MinusIcon className="h-3.5 w-3.5" /> : <PlusIcon className="h-3.5 w-3.5" />}
                    </span>
                  </button>
                </h3>
                <AnimatePresence initial={false}>
                  {isOpen &&
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                    className="overflow-hidden">
                    
                      <p className="px-5 pb-5 text-[14px] leading-relaxed text-ink-400">{f.a}</p>
                    </motion.div>
                  }
                </AnimatePresence>
              </div>);

          })}
        </div>
      </div>
    </section>);

}
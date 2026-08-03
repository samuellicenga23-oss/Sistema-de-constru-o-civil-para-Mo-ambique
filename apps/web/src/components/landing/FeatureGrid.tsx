import React from 'react';
import { motion } from 'framer-motion';
import { Eyebrow } from './ui/Card';
import { Icon } from './ui/Icon';
import { features } from '../../data/landingContent';

export function FeatureGrid() {
  return (
    <section id="funcionalidades" className="relative border-y border-slate-200 bg-white">
      <div className="mx-auto w-full max-w-[1500px] px-5 py-20 sm:px-8">
        <div className="max-w-2xl">
          <Eyebrow>Um fluxo, sem ilhas de informação</Eyebrow>
          <h2 className="mt-3 font-display text-[32px] font-bold leading-tight tracking-[-0.025em] text-ink sm:text-[42px]">
            Tudo o que a obra precisa, ligado de ponta a ponta
          </h2>
          <p className="mt-4 text-[16px] leading-relaxed text-ink-400">
            Cada módulo alimenta o seguinte. O que é medido em planta transforma-se em orçamento, em
            plano de trabalhos, em pedido de compra e, no fim do mês, em auto de medição.
          </p>
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f, i) =>
          <motion.article
            key={f.title}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.35, delay: i * 0.05 }}
            className="group rounded-2xl border border-slate-200 bg-white p-6 shadow-card transition-shadow hover:shadow-raised">
            
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-50 text-teal-600 transition-colors group-hover:bg-ink group-hover:text-teal-bright">
                <Icon name={f.icon} className="h-[20px] w-[20px]" />
              </span>
              <h3 className="mt-4 font-display text-[17px] font-bold tracking-tight text-ink">
                {f.title}
              </h3>
              <p className="mt-2 text-[14px] leading-relaxed text-ink-400">{f.description}</p>
            </motion.article>
          )}
        </div>
      </div>
    </section>);

}
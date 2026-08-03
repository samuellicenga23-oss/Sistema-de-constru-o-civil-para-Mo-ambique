import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { CheckIcon } from 'lucide-react';
import { Eyebrow } from './ui/Card';
import { CodeTag } from './ui/Badge';
import { productTabs } from '../../data/landingContent';
import { formatMZN } from '../../utils/landingFormat';

const previewRows = [
{ code: '3.1.010', desc: 'Betão C25/30 em sapatas', unit: 'm³', qty: 1240, price: 11_450 },
{ code: '3.1.020', desc: 'Aço A500 NR em armaduras', unit: 'kg', qty: 96_400, price: 168 },
{ code: '3.2.020', desc: 'Laje maciça esp. 0,22 m', unit: 'm²', qty: 6_420, price: 4_980 },
{ code: '3.1.030', desc: 'Impermeabilização de maciços', unit: 'm²', qty: 1_920, price: null }];


export function ProductTabs() {
  const [active, setActive] = useState(productTabs[0].id);
  const tab = productTabs.find((t) => t.id === active) ?? productTabs[0];

  return (
    <section id="produto" className="relative overflow-hidden">
      <div className="mx-auto w-full max-w-[1500px] px-5 py-20 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-xl">
            <Eyebrow tone="orange">A plataforma por dentro</Eyebrow>
            <h2 className="mt-3 font-display text-[32px] font-bold leading-tight tracking-[-0.025em] text-ink sm:text-[42px]">
              Três perspectivas sobre a mesma obra
            </h2>
          </div>

          <div
            role="tablist"
            aria-label="Perspectivas do produto"
            className="relative flex rounded-xl border border-slate-200 bg-white p-1 shadow-card">
            
            {productTabs.map((t) =>
            <button
              key={t.id}
              role="tab"
              aria-selected={active === t.id}
              onClick={() => setActive(t.id)}
              className={`relative rounded-lg px-4 py-2 text-[13.5px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal ${
              active === t.id ? 'text-white' : 'text-ink-400 hover:text-teal-700'}`
              }>
              
                {active === t.id &&
              <motion.span
                layoutId="tab-pill"
                className="absolute inset-0 rounded-lg bg-ink"
                transition={{ type: 'spring', stiffness: 420, damping: 34 }} />

              }
                <span className="relative">{t.label}</span>
              </button>
            )}
          </div>
        </div>

        <div className="mt-10 grid items-stretch gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <motion.div
            key={tab.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28 }}
            className="rounded-2xl border border-slate-200 bg-white p-7 shadow-card">
            
            <h3 className="font-display text-[24px] font-bold leading-snug tracking-[-0.02em] text-ink">
              {tab.title}
            </h3>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-400">{tab.description}</p>
            <ul className="mt-6 space-y-3">
              {tab.bullets.map((b) =>
              <li key={b} className="flex items-start gap-3 text-[14px] font-medium text-ink">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-teal-50 text-teal-600">
                    <CheckIcon className="h-3 w-3" />
                  </span>
                  {b}
                </li>
              )}
            </ul>
          </motion.div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-raised">
            <div className="flex items-center justify-between border-b border-slate-200 bg-surface-sidebar px-4 py-3">
              <div>
                <p className="text-eyebrow font-bold uppercase text-teal-600">ORC-2041/03</p>
                <p className="font-display text-[13.5px] font-bold text-ink">
                  Capítulo 3 · Estrutura de betão armado
                </p>
              </div>
              <span className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-ink-400">
                Zona: Maputo Cidade
              </span>
            </div>
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="bg-slate-50 text-[10px] uppercase tracking-[0.08em] text-ink-400">
                  <th scope="col" className="px-4 py-2 text-left font-bold">Código</th>
                  <th scope="col" className="px-2 py-2 text-left font-bold">Descrição</th>
                  <th scope="col" className="px-2 py-2 text-left font-bold">Un.</th>
                  <th scope="col" className="px-2 py-2 text-right font-bold">Qtd.</th>
                  <th scope="col" className="px-4 py-2 text-right font-bold">Preço un. MZN</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((r) =>
                <tr
                  key={r.code}
                  className={`border-t border-slate-100 ${r.price === null ? 'bg-amber-50' : ''}`}>
                  
                    <td className="px-4 py-2.5">
                      <CodeTag>{r.code}</CodeTag>
                    </td>
                    <td className="px-2 py-2.5 font-medium text-ink">{r.desc}</td>
                    <td className="px-2 py-2.5 text-ink-400">{r.unit}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-ink">
                      {formatMZN(r.qty).replace(',00', '')}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {r.price === null ?
                    <span className="rounded-md border border-amber-200 bg-white px-1.5 py-0.5 text-[10.5px] font-bold text-amber-700">
                          Sem preço
                        </span> :

                    <span className="font-semibold text-ink">{formatMZN(r.price)}</span>
                    }
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="flex items-center justify-between border-t border-slate-200 bg-ink px-4 py-3">
              <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/60">
                Total do capítulo
              </span>
              <span className="font-display text-[15px] font-bold text-teal-bright">
                {formatMZN(74_310_000)} MZN
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>);

}
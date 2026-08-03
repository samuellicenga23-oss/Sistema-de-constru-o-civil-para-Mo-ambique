import React from 'react';
import { CheckIcon } from 'lucide-react';
import { Eyebrow } from './ui/Card';
import { Icon } from './ui/Icon';
import { roles } from '../../data/landingContent';

export function Roles() {
  return (
    <section id="perfis" className="relative bg-ink">
      <div className="sigo-grid-dark absolute inset-0" aria-hidden="true" />
      <div className="relative mx-auto w-full max-w-[1500px] px-5 py-20 sm:px-8">
        <div className="max-w-2xl">
          <Eyebrow tone="light">Perfis de utilização</Eyebrow>
          <h2 className="mt-3 font-display text-[32px] font-bold leading-tight tracking-[-0.025em] text-white sm:text-[42px]">
            A mesma obra, vista por quem a executa, fiscaliza e paga
          </h2>
          <p className="mt-4 text-[16px] leading-relaxed text-white/60">
            Cada perfil entra no SIGO com as permissões e os indicadores que lhe interessam, sobre a
            mesma base de dados de quantidades e preços.
          </p>
        </div>

        <div className="mt-12 grid gap-4 lg:grid-cols-3">
          {roles.map((r) =>
          <article
            key={r.role}
            className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 transition-colors hover:border-teal/40 hover:bg-white/[0.07]">
            
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal/15 text-teal-bright">
                <Icon name={r.icon} className="h-5 w-5" />
              </span>
              <h3 className="mt-4 font-display text-[19px] font-bold tracking-tight text-white">
                {r.role}
              </h3>
              <p className="mt-2 text-[14px] leading-relaxed text-white/60">{r.description}</p>
              <ul className="mt-5 space-y-2.5 border-t border-white/10 pt-5">
                {r.points.map((p) =>
              <li key={p} className="flex items-center gap-2.5 text-[13.5px] font-medium text-white/85">
                    <CheckIcon className="h-3.5 w-3.5 shrink-0 text-teal-bright" />
                    {p}
                  </li>
              )}
              </ul>
            </article>
          )}
        </div>
      </div>
    </section>);

}
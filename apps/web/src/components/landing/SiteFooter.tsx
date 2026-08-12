import React from 'react';
import { Link } from 'react-router-dom';
import { Logo } from './brand/Logo';

const columns = [
  {
    title: 'Plataforma',
    links: [
      ['Levantamentos', '/#produto'], ['Orçamentos', '/#produto'], ['Gestão da obra', '/#plataforma'], ['Planos', '/#planos'],
    ],
  },
  {
    title: 'SIGO',
    links: [
      ['Como funciona', '/#plataforma'], ['Perguntas frequentes', '/#faq'], ['Criar conta', '/registar'], ['Entrar', '/login'],
    ],
  },
  {
    title: 'Contacto',
    links: [
      ['Email', 'mailto:licsenga.samuel@mechanical.co.mz'], ['WhatsApp', 'https://wa.me/258866384194'], ['Termos', '/legal/termos'], ['Privacidade', '/legal/privacidade'],
    ],
  },
] as const;


export function SiteFooter() {
  return (
    <footer className="bg-ink">
      <div className="mx-auto w-full max-w-[1500px] px-5 py-14 sm:px-8">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_2fr]">
          <div>
            <Logo size={54} tone="light" showTagline />
            <p className="mt-5 max-w-sm text-[13.5px] leading-relaxed text-white/55">
              SIGO é uma plataforma moçambicana de gestão de obras: orçamento, planeamento, compras com
              fornecedores na zona da obra, campo e medição num só sistema.
            </p>
            <p className="mt-5 text-[12.5px] text-white/40">
              Moçambique · MZN e USD
            </p>
          </div>

          <div className="grid gap-8 sm:grid-cols-3">
            {columns.map((col) =>
            <div key={col.title}>
                <p className="text-eyebrow font-bold uppercase text-teal-bright">{col.title}</p>
                <ul className="mt-4 space-y-2.5">
                  {col.links.map(([label, href]) =>
                <li key={label}>
                      <a
                    href={href}
                    className="text-[13.5px] text-white/65 transition-colors hover:text-white">
                    
                        {label}
                      </a>
                    </li>
                )}
                </ul>
              </div>
            )}
          </div>
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-4 border-t border-white/10 pt-6 sm:flex-row sm:items-center">
          <p className="text-[12.5px] text-white/40">
            © 2026 SIGO — Sistema Integrado de Gestão de Obras. Todos os direitos reservados.
          </p>
          <div className="flex items-center gap-5 text-[12.5px] text-white/55">
            <Link to="/legal/termos" className="hover:text-white">
              Termos
            </Link>
            <Link to="/legal/privacidade" className="hover:text-white">
              Privacidade
            </Link>
            <Link to="/login" className="font-semibold text-teal-bright hover:text-white">
              Entrar no SIGO
            </Link>
          </div>
        </div>
      </div>
    </footer>);

}

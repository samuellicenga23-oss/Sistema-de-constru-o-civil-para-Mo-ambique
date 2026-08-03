import React from 'react';
import { Link } from 'react-router-dom';
import { Logo } from './brand/Logo';

const columns = [
{
  title: 'Plataforma',
  links: ['Medições', 'Orçamentos', 'Catálogo de preços', 'Cronograma', 'Autos de medição']
},
{
  title: 'Empresa',
  links: ['Sobre o SIGO', 'Clientes', 'Parceiros', 'Trabalhar connosco']
},
{
  title: 'Recursos',
  links: ['Centro de ajuda', 'Guia de orçamentação', 'Estado do serviço', 'Contacto']
}];


export function SiteFooter() {
  return (
    <footer className="bg-ink">
      <div className="mx-auto w-full max-w-[1500px] px-5 py-14 sm:px-8">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_2fr]">
          <div>
            <Logo size={54} tone="light" showTagline />
            <p className="mt-5 max-w-sm text-[13.5px] leading-relaxed text-white/55">
              SIGO é uma plataforma moçambicana de gestão de obras: orçamento, planeamento, compras,
              campo e medição num só sistema.
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
                  {col.links.map((l) =>
                <li key={l}>
                      <a
                    href="#produto"
                    className="text-[13.5px] text-white/65 transition-colors hover:text-white">
                    
                        {l}
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
            <a href="#planos" className="hover:text-white">
              Termos
            </a>
            <a href="#planos" className="hover:text-white">
              Privacidade
            </a>
            <Link to="/login" className="font-semibold text-teal-bright hover:text-white">
              Entrar no SIGO
            </Link>
          </div>
        </div>
      </div>
    </footer>);

}

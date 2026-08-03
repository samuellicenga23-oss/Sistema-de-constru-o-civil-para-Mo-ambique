import React from 'react';
import { ArrowUpRightIcon, CircleDotIcon } from 'lucide-react';
import { LogoMark } from './brand/Logo';
import { formatMZN } from '../../utils/landingFormat';

const ganttRows = [
{ code: '1', name: 'Estaleiro', offset: 0, span: 3, progress: 100, summary: true },
{ code: '2', name: 'Movimento de terras', offset: 2, span: 4, progress: 88 },
{ code: '3', name: 'Estrutura betão armado', offset: 5, span: 6, progress: 34, summary: true },
{ code: '4', name: 'Alvenarias', offset: 9, span: 4, progress: 0 },
{ code: '5', name: 'Instalações técnicas', offset: 11, span: 3, progress: 0 }];


const frentes = [
{ name: 'Fundações · Bloco A', value: 29_450_000, progress: 76 },
{ name: 'Estrutura · Bloco A', value: 44_860_000, progress: 34 },
{ name: 'Infra-estruturas exteriores', value: 12_180_000, progress: 12 }];


export function ProductMock() {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-mock">
      {/* window chrome */}
      <div className="flex items-center gap-3 border-b border-slate-200 bg-surface-sidebar px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
        </div>
        <div className="flex h-6 flex-1 items-center rounded-md border border-slate-200 bg-white px-2 font-mono text-[10px] text-slate-400">
          app.sigo.co.mz/obras/OB-2041/execucao
        </div>
      </div>

      <div className="flex">
        {/* mini sidebar */}
        <div className="hidden w-[168px] shrink-0 border-r border-slate-200 bg-surface-sidebar p-3 sm:block">
          <div className="flex items-center gap-2">
            <LogoMark size={24} />
            <span className="font-display text-[11px] font-bold tracking-[0.18em] text-ink">SIGO</span>
          </div>
          <div className="mt-3 space-y-1.5">
            {['Painel', 'Medições', 'Orçamentos', 'Catálogo', 'Fornecedores', 'Cálculos'].map((m, i) =>
            <div
              key={m}
              className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-[10.5px] font-semibold ${
              i === 0 ? 'bg-white text-ink shadow-sm' : 'text-ink-400'}`
              }>
              
                <span className={`h-1.5 w-1.5 rounded-full ${i === 0 ? 'bg-teal' : 'bg-slate-300'}`} />
                {m}
                {i === 0 && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-brand-orange" />}
              </div>
            )}
          </div>
        </div>

        {/* main */}
        <div className="min-w-0 flex-1 p-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-teal-600">
                Obra OB-2041 · Katembe
              </p>
              <p className="font-display text-[15px] font-bold tracking-tight text-ink">
                Execução da empreitada
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-semibold text-ink-400">
                Junho 2026
              </span>
              <span className="rounded-lg bg-brand-orange px-2.5 py-1 text-[10px] font-bold text-white">
                Novo auto
              </span>
            </div>
          </div>

          {/* KPIs */}
          <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
            {[
            { l: 'Certificado', v: '268,9 M', s: 'MZN acumulado' },
            { l: 'Prazo', v: '62%', s: 'Semana 17 de 26' },
            { l: 'Desvio de custo', v: '-2,4%', s: 'face ao orçamento' },
            { l: 'Itens sem preço', v: '4', s: 'a resolver' }].
            map((k) =>
            <div key={k.l} className="rounded-xl border border-slate-200 bg-white p-2.5">
                <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">{k.l}</p>
                <p className="mt-1 font-display text-[16px] font-bold leading-none text-ink">{k.v}</p>
                <p className="mt-1 text-[9.5px] text-ink-400">{k.s}</p>
              </div>
            )}
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-[1.35fr_1fr]">
            {/* mini gantt */}
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-ink-400">
                  Cronograma · WBS
                </p>
                <span className="font-mono text-[9.5px] text-teal-600">baseline 02</span>
              </div>
              <div className="mb-1.5 flex gap-[3px] pl-[104px]">
                {Array.from({ length: 14 }).map((_, i) =>
                <span key={i} className="h-1 flex-1 rounded-full bg-slate-100" />
                )}
              </div>
              <div className="space-y-[7px]">
                {ganttRows.map((r) =>
                <div key={r.code} className="flex items-center gap-2">
                    <span className="w-[26px] shrink-0 font-mono text-[9.5px] text-teal-600">{r.code}</span>
                    <span className="w-[74px] shrink-0 truncate text-[10px] font-semibold text-ink">
                      {r.name}
                    </span>
                    <span className="relative flex h-3 flex-1 items-center gap-[3px]">
                      {Array.from({ length: 14 }).map((_, i) =>
                    <span key={i} className="h-full flex-1 border-r border-slate-100 last:border-0" />
                    )}
                      <span
                      className={`absolute h-[9px] overflow-hidden ${
                      r.summary ? 'rounded-[3px] bg-ink' : 'rounded-full bg-ink-700'}`
                      }
                      style={{
                        left: `${r.offset / 14 * 100}%`,
                        width: `${r.span / 14 * 100}%`
                      }}>
                      
                        <span
                        className="block h-full bg-brand-orange"
                        style={{ width: `${r.progress}%` }} />
                      
                      </span>
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* frentes */}
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-ink-400">
                Frentes por valor
              </p>
              <div className="space-y-2.5">
                {frentes.map((f) =>
                <div key={f.name}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[10.5px] font-semibold text-ink">{f.name}</span>
                      <span className="shrink-0 font-mono text-[9.5px] text-ink-400">
                        {formatMZN(f.value, { compact: true })}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-teal" style={{ width: `${f.progress}%` }} />
                    </div>
                  </div>
                )}
              </div>
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2">
                <CircleDotIcon className="h-3 w-3 shrink-0 text-amber-600" />
                <p className="text-[9.5px] font-semibold leading-tight text-amber-800">
                  4 itens sem preço no orçamento Rev. 03
                </p>
              </div>
              <div className="mt-2 flex items-center justify-between rounded-lg bg-ink px-2.5 py-2">
                <span className="text-[9.5px] font-semibold text-white/70">Auto 014 em aprovação</span>
                <ArrowUpRightIcon className="h-3 w-3 text-teal-bright" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>);

}
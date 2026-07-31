import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { boqApi, type Project } from "../api/boq";
import { financialApi, type FinancialEntry, type FinancialSummary } from "../api/financial";
import Layout from "../components/Layout";
import { MetricCard, SectionHeader } from "../components/WorkspaceUI";
import ProjectWorkspaceNav from "../components/ProjectWorkspaceNav";
import Modal from "../components/Modal";
import PageSearch from "../components/PageSearch";
import { IconBack, IconPlus, IconTrash } from "../components/icons";

const CATEGORY_SUGGESTIONS_DESPESA = ["Mão-de-obra", "Materiais", "Equipamento", "Subcontratação", "Transporte", "Outros"];
const CATEGORY_SUGGESTIONS_RECEITA = ["Adiantamento do cliente", "Pagamento do cliente", "Retenção libertada", "Outros"];

function fmt(value: number, currency: string) {
  return `${value.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function ProjectFinancialPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [entries, setEntries] = useState<FinancialEntry[]>([]);
  const [summary, setSummary] = useState<FinancialSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [query, setQuery] = useState("");

  const [type, setType] = useState<"receita" | "despesa">("despesa");
  const [category, setCategory] = useState("Materiais");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState(todayStr());
  const [markPaidNow, setMarkPaidNow] = useState(false);

  async function reload() {
    if (!projectId) return;
    const [proj, list, sum] = await Promise.all([boqApi.getProject(projectId), financialApi.list(projectId), financialApi.summary(projectId)]);
    setProject(proj);
    setEntries(list);
    setSummary(sum);
  }

  useEffect(() => {
    reload().catch((err) => setError(err.message));
  }, [projectId]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!projectId) return;
    const amountNum = Number(amount);
    if (!(amountNum > 0)) return;
    setError(null);
    setSaving(true);
    try {
      await financialApi.create(projectId, {
        type,
        category,
        description: description.trim() || undefined,
        amount: amountNum,
        currency: project?.currency ?? "MZN",
        dueDate,
        status: markPaidNow ? "pago" : "pendente",
        paidDate: markPaidNow ? todayStr() : undefined,
      });
      setDescription("");
      setAmount("");
      setMarkPaidNow(false);
      setShowForm(false);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao registar lançamento");
    } finally {
      setSaving(false);
    }
  }

  async function handleMarkPaid(entry: FinancialEntry) {
    setError(null);
    try {
      await financialApi.update(entry.id, { status: "pago", paidDate: todayStr() });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao actualizar lançamento");
    }
  }

  async function handleDelete(entry: FinancialEntry) {
    if (!window.confirm(`Eliminar este lançamento (${entry.category}, ${entry.amount} ${entry.currency})? Esta acção não pode ser desfeita.`)) return;
    setError(null);
    try {
      await financialApi.delete(entry.id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao eliminar lançamento");
    }
  }

  const filteredEntries = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("pt");
    if (!needle) return entries;
    return entries.filter((entry) => [
      entry.type,
      entry.category,
      entry.description,
      entry.status,
      entry.dueDate,
      entry.paidDate,
      entry.sourceType,
    ].filter(Boolean).join(" ").toLocaleLowerCase("pt").includes(needle));
  }, [entries, query]);

  if (!project || !summary) {
    return <div className="min-h-screen flex items-center justify-center text-gray-400">A carregar...</div>;
  }

  const currency = summary.currency;
  const suggestions = type === "despesa" ? CATEGORY_SUGGESTIONS_DESPESA : CATEGORY_SUGGESTIONS_RECEITA;

  return (
    <Layout
      title={`Financeiro — ${project.name}`}
      subtitle="Compromissos de compras, receitas dos autos, pagamentos e fluxo de caixa da obra"
      actions={
        <Link to={`/projectos/${projectId}`} className="btn btn-ghost btn-sm">
          <IconBack className="w-3.5 h-3.5" />
          Projecto
        </Link>
      }
    >
      <div className="mx-auto w-full max-w-7xl space-y-5">
        <ProjectWorkspaceNav projectId={projectId!} />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-900"><strong>Sincronizado com compras e autos.</strong> Aqui confirma pagamentos e regista excepções.</div>

        {/* Indicadores */}
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <MetricCard label="Valor contratado" value={fmt(summary.valorContratado, currency)} />
          <MetricCard label="Valor recebido" value={fmt(summary.valorRecebido, currency)} tone="positive" />
          <MetricCard label="Custo realizado" value={fmt(summary.custoRealizado, currency)} tone="negative" />
          <MetricCard label="Margem realizada" value={fmt(summary.saldo, currency)} tone={summary.saldo >= 0 ? "positive" : "negative"} />
          <MetricCard label="Contas a receber" value={fmt(summary.contasAReceber, currency)} tone="info" />
          <MetricCard label="Contas a pagar" value={fmt(summary.contasAPagar, currency)} tone="warning" />
        </div>
        <details className="-mt-3 rounded-lg px-1 text-xs text-slate-500"><summary className="font-semibold text-slate-600">Como é calculada a margem?</summary><p className="pt-2 leading-5">Margem realizada = valor recebido − custo pago. Pendências não entram no caixa antes da liquidação.</p></details>

        {/* Fluxo de caixa mensal */}
        {summary.fluxoCaixaMensal.length > 0 && (
          <section className="card">
            <SectionHeader title="Fluxo de caixa mensal" description="Receitas e despesas efectivamente pagas por mês" />
            <div className="divide-y divide-slate-100 sm:hidden">{summary.fluxoCaixaMensal.map((m) => <div key={`mobile-${m.month}`} className="p-4"><div className="flex items-center justify-between"><strong className="text-sm text-slate-900">{m.month}</strong><strong className={`text-sm tabular-nums ${m.saldo >= 0 ? "text-green-700" : "text-red-600"}`}>{fmt(m.saldo, currency)}</strong></div><div className="mt-2 flex justify-between text-xs"><span className="text-green-700">Receitas {fmt(m.receitas, currency)}</span><span className="text-red-600">Despesas {fmt(m.despesas, currency)}</span></div></div>)}</div>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-sm min-w-[480px]">
                <thead>
                  <tr className="table-head-row">
                    <th className="text-left py-2 px-5 font-medium">Mês</th>
                    <th className="text-right font-medium">Receitas</th>
                    <th className="text-right font-medium">Despesas</th>
                    <th className="text-right font-medium pr-5">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.fluxoCaixaMensal.map((m) => (
                    <tr key={m.month} className="table-row">
                      <td className="py-2 px-5">{m.month}</td>
                      <td className="text-right tabular-nums text-green-700">{fmt(m.receitas, currency)}</td>
                      <td className="text-right tabular-nums text-red-600">{fmt(m.despesas, currency)}</td>
                      <td className={`text-right pr-5 tabular-nums font-medium ${m.saldo >= 0 ? "text-green-700" : "text-red-600"}`}>
                        {fmt(m.saldo, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Novo lançamento */}
        <section className="card overflow-hidden"><SectionHeader title="Movimentos excepcionais" description="Use apenas para valores que não vêm de compras ou autos" actions={<button type="button" onClick={() => setShowForm(true)} className="btn btn-primary btn-sm"><IconPlus className="h-3.5 w-3.5" /> Novo lançamento</button>} /></section>
        {showForm && <Modal title="Novo lançamento financeiro" subtitle={`Receita ou despesa · ${project.name}`} onClose={() => !saving && setShowForm(false)} maxWidth="max-w-3xl"><form onSubmit={handleCreate} className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Tipo</label>
              <select value={type} onChange={(e) => setType(e.target.value as "receita" | "despesa")} className="input">
                <option value="despesa">Despesa</option>
                <option value="receita">Receita</option>
              </select>
            </div>
            <div>
              <label className="label">Categoria</label>
              <input value={category} onChange={(e) => setCategory(e.target.value)} list="category-suggestions" className="input" />
              <datalist id="category-suggestions">
                {suggestions.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div className="sm:col-span-2">
              <label className="label">Descrição (opcional)</label>
              <input value={description} onChange={(e) => setDescription(e.target.value)} className="input" />
            </div>
            <div>
              <label className="label">Valor ({project.currency})</label>
              <input type="number" step="0.01" min="0" required value={amount} onChange={(e) => setAmount(e.target.value)} className="input" />
            </div>
            <div>
              <label className="label">Data de vencimento</label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="input" />
            </div>
            <label className="flex items-center gap-2 rounded-lg bg-slate-50 p-3 text-sm text-gray-700 sm:col-span-2">
              <input type="checkbox" checked={markPaidNow} onChange={(e) => setMarkPaidNow(e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-brand-700" />
              Já foi {type === "receita" ? "recebido" : "pago"} (marca como pago hoje)
            </label>
            <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:col-span-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setShowForm(false)} className="btn btn-secondary">Cancelar</button><button type="submit" disabled={saving} className="btn btn-primary">
              <IconPlus className="w-4 h-4" />
              {saving ? "A guardar..." : "Registar"}
            </button></div>
          </form></Modal>}

        {/* Lista de lançamentos */}
        <section className="card">
          <SectionHeader title="Lançamentos" description={`${entries.length} movimento(s) registado(s)`} />
          <div className="border-b border-slate-100 px-4 py-3 sm:px-5"><PageSearch value={query} onChange={setQuery} placeholder="Pesquisar categoria, descrição, estado ou data…" resultLabel={`${filteredEntries.length} movimento(s)`} /></div>
          <div className="divide-y divide-slate-100 md:hidden">{filteredEntries.map((entry) => <article key={`mobile-${entry.id}`} className="p-4"><div className="flex items-start justify-between gap-3"><div><span className={`badge ${entry.type === "receita" ? "badge-green" : "badge-red"}`}>{entry.type === "receita" ? "Receita" : "Despesa"}</span><strong className="mt-2 block text-sm text-slate-900">{entry.category}</strong><p className="mt-1 text-xs text-slate-500">{entry.description ?? (entry.sourceType === "purchase_order" ? "Ordem de compra" : entry.sourceType === "measurement_certificate" ? "Auto de medição" : "Sem descrição")}</p></div><div className="text-right"><strong className="block text-sm tabular-nums">{fmt(Number(entry.amount), entry.currency)}</strong><span className={`badge mt-2 ${entry.status === "pago" ? "badge-green" : "badge-yellow"}`}>{entry.status === "pago" ? "Pago" : "Pendente"}</span></div></div><div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3"><span className="text-xs text-slate-500">Vence {entry.dueDate || "—"}</span><div className="flex gap-2">{entry.status === "pendente" && <button onClick={() => handleMarkPaid(entry)} className="btn btn-secondary btn-sm text-green-700">Marcar pago</button>}{!entry.sourceType && <button onClick={() => handleDelete(entry)} className="icon-btn-danger" title="Eliminar lançamento"><IconTrash className="h-3.5 w-3.5" /></button>}</div></div></article>)}</div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="table-head-row">
                  <th className="text-left py-2 px-5 font-medium">Tipo</th>
                  <th className="text-left font-medium">Categoria</th>
                  <th className="text-left font-medium">Descrição</th>
                  <th className="text-right font-medium">Valor</th>
                  <th className="text-left font-medium">Vencimento</th>
                  <th className="text-left font-medium">Estado</th>
                  <th className="text-left font-medium pr-5">Acções</th>
                </tr>
              </thead>
              <tbody>
                {filteredEntries.map((e) => (
                  <tr key={e.id} className="table-row group">
                    <td className="py-2 px-5">
                      <span className={`badge ${e.type === "receita" ? "badge-green" : "badge-red"}`}>{e.type === "receita" ? "Receita" : "Despesa"}</span>
                    </td>
                    <td><span className="font-medium">{e.category}</span>{e.sourceType && <span className="mt-1 block w-fit rounded bg-blue-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700">{e.sourceType === "purchase_order" ? "Ordem de compra" : "Auto de medição"}</span>}</td>
                    <td className="text-gray-500">{e.description ?? "—"}</td>
                    <td className="text-right tabular-nums font-medium">{fmt(Number(e.amount), e.currency)}</td>
                    <td className="text-gray-500">{e.dueDate ?? "—"}</td>
                    <td>
                      <span className={`badge ${e.status === "pago" ? "badge-green" : "badge-yellow"}`}>{e.status === "pago" ? "Pago" : "Pendente"}</span>
                    </td>
                    <td className="pr-5 space-x-3">
                      {e.status === "pendente" && (
                        <button onClick={() => handleMarkPaid(e)} className="btn btn-secondary btn-sm text-green-700">
                          Marcar pago
                        </button>
                      )}
                      {!e.sourceType && <button onClick={() => handleDelete(e)} className="icon-btn-danger inline-flex" title="Eliminar lançamento">
                        <IconTrash className="w-3.5 h-3.5" />
                      </button>}
                    </td>
                  </tr>
                ))}
                {entries.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-gray-400">
                      Sem lançamentos ainda — registe o primeiro acima.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {filteredEntries.length === 0 && <div className="px-5 py-10 text-center text-sm text-slate-500">{query ? "Nenhum lançamento corresponde à pesquisa." : "Ainda não existem lançamentos."}</div>}
        </section>
      </div>
    </Layout>
  );
}

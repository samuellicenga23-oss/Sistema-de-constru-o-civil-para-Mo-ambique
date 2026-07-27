import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { boqApi, type Project } from "../api/boq";
import { financialApi, type FinancialEntry, type FinancialSummary } from "../api/financial";
import Layout from "../components/Layout";
import { MetricCard, SectionHeader } from "../components/WorkspaceUI";
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

  if (!project || !summary) {
    return <div className="min-h-screen flex items-center justify-center text-gray-400">A carregar...</div>;
  }

  const currency = summary.currency;
  const suggestions = type === "despesa" ? CATEGORY_SUGGESTIONS_DESPESA : CATEGORY_SUGGESTIONS_RECEITA;

  return (
    <Layout
      title={`Financeiro — ${project.name}`}
      subtitle="Receitas, despesas, contas a pagar/receber e fluxo de caixa desta obra"
      actions={
        <Link to={`/projectos/${projectId}`} className="btn btn-ghost btn-sm">
          <IconBack className="w-3.5 h-3.5" />
          Projecto
        </Link>
      }
    >
      <div className="space-y-5 max-w-7xl">
        {error && <p className="text-sm text-red-600">{error}</p>}

        {/* Indicadores */}
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <MetricCard label="Valor contratado" value={fmt(summary.valorContratado, currency)} />
          <MetricCard label="Valor recebido" value={fmt(summary.valorRecebido, currency)} tone="positive" />
          <MetricCard label="Custo realizado" value={fmt(summary.custoRealizado, currency)} tone="negative" />
          <MetricCard label="Margem realizada" value={fmt(summary.saldo, currency)} tone={summary.saldo >= 0 ? "positive" : "negative"} />
          <MetricCard label="Contas a receber" value={fmt(summary.contasAReceber, currency)} tone="info" />
          <MetricCard label="Contas a pagar" value={fmt(summary.contasAPagar, currency)} tone="warning" />
        </div>
        <p className="text-xs text-gray-400 -mt-3">
          A margem realizada é sempre valor recebido − custo pago (dinheiro real); o Mapa de Quantidades não distingue
          preço de venda de custo interno por item, por isso não existe uma "margem prevista" separada.
        </p>

        {/* Fluxo de caixa mensal */}
        {summary.fluxoCaixaMensal.length > 0 && (
          <section className="card">
            <SectionHeader title="Fluxo de caixa mensal" description="Receitas e despesas efectivamente pagas por mês" />
            <div className="overflow-x-auto">
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
        <section className="card overflow-hidden">
          <SectionHeader title="Novo lançamento" description="Registe uma receita ou despesa desta obra" />
          <form onSubmit={handleCreate} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6 items-end p-5">
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
            <div className="lg:col-span-2">
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
            <label className="flex items-center gap-2 text-sm text-gray-700 lg:col-span-3">
              <input type="checkbox" checked={markPaidNow} onChange={(e) => setMarkPaidNow(e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-brand-700" />
              Já foi {type === "receita" ? "recebido" : "pago"} (marca como pago hoje)
            </label>
            <button type="submit" disabled={saving} className="btn btn-primary lg:col-span-3">
              <IconPlus className="w-4 h-4" />
              {saving ? "A guardar..." : "Registar"}
            </button>
          </form>
        </section>

        {/* Lista de lançamentos */}
        <section className="card">
          <SectionHeader title="Lançamentos" description={`${entries.length} movimento(s) registado(s)`} />
          <div className="overflow-x-auto">
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
                {entries.map((e) => (
                  <tr key={e.id} className="table-row group">
                    <td className="py-2 px-5">
                      <span className={`badge ${e.type === "receita" ? "badge-green" : "badge-red"}`}>{e.type === "receita" ? "Receita" : "Despesa"}</span>
                    </td>
                    <td>{e.category}</td>
                    <td className="text-gray-500">{e.description ?? "—"}</td>
                    <td className="text-right tabular-nums font-medium">{fmt(Number(e.amount), e.currency)}</td>
                    <td className="text-gray-500">{e.dueDate ?? "—"}</td>
                    <td>
                      <span className={`badge ${e.status === "pago" ? "badge-green" : "badge-yellow"}`}>{e.status === "pago" ? "Pago" : "Pendente"}</span>
                    </td>
                    <td className="pr-5 space-x-3">
                      {e.status === "pendente" && (
                        <button onClick={() => handleMarkPaid(e)} className="text-green-700 text-xs font-medium hover:underline">
                          marcar pago
                        </button>
                      )}
                      <button onClick={() => handleDelete(e)} className="icon-btn-danger opacity-0 pointer-coarse:opacity-100 group-hover:opacity-100 transition-opacity inline-flex">
                        <IconTrash className="w-3.5 h-3.5" />
                      </button>
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
        </section>
      </div>
    </Layout>
  );
}

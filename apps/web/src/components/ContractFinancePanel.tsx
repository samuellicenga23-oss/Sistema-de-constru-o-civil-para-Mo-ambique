import { useEffect, useState, type FormEvent } from "react";
import {
  practiceApi,
  type PracticeEngagement,
  type PracticeEngagementFinance,
  type PracticeExpense,
  type PracticeServiceProjectType,
  type PracticeTeamMember,
  type PracticeTeamPayMode,
} from "../api/practice";

const SERVICE_PROJECT_TYPES: PracticeServiceProjectType[] = [
  "Arquitectura",
  "Engenharia",
  "Fiscalização",
  "Consultoria",
  "Coordenação",
  "Outro",
];

const TEAM_ROLES = [
  "Arquitecto",
  "Eng. Estrutural",
  "Eng. Hidráulico",
  "Eng. Eléctrico",
  "Desenhador",
  "BIM",
  "Fiscal",
  "Consultor",
  "Coordenador",
  "Outro",
];

const PAY_MODES: { value: PracticeTeamPayMode; label: string }[] = [
  { value: "fixo", label: "Fixo" },
  { value: "percentagem", label: "%" },
  { value: "hora", label: "Hora" },
  { value: "dia", label: "Dia" },
  { value: "entregavel", label: "Entregável" },
  { value: "fase", label: "Por fase" },
];

const EXPENSE_CATEGORIES: Array<{ value: string; label: string }> = [
  { value: "deslocacoes", label: "Deslocações" },
  { value: "plotagem", label: "Plotagem" },
  { value: "taxas", label: "Taxas" },
  { value: "consultores", label: "Consultores" },
  { value: "subcontratacoes", label: "Subcontratações" },
  { value: "software", label: "Software" },
  { value: "outros", label: "Outros" },
];

const PAY_STATUS_BADGE: Record<string, string> = {
  pendente: "badge-yellow",
  parcial: "badge-blue",
  pago: "badge-green",
};

function money(value: number | string, currency = "MZN") {
  return `${Number(value).toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

type Props = {
  engagement: PracticeEngagement;
  canManage: boolean;
  onChanged: () => void;
  onError: (message: string) => void;
};

export default function ContractFinancePanel({ engagement, canManage, onChanged, onError }: Props) {
  const [loading, setLoading] = useState(true);
  const [finance, setFinance] = useState<PracticeEngagementFinance | null>(null);
  const [team, setTeam] = useState<PracticeTeamMember[]>([]);
  const [expenses, setExpenses] = useState<PracticeExpense[]>([]);
  const [serviceProjectType, setServiceProjectType] = useState(
    (engagement.serviceProjectType as PracticeServiceProjectType | null) ?? "",
  );
  const [busy, setBusy] = useState(false);

  const [teamForm, setTeamForm] = useState({
    name: "",
    role: "Arquitecto",
    specialty: "",
    contact: "",
    isExternal: false,
    payMode: "fixo" as PracticeTeamPayMode,
    agreedAmount: "",
    percent: "",
    hourlyRate: "",
    hours: "",
    dailyRate: "",
    days: "",
    deliverableLabel: "",
    phaseLabel: "",
    plannedPayDate: "",
    paidAmount: "",
  });

  const [expenseForm, setExpenseForm] = useState({
    kind: "interno" as "interno" | "reembolsavel",
    category: "deslocacoes",
    description: "",
    amount: "",
    incurredDate: "",
    paidAt: "",
  });

  async function loadDetail() {
    setLoading(true);
    try {
      const detail = await practiceApi.getEngagement(engagement.id);
      setFinance(detail.finance);
      setTeam(detail.team ?? []);
      setExpenses(detail.expenses ?? []);
      setServiceProjectType((detail.serviceProjectType as PracticeServiceProjectType | null) ?? "");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Erro ao carregar contrato");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDetail().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engagement.id]);

  async function saveServiceType() {
    if (!canManage) return;
    setBusy(true);
    try {
      await practiceApi.updateEngagement(engagement.id, {
        serviceProjectType: serviceProjectType ? (serviceProjectType as PracticeServiceProjectType) : null,
      });
      onChanged();
      await loadDetail();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Erro ao actualizar tipo de serviço");
    } finally {
      setBusy(false);
    }
  }

  async function addTeam(e: FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    setBusy(true);
    try {
      await practiceApi.addTeamMember(engagement.id, {
        name: teamForm.name,
        role: teamForm.role,
        specialty: teamForm.specialty || null,
        contact: teamForm.contact || null,
        isExternal: teamForm.isExternal,
        payMode: teamForm.payMode,
        agreedAmount: Number(teamForm.agreedAmount || 0),
        percent: teamForm.percent ? Number(teamForm.percent) : null,
        hourlyRate: teamForm.hourlyRate ? Number(teamForm.hourlyRate) : null,
        hours: teamForm.hours ? Number(teamForm.hours) : null,
        dailyRate: teamForm.dailyRate ? Number(teamForm.dailyRate) : null,
        days: teamForm.days ? Number(teamForm.days) : null,
        deliverableLabel: teamForm.deliverableLabel || null,
        phaseLabel: teamForm.phaseLabel || null,
        plannedPayDate: teamForm.plannedPayDate || null,
        paidAmount: Number(teamForm.paidAmount || 0),
      });
      setTeamForm({
        name: "",
        role: "Arquitecto",
        specialty: "",
        contact: "",
        isExternal: false,
        payMode: "fixo",
        agreedAmount: "",
        percent: "",
        hourlyRate: "",
        hours: "",
        dailyRate: "",
        days: "",
        deliverableLabel: "",
        phaseLabel: "",
        plannedPayDate: "",
        paidAmount: "",
      });
      onChanged();
      await loadDetail();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Erro ao adicionar membro");
    } finally {
      setBusy(false);
    }
  }

  async function recordTeamPayment(member: PracticeTeamMember, amount: number) {
    if (!canManage || amount < 0) return;
    setBusy(true);
    try {
      await practiceApi.updateTeamMember(member.id, { paidAmount: amount });
      onChanged();
      await loadDetail();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Erro ao actualizar pagamento");
    } finally {
      setBusy(false);
    }
  }

  async function removeTeam(id: string) {
    if (!canManage || !confirm("Remover este membro da equipa?")) return;
    setBusy(true);
    try {
      await practiceApi.deleteTeamMember(id);
      onChanged();
      await loadDetail();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Erro ao remover membro");
    } finally {
      setBusy(false);
    }
  }

  async function addExpense(e: FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    setBusy(true);
    try {
      await practiceApi.addExpense(engagement.id, {
        kind: expenseForm.kind,
        category: expenseForm.category,
        description: expenseForm.description,
        amount: Number(expenseForm.amount),
        incurredDate: expenseForm.incurredDate || null,
        paidAt: expenseForm.paidAt || null,
      });
      setExpenseForm({
        kind: "interno",
        category: "deslocacoes",
        description: "",
        amount: "",
        incurredDate: "",
        paidAt: "",
      });
      onChanged();
      await loadDetail();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Erro ao registar despesa");
    } finally {
      setBusy(false);
    }
  }

  async function markExpensePaid(expense: PracticeExpense) {
    if (!canManage) return;
    setBusy(true);
    try {
      await practiceApi.updateExpense(expense.id, {
        paidAt: expense.paidAt ? null : new Date().toISOString().slice(0, 10),
      });
      onChanged();
      await loadDetail();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Erro ao actualizar despesa");
    } finally {
      setBusy(false);
    }
  }

  async function removeExpense(id: string) {
    if (!canManage || !confirm("Remover esta despesa?")) return;
    setBusy(true);
    try {
      await practiceApi.deleteExpense(id);
      onChanged();
      await loadDetail();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Erro ao remover despesa");
    } finally {
      setBusy(false);
    }
  }

  const currency = engagement.currency;

  if (loading) {
    return <div className="border-t border-slate-200 px-4 py-6 text-sm text-slate-500">A carregar rentabilidade…</div>;
  }

  return (
    <div className="space-y-5 border-t border-slate-200 bg-white px-4 py-5 sm:px-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1">
          <label className="label">Projecto de serviços</label>
          <select
            className="input"
            value={serviceProjectType}
            disabled={!canManage}
            onChange={(e) => setServiceProjectType(e.target.value as PracticeServiceProjectType | "")}
          >
            <option value="">— Definir tipo —</option>
            {SERVICE_PROJECT_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-slate-500">Tipo de serviço profissional — distinto da obra SIGO de execução.</p>
        </div>
        {canManage && (
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={saveServiceType}>
            Guardar tipo
          </button>
        )}
      </div>

      {finance && (
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Painel financeiro</h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi
              label="Contratado"
              value={money(finance.contracted, currency)}
              hint={
                finance.approvedVariations
                  ? `Original ${money(finance.originalAmount ?? finance.contracted, currency)} · adendas ${money(finance.approvedVariations, currency)}`
                  : undefined
              }
            />
            <Kpi label="Facturado" value={money(finance.invoiced, currency)} />
            <Kpi label="Recebido" value={money(finance.received, currency)} />
            <Kpi label="A receber" value={money(finance.receivable, currency)} />
            <Kpi
              label="Honorários"
              value={money(finance.honorariosPrevistos, currency)}
              hint={`Pago ${money(finance.honorariosPagos, currency)} · pendente ${money(finance.honorariosPendentes, currency)}`}
            />
            <Kpi
              label="Custos"
              value={money(finance.custosPrevistos, currency)}
              hint={`Realizado ${money(finance.custosRealizados, currency)} · desp. int. ${money(finance.despesasInternas, currency)}`}
            />
            <Kpi
              label="Margem prevista"
              value={money(finance.margemPrevista, currency)}
              hint={`${finance.rentabilidadePrevistaPct}% rentabilidade`}
            />
            <Kpi
              label="Margem real"
              value={money(finance.margemReal, currency)}
              hint={`${finance.rentabilidadeRealPct}% s/ recebido · reemb. ${money(finance.despesasReembolsaveis, currency)}`}
            />
          </div>
        </div>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900">Equipa & honorários</h3>
        </div>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">Membro</th>
                <th className="px-3 py-2 font-medium">Pagamento</th>
                <th className="px-3 py-2 font-medium text-right">Previsto</th>
                <th className="px-3 py-2 font-medium text-right">Pago</th>
                <th className="px-3 py-2 font-medium text-right">A pagar</th>
                <th className="px-3 py-2 font-medium">Estado</th>
                <th className="px-3 py-2 font-medium text-right">Acção</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {team.map((member) => {
                const planned = member.plannedAmount ?? Number(member.agreedAmount);
                const paid = Number(member.paidAmount);
                const pending = member.pendingAmount ?? Math.max(0, planned - paid);
                return (
                  <tr key={member.id}>
                    <td className="px-3 py-2">
                      <p className="font-medium text-slate-900">{member.name}</p>
                      <p className="text-xs text-slate-500">
                        {member.role}
                        {member.specialty ? ` · ${member.specialty}` : ""}
                        {member.isExternal ? " · externo" : " · interno"}
                      </p>
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {PAY_MODES.find((m) => m.value === member.payMode)?.label ?? member.payMode}
                      {member.payMode === "percentagem" && member.percent ? ` (${member.percent}%)` : ""}
                      {member.plannedPayDate ? (
                        <span className="block text-xs text-slate-400">prev. {member.plannedPayDate}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(planned, currency)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(paid, currency)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(pending, currency)}</td>
                    <td className="px-3 py-2">
                      <span className={`badge ${PAY_STATUS_BADGE[member.payStatus] ?? "badge-gray"}`}>{member.payStatus}</span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {canManage && (
                        <div className="flex justify-end gap-1">
                          {pending > 0 && (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              disabled={busy}
                              onClick={() => recordTeamPayment(member, planned)}
                            >
                              Marcar pago
                            </button>
                          )}
                          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => removeTeam(member.id)}>
                            Remover
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!team.length && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-500">
                    Ainda sem equipa neste contrato.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {canManage && (
          <form className="mt-3 grid gap-2 rounded-lg border border-dashed border-slate-200 p-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={addTeam}>
            <div>
              <label className="label">Nome</label>
              <input className="input" required value={teamForm.name} onChange={(e) => setTeamForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label className="label">Função</label>
              <select className="input" value={teamForm.role} onChange={(e) => setTeamForm((f) => ({ ...f, role: e.target.value }))}>
                {TEAM_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Especialidade</label>
              <input className="input" value={teamForm.specialty} onChange={(e) => setTeamForm((f) => ({ ...f, specialty: e.target.value }))} />
            </div>
            <div>
              <label className="label">Contacto</label>
              <input className="input" value={teamForm.contact} onChange={(e) => setTeamForm((f) => ({ ...f, contact: e.target.value }))} />
            </div>
            <div>
              <label className="label">Forma de pagamento</label>
              <select
                className="input"
                value={teamForm.payMode}
                onChange={(e) => setTeamForm((f) => ({ ...f, payMode: e.target.value as PracticeTeamPayMode }))}
              >
                {PAY_MODES.map((mode) => (
                  <option key={mode.value} value={mode.value}>
                    {mode.label}
                  </option>
                ))}
              </select>
            </div>
            {(teamForm.payMode === "fixo" || teamForm.payMode === "entregavel" || teamForm.payMode === "fase") && (
              <div>
                <label className="label">Valor acordado</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  step="0.01"
                  value={teamForm.agreedAmount}
                  onChange={(e) => setTeamForm((f) => ({ ...f, agreedAmount: e.target.value }))}
                />
              </div>
            )}
            {teamForm.payMode === "percentagem" && (
              <div>
                <label className="label">% do contrato</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={teamForm.percent}
                  onChange={(e) => setTeamForm((f) => ({ ...f, percent: e.target.value }))}
                />
              </div>
            )}
            {teamForm.payMode === "hora" && (
              <>
                <div>
                  <label className="label">€/h · taxa</label>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    step="0.01"
                    value={teamForm.hourlyRate}
                    onChange={(e) => setTeamForm((f) => ({ ...f, hourlyRate: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">Horas</label>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    step="0.25"
                    value={teamForm.hours}
                    onChange={(e) => setTeamForm((f) => ({ ...f, hours: e.target.value }))}
                  />
                </div>
              </>
            )}
            {teamForm.payMode === "dia" && (
              <>
                <div>
                  <label className="label">Taxa/dia</label>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    step="0.01"
                    value={teamForm.dailyRate}
                    onChange={(e) => setTeamForm((f) => ({ ...f, dailyRate: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">Dias</label>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    step="0.5"
                    value={teamForm.days}
                    onChange={(e) => setTeamForm((f) => ({ ...f, days: e.target.value }))}
                  />
                </div>
              </>
            )}
            {teamForm.payMode === "entregavel" && (
              <div>
                <label className="label">Entregável</label>
                <input
                  className="input"
                  value={teamForm.deliverableLabel}
                  onChange={(e) => setTeamForm((f) => ({ ...f, deliverableLabel: e.target.value }))}
                />
              </div>
            )}
            {teamForm.payMode === "fase" && (
              <div>
                <label className="label">Fase</label>
                <input
                  className="input"
                  value={teamForm.phaseLabel}
                  onChange={(e) => setTeamForm((f) => ({ ...f, phaseLabel: e.target.value }))}
                />
              </div>
            )}
            <div>
              <label className="label">Data prev. pagamento</label>
              <input
                className="input"
                type="date"
                value={teamForm.plannedPayDate}
                onChange={(e) => setTeamForm((f) => ({ ...f, plannedPayDate: e.target.value }))}
              />
            </div>
            <div className="flex items-end gap-3 sm:col-span-2 lg:col-span-4">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={teamForm.isExternal}
                  onChange={(e) => setTeamForm((f) => ({ ...f, isExternal: e.target.checked }))}
                />
                Externo / subcontratado
              </label>
              <button type="submit" className="btn btn-primary btn-sm ml-auto" disabled={busy}>
                Adicionar à equipa
              </button>
            </div>
          </form>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Custos e despesas</h3>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">Descrição</th>
                <th className="px-3 py-2 font-medium">Tipo</th>
                <th className="px-3 py-2 font-medium">Categoria</th>
                <th className="px-3 py-2 font-medium text-right">Valor</th>
                <th className="px-3 py-2 font-medium">Pago</th>
                <th className="px-3 py-2 font-medium text-right">Acção</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {expenses.map((expense) => (
                <tr key={expense.id}>
                  <td className="px-3 py-2 font-medium text-slate-900">{expense.description}</td>
                  <td className="px-3 py-2">
                    <span className={`badge ${expense.kind === "reembolsavel" ? "badge-blue" : "badge-gray"}`}>
                      {expense.kind === "reembolsavel" ? "Reembolsável" : "Interno"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {EXPENSE_CATEGORIES.find((cat) => cat.value === expense.category)?.label ?? expense.category}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(expense.amount, currency)}</td>
                  <td className="px-3 py-2 text-slate-600">{expense.paidAt ?? "—"}</td>
                  <td className="px-3 py-2 text-right">
                    {canManage && (
                      <div className="flex justify-end gap-1">
                        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => markExpensePaid(expense)}>
                          {expense.paidAt ? "Desmarcar" : "Marcar pago"}
                        </button>
                        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => removeExpense(expense.id)}>
                          Remover
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {!expenses.length && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-sm text-slate-500">
                    Sem despesas registadas.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {canManage && (
          <form className="mt-3 grid gap-2 rounded-lg border border-dashed border-slate-200 p-3 sm:grid-cols-2 lg:grid-cols-5" onSubmit={addExpense}>
            <div>
              <label className="label">Tipo</label>
              <select
                className="input"
                value={expenseForm.kind}
                onChange={(e) => setExpenseForm((f) => ({ ...f, kind: e.target.value as "interno" | "reembolsavel" }))}
              >
                <option value="interno">Custo interno</option>
                <option value="reembolsavel">Despesa reembolsável</option>
              </select>
            </div>
            <div>
              <label className="label">Categoria</label>
              <select
                className="input"
                value={expenseForm.category}
                onChange={(e) => setExpenseForm((f) => ({ ...f, category: e.target.value }))}
              >
                {EXPENSE_CATEGORIES.map((cat) => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="lg:col-span-2">
              <label className="label">Descrição</label>
              <input
                className="input"
                required
                value={expenseForm.description}
                onChange={(e) => setExpenseForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">Valor</label>
              <input
                className="input"
                type="number"
                min={0}
                step="0.01"
                required
                value={expenseForm.amount}
                onChange={(e) => setExpenseForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </div>
            <div className="flex items-end lg:col-span-5">
              <button type="submit" className="btn btn-primary btn-sm ml-auto" disabled={busy}>
                Registar despesa
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

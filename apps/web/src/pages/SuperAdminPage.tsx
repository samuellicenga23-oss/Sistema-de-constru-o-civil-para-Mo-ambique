import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import {
  companiesApi,
  type AdminCompanyUser,
  type CommercialLead,
  type Company,
  type CompanyModuleKey,
  type PaymentProof,
  type PlatformPayment,
  type SubscriptionUpdateInput,
} from "../api/companies";
import { dashboardApi, type AdminStats } from "../api/dashboard";
import Layout from "../components/Layout";
import Modal from "../components/Modal";
import PageSearch from "../components/PageSearch";
import AlertBanner from "../components/AlertBanner";
import { IconBuilding, IconHardDrive, IconHome, IconPlus, IconSettings, IconUsers } from "../components/icons";
import { SUBSCRIPTION_PLANS, getPlanDefinition, CREDIT_PACKS } from "@sigo/shared";
import { useLanguage } from "../i18n";

type AdminView = "overview" | "companies" | "users" | "storage" | "configuration";
type UserRole = AdminCompanyUser["role"];
type DetailTab = "subscription" | "usage" | "payments" | "credits";
type StorageOverview = Awaited<ReturnType<typeof companiesApi.getStorage>>;
type TrashedProject = Awaited<ReturnType<typeof companiesApi.listTrash>>[number];

const STATUS_LABELS: Record<string, string> = { trial: "Trial", activo: "Activo", suspenso: "Suspenso" };
const STATUS_BADGE: Record<string, string> = { trial: "badge-yellow", activo: "badge-green", suspenso: "badge-red" };
const ROLE_LABELS: Record<UserRole, string> = {
  admin_empresa: "Administrador",
  orcamentista: "Orçamentista",
  engenheiro_fiscal: "Engenheiro/Fiscal",
  visualizador: "Visualizador",
};
const CYCLE_LABELS: Record<string, string> = {
  monthly: "Mensal",
  annual: "Anual",
  custom: "Personalizado",
  trial: "Trial",
};
const METHOD_LABELS: Record<string, string> = {
  transferencia: "Transferência",
  mpesa: "M-Pesa",
  emola: "e-Mola",
  cash: "Numerário",
  cartao: "Cartão",
  outro: "Outro",
};
const MODULES: Array<{ key: CompanyModuleKey; pt: string; en: string; descriptionPt: string; descriptionEn: string }> = [
  { key: "dashboard", pt: "Painel", en: "Dashboard", descriptionPt: "Indicadores e visão geral", descriptionEn: "Indicators and overview" },
  { key: "measurements", pt: "Medições", en: "Measurements", descriptionPt: "Leitura de plantas e quantidades", descriptionEn: "Drawing analysis and quantities" },
  { key: "budgets", pt: "Orçamentos", en: "Budgets", descriptionPt: "Mapas, preços e documentos", descriptionEn: "BOQs, prices and documents" },
  { key: "catalog", pt: "Catálogo", en: "Catalogue", descriptionPt: "Materiais, mão-de-obra e composições", descriptionEn: "Materials, labour and compositions" },
  { key: "suppliers", pt: "Fornecedores", en: "Suppliers", descriptionPt: "Cotações e preços por zona", descriptionEn: "Quotes and zone prices" },
  { key: "purchasing", pt: "Compras e armazém", en: "Purchasing & stock", descriptionPt: "Pedidos, recepção e stock", descriptionEn: "Orders, receiving and stock" },
  { key: "schedule", pt: "Cronograma", en: "Schedule", descriptionPt: "Planeamento e progresso", descriptionEn: "Planning and progress" },
  { key: "site_diary", pt: "Diário de obra", en: "Site diary", descriptionPt: "Registos diários da execução", descriptionEn: "Daily execution records" },
  { key: "financial", pt: "Financeiro", en: "Financial", descriptionPt: "Custos, receitas e facturação", descriptionEn: "Costs, revenue and invoicing" },
  { key: "quick_calculations", pt: "Cálculos rápidos", en: "Quick calculations", descriptionPt: "Ferramentas técnicas rápidas", descriptionEn: "Quick technical tools" },
  { key: "practice", pt: "Comercial", en: "Commercial", descriptionPt: "Clientes, propostas por fases, parcelas e PDFs de honorários", descriptionEn: "Clients, phased proposals, milestones and fee PDFs" },
];

function money(value: number, currency = "MZN") {
  return new Intl.NumberFormat("pt-MZ", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}

function fmtDate(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat("pt-MZ", { day: "2-digit", month: "short", year: "numeric" }).format(d);
}

function daysUntil(value?: string | null) {
  if (!value) return null;
  const diff = Math.ceil((new Date(value).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  return Number.isFinite(diff) ? diff : null;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

const STORAGE_CATEGORY_META: Record<string, { pt: string; en: string; tone: string }> = {
  plants: { pt: "Plantas (PDF)", en: "Plant PDFs", tone: "bg-sky-500" },
  site_diary: { pt: "Diário de obra", en: "Site diary", tone: "bg-emerald-500" },
  import_jobs: { pt: "Imports de mapas", en: "Map imports", tone: "bg-violet-500" },
  invoice_receipts: { pt: "Comprovativos", en: "Receipt proofs", tone: "bg-amber-500" },
  logos: { pt: "Logótipos", en: "Logos", tone: "bg-rose-500" },
  avatars: { pt: "Avatares", en: "Avatars", tone: "bg-slate-500" },
  other: { pt: "Outros / órfãos", en: "Other / orphans", tone: "bg-orange-500" },
};

const FOLDER_LABELS: Record<string, { pt: string; en: string }> = {
  plants: { pt: "Plantas", en: "Plants" },
  "site-diary": { pt: "Diário de obra", en: "Site diary" },
  "import-jobs": { pt: "Imports", en: "Imports" },
  "invoice-receipts": { pt: "Comprovativos", en: "Receipts" },
  logos: { pt: "Logótipos", en: "Logos" },
  avatars: { pt: "Avatares", en: "Avatars" },
};

function toDateInput(value?: string | null) {
  if (!value) return "";
  return value.slice(0, 10);
}

function addMonthsIso(months: number) {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function StatCard({ label, value, hint, tone = "text-slate-950" }: { label: string; value: ReactNode; hint?: string; tone?: string }) {
  return (
    <div className="card p-4">
      <strong className={`block text-2xl tabular-nums ${tone}`}>{value}</strong>
      <span className="mt-1 block text-xs text-slate-500">{label}</span>
      {hint && <span className="mt-1 block text-[11px] text-slate-400">{hint}</span>}
    </div>
  );
}

function UsageBar({ label, used, max }: { label: string; used: number; max: number | null }) {
  const pct = max && max > 0 ? Math.min(100, Math.round((used / max) * 100)) : null;
  const over = max != null && used >= max;
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-slate-600">{label}</span>
        <span className={`tabular-nums font-medium ${over ? "text-red-700" : "text-slate-900"}`}>
          {used}
          {max != null ? ` / ${max}` : " · ∞"}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full ${over ? "bg-red-500" : pct != null && pct >= 80 ? "bg-amber-500" : "bg-brand-600"}`}
          style={{ width: `${pct ?? Math.min(100, used * 8)}%` }}
        />
      </div>
    </div>
  );
}

export default function SuperAdminPage() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const { language } = useLanguage();
  const en = language === "en";
  const [view, setView] = useState<AdminView>("overview");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [users, setUsers] = useState<AdminCompanyUser[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [enteringCompanyId, setEnteringCompanyId] = useState<string | null>(null);
  const [showCreateCompany, setShowCreateCompany] = useState(false);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [resetUser, setResetUser] = useState<AdminCompanyUser | null>(null);
  const [detailCompanyId, setDetailCompanyId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("subscription");
  const [payments, setPayments] = useState<PlatformPayment[]>([]);
  const [detailUsage, setDetailUsage] = useState<Company["usage"]>(null);
  const [creditInfo, setCreditInfo] = useState<Awaited<ReturnType<typeof companiesApi.getCredits>> | null>(null);
  const [creditForm, setCreditForm] = useState({
    packId: "misto_15",
    smartImports: "",
    plantAnalyses: "",
    note: "",
    amount: "",
    method: "transferencia" as "transferencia" | "mpesa" | "cash" | "cartao" | "outro",
    reference: "",
    recordPayment: true,
  });

  const [companyForm, setCompanyForm] = useState({ name: "", adminName: "", adminEmail: "", adminPassword: "" });
  const [userForm, setUserForm] = useState<{ name: string; email: string; password: string; role: UserRole; preferredLanguage: "pt" | "en" }>({
    name: "",
    email: "",
    password: "",
    role: "orcamentista",
    preferredLanguage: "pt",
  });
  const [resetPassword, setResetPassword] = useState("");
  const [settings, setSettings] = useState({
    name: "",
    brandName: "",
    defaultCurrency: "MZN",
    primaryColor: "#1AADB4",
    accentColor: "#ED6C22",
    defaultLanguage: "pt" as "pt" | "en",
    enabledModules: [] as CompanyModuleKey[],
  });
  const [subForm, setSubForm] = useState({
    plan: "individual",
    status: "trial" as "trial" | "activo" | "suspenso",
    billingCycle: "monthly" as "monthly" | "annual" | "custom" | "trial",
    expiresAt: "",
    notes: "",
    recordPayment: false,
    amount: "",
    method: "transferencia" as "transferencia" | "mpesa" | "cash" | "cartao" | "outro",
    reference: "",
    periodStart: "",
    periodEnd: "",
  });
  const [payForm, setPayForm] = useState({
    amount: "",
    method: "transferencia" as "transferencia" | "mpesa" | "cash" | "cartao" | "outro",
    reference: "",
    periodStart: new Date().toISOString().slice(0, 10),
    periodEnd: addMonthsIso(1),
    notes: "",
  });
  const [storage, setStorage] = useState<StorageOverview | null>(null);
  const [trash, setTrash] = useState<TrashedProject[]>([]);
  const [storageLoading, setStorageLoading] = useState(false);
  const [cleanupRunning, setCleanupRunning] = useState(false);
  const [pendingProofs, setPendingProofs] = useState<PaymentProof[]>([]);
  const [proofActionId, setProofActionId] = useState<string | null>(null);
  const [leads, setLeads] = useState<CommercialLead[]>([]);
  const [leadActionId, setLeadActionId] = useState<string | null>(null);

  async function reloadLeads() {
    const rows = await companiesApi.listLeads("novo");
    setLeads(rows);
  }

  async function handleLeadStatus(id: string, status: CommercialLead["status"]) {
    setLeadActionId(id);
    setError(null);
    try {
      await companiesApi.updateLeadStatus(id, status);
      await reloadLeads();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao actualizar o pedido");
    } finally {
      setLeadActionId(null);
    }
  }
  const [mailEnabled, setMailEnabled] = useState<boolean | null>(null);
  const [testingEmail, setTestingEmail] = useState(false);
  const [monitoringEnabled, setMonitoringEnabled] = useState<boolean | null>(null);
  const [testingMonitoring, setTestingMonitoring] = useState(false);

  async function handleTestEmail() {
    setTestingEmail(true);
    setError(null);
    try {
      const result = await companiesApi.sendTestEmail();
      setSuccess(en ? `Test email sent to ${result.sentTo}` : `Email de teste enviado para ${result.sentTo}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao enviar email de teste");
    } finally {
      setTestingEmail(false);
    }
  }

  async function handleTestMonitoring() {
    setTestingMonitoring(true);
    setError(null);
    try {
      await companiesApi.sendTestError();
      setSuccess(en ? "Test error sent to Sentry" : "Erro de teste enviado ao Sentry");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao enviar erro de teste");
    } finally {
      setTestingMonitoring(false);
    }
  }

  async function reloadPendingProofs() {
    const rows = await companiesApi.listPendingPaymentProofs("pendente");
    setPendingProofs(rows);
  }

  async function reload() {
    const [companyRows, userRows, statsData] = await Promise.all([
      companiesApi.list(),
      companiesApi.listAdminUsers(),
      dashboardApi.adminStats(),
    ]);
    setCompanies(companyRows);
    setUsers(userRows);
    setStats(statsData);
    setSelectedCompanyId((current) => current || companyRows[0]?.id || "");
  }

  useEffect(() => {
    reload().catch((err) => setError(err.message));
    reloadPendingProofs().catch((err) => setError(err.message));
    reloadLeads().catch((err) => setError(err.message));
    companiesApi.getMailStatus().then((r) => setMailEnabled(r.enabled)).catch(() => setMailEnabled(false));
    companiesApi.getMonitoringStatus().then((r) => setMonitoringEnabled(r.enabled)).catch(() => setMonitoringEnabled(false));
  }, []);

  async function handleApproveProof(proof: PaymentProof) {
    setProofActionId(proof.id);
    setError(null);
    try {
      await companiesApi.approvePaymentProof(proof.id);
      setSuccess(`Comprovativo de ${proof.companyName ?? "empresa"} aprovado — plano ${proof.plan} activado.`);
      await Promise.all([reloadPendingProofs(), reload()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao aprovar comprovativo");
    } finally {
      setProofActionId(null);
    }
  }

  async function handleRejectProof(proof: PaymentProof) {
    const reason = window.prompt("Motivo da rejeição (visível para a empresa):");
    if (!reason || !reason.trim()) return;
    setProofActionId(proof.id);
    setError(null);
    try {
      await companiesApi.rejectPaymentProof(proof.id, reason.trim());
      setSuccess(`Comprovativo de ${proof.companyName ?? "empresa"} rejeitado.`);
      await reloadPendingProofs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao rejeitar comprovativo");
    } finally {
      setProofActionId(null);
    }
  }

  async function reloadStorage() {
    setStorageLoading(true);
    try {
      const [storageData, trashData] = await Promise.all([companiesApi.getStorage(), companiesApi.listTrash()]);
      setStorage(storageData);
      setTrash(trashData);
    } finally {
      setStorageLoading(false);
    }
  }

  useEffect(() => {
    if (view !== "storage") return;
    reloadStorage().catch((err) => setError(err.message));
  }, [view]);

  const selectedCompany = companies.find((company) => company.id === selectedCompanyId) ?? null;
  const detailCompany = companies.find((company) => company.id === detailCompanyId) ?? null;

  useEffect(() => {
    if (!selectedCompany) return;
    setSettings({
      name: selectedCompany.name,
      brandName: selectedCompany.brandName ?? "",
      defaultCurrency: selectedCompany.defaultCurrency,
      primaryColor: selectedCompany.primaryColor,
      accentColor: selectedCompany.accentColor,
      defaultLanguage: selectedCompany.defaultLanguage,
      enabledModules: selectedCompany.enabledModules,
    });
  }, [selectedCompany?.id]);

  useEffect(() => {
    if (!detailCompany) return;
    const sub = detailCompany.subscription;
    const plan = getPlanDefinition(sub?.plan ?? "profissional");
    const defaultAmount =
      sub?.billingCycle === "annual" ? plan?.annualPriceMzn ?? plan?.monthlyPriceMzn ?? 0 : plan?.monthlyPriceMzn ?? 0;
    setSubForm({
      plan: sub?.plan ?? "profissional",
      status: sub?.status ?? "trial",
      billingCycle: (sub?.billingCycle as typeof subForm.billingCycle) || "monthly",
      expiresAt: toDateInput(sub?.expiresAt),
      notes: sub?.notes ?? "",
      recordPayment: false,
      amount: defaultAmount ? String(defaultAmount) : "",
      method: "transferencia",
      reference: "",
      periodStart: new Date().toISOString().slice(0, 10),
      periodEnd: addMonthsIso(sub?.billingCycle === "annual" ? 12 : 1),
    });
    setDetailTab("subscription");
    setDetailUsage(detailCompany.usage ?? null);
    companiesApi
      .listPayments(detailCompany.id)
      .then(setPayments)
      .catch(() => setPayments([]));
    companiesApi
      .getUsage(detailCompany.id)
      .then(setDetailUsage)
      .catch(() => {});
    companiesApi
      .getCredits(detailCompany.id)
      .then(setCreditInfo)
      .catch(() => setCreditInfo(null));
  }, [detailCompany?.id]);

  const normalizedQuery = query.trim().toLocaleLowerCase("pt");
  const filteredCompanies = useMemo(
    () =>
      companies.filter(
        (company) =>
          !normalizedQuery ||
          [company.name, company.nuit, company.email, company.province, company.subscription?.plan, company.subscription?.status]
            .some((value) => String(value ?? "").toLocaleLowerCase("pt").includes(normalizedQuery)),
      ),
    [companies, normalizedQuery],
  );
  const filteredUsers = useMemo(
    () =>
      users.filter(
        (member) =>
          (!selectedCompanyId || member.companyId === selectedCompanyId) &&
          (!normalizedQuery ||
            [member.name, member.email, member.companyName, ROLE_LABELS[member.role]].some((value) =>
              value.toLocaleLowerCase("pt").includes(normalizedQuery),
            )),
      ),
    [users, selectedCompanyId, normalizedQuery],
  );

  function notify(message: string) {
    setSuccess(message);
    setTimeout(() => setSuccess(null), 3000);
  }

  async function createCompany(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await companiesApi.create(companyForm);
      setCompanyForm({ name: "", adminName: "", adminEmail: "", adminPassword: "" });
      setShowCreateCompany(false);
      await reload();
      setSelectedCompanyId(result.company.id);
      notify(en ? "Company created." : "Empresa criada.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar empresa");
    } finally {
      setSaving(false);
    }
  }

  async function createUser(event: FormEvent) {
    event.preventDefault();
    if (!selectedCompanyId) return;
    setSaving(true);
    setError(null);
    try {
      await companiesApi.createAdminUser(selectedCompanyId, userForm);
      setUserForm({ name: "", email: "", password: "", role: "orcamentista", preferredLanguage: "pt" });
      setShowCreateUser(false);
      await reload();
      notify(en ? "User created." : "Utilizador criado.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar utilizador");
    } finally {
      setSaving(false);
    }
  }

  async function saveSubscription(event: FormEvent) {
    event.preventDefault();
    if (!detailCompany) return;
    setSaving(true);
    setError(null);
    try {
      const payload: SubscriptionUpdateInput = {
        plan: subForm.plan,
        status: subForm.status,
        billingCycle: subForm.billingCycle,
        expiresAt: subForm.expiresAt ? new Date(`${subForm.expiresAt}T23:59:59.000Z`).toISOString() : null,
        notes: subForm.notes || null,
      };
      if (subForm.recordPayment && Number(subForm.amount) > 0) {
        payload.payment = {
          amount: Number(subForm.amount),
          method: subForm.method,
          reference: subForm.reference || undefined,
          periodStart: subForm.periodStart || undefined,
          periodEnd: subForm.periodEnd || undefined,
        };
        if (subForm.periodEnd) {
          payload.expiresAt = new Date(`${subForm.periodEnd}T23:59:59.000Z`).toISOString();
        }
      }
      await companiesApi.updateSubscription(detailCompany.id, payload);
      await reload();
      const refreshedPayments = await companiesApi.listPayments(detailCompany.id);
      setPayments(refreshedPayments);
      notify(en ? "Subscription updated." : "Subscrição actualizada.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao actualizar subscrição");
    } finally {
      setSaving(false);
    }
  }

  async function recordPayment(event: FormEvent) {
    event.preventDefault();
    if (!detailCompany || !(Number(payForm.amount) > 0)) return;
    setSaving(true);
    setError(null);
    try {
      await companiesApi.createPayment(detailCompany.id, {
        amount: Number(payForm.amount),
        method: payForm.method,
        reference: payForm.reference || undefined,
        notes: payForm.notes || undefined,
        periodStart: payForm.periodStart || undefined,
        periodEnd: payForm.periodEnd || undefined,
        plan: detailCompany.subscription?.plan,
        billingCycle: detailCompany.subscription?.billingCycle ?? undefined,
      });
      setPayForm({
        amount: "",
        method: "transferencia",
        reference: "",
        periodStart: new Date().toISOString().slice(0, 10),
        periodEnd: addMonthsIso(1),
        notes: "",
      });
      await reload();
      setPayments(await companiesApi.listPayments(detailCompany.id));
      notify(en ? "Payment recorded." : "Pagamento registado.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao registar pagamento");
    } finally {
      setSaving(false);
    }
  }

  async function grantCredits(event: FormEvent) {
    event.preventDefault();
    if (!detailCompany) return;
    setSaving(true);
    setError(null);
    try {
      const pack = CREDIT_PACKS.find((p) => p.id === creditForm.packId);
      const smartImports = creditForm.smartImports ? Number(creditForm.smartImports) : undefined;
      const plantAnalyses = creditForm.plantAnalyses ? Number(creditForm.plantAnalyses) : undefined;
      await companiesApi.grantCredits(detailCompany.id, {
        packId: creditForm.packId || null,
        smartImports,
        plantAnalyses,
        note: creditForm.note || null,
        amount: creditForm.amount ? Number(creditForm.amount) : pack?.priceMzn,
        method: creditForm.method,
        reference: creditForm.reference || undefined,
        recordPayment: creditForm.recordPayment,
      });
      setCreditInfo(await companiesApi.getCredits(detailCompany.id));
      setPayments(await companiesApi.listPayments(detailCompany.id));
      await reload();
      notify(en ? "Credits granted." : "Créditos atribuídos.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao atribuir créditos");
    } finally {
      setSaving(false);
    }
  }

  async function enterCompany(companyId: string) {
    setError(null);
    setEnteringCompanyId(companyId);
    try {
      const next = await companiesApi.enterCompany(companyId);
      setUser(next);
      notify(en ? "Entered company workspace." : "Entrou no espaço da empresa.");
      navigate("/painel");
    } catch (err) {
      setError(err instanceof Error ? err.message : en ? "Could not enter company." : "Não foi possível entrar na empresa.");
    } finally {
      setEnteringCompanyId(null);
    }
  }

  async function downloadBackup(company: Company) {
    setError(null);
    setSaving(true);
    try {
      await companiesApi.downloadBackup(company.id, company.name.replace(/[^\w\-]+/g, "_").slice(0, 40));
      notify(en ? "Full company backup downloaded (data + files)." : "Backup completo descarregado (dados + ficheiros).");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao gerar backup");
    } finally {
      setSaving(false);
    }
  }

  async function updateUser(member: AdminCompanyUser, data: Partial<Pick<AdminCompanyUser, "role" | "isActive" | "preferredLanguage">>) {
    setError(null);
    try {
      await companiesApi.updateAdminUser(member.id, data);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao actualizar utilizador");
    }
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    if (!selectedCompanyId) return;
    setSaving(true);
    setError(null);
    try {
      await companiesApi.updateAdminSettings(selectedCompanyId, { ...settings, brandName: settings.brandName || null });
      await reload();
      notify(en ? "Company settings saved." : "Configuração da empresa guardada.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao guardar configuração");
    } finally {
      setSaving(false);
    }
  }

  async function performPasswordReset(event: FormEvent) {
    event.preventDefault();
    if (!resetUser) return;
    setSaving(true);
    setError(null);
    try {
      await companiesApi.resetAdminUserPassword(resetUser.id, resetPassword);
      setResetUser(null);
      setResetPassword("");
      notify(en ? "Temporary password created and sessions revoked." : "Palavra-passe temporária criada e sessões terminadas.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao repor palavra-passe");
    } finally {
      setSaving(false);
    }
  }

  function toggleModule(module: CompanyModuleKey) {
    setSettings((current) => {
      const enabled = current.enabledModules.includes(module);
      if (enabled && current.enabledModules.length === 1) return current;
      return {
        ...current,
        enabledModules: enabled ? current.enabledModules.filter((key) => key !== module) : [...current.enabledModules, module],
      };
    });
  }

  function onPlanChange(planKey: string) {
    const plan = getPlanDefinition(planKey);
    const annual = subForm.billingCycle === "annual";
    const amount = annual ? plan?.annualPriceMzn ?? plan?.monthlyPriceMzn ?? 0 : plan?.monthlyPriceMzn ?? 0;
    setSubForm((current) => ({
      ...current,
      plan: planKey,
      amount: amount ? String(amount) : "",
      periodEnd: addMonthsIso(annual ? 12 : 1),
    }));
  }

  if (user?.role !== "super_admin" && user?.platformRole !== "super_admin") {
    return <div className="grid min-h-screen place-items-center text-slate-500">Sem acesso.</div>;
  }

  async function handleRunCleanup() {
    setCleanupRunning(true);
    setError(null);
    try {
      const summary = await companiesApi.runTrashCleanup();
      setSuccess(
        en
          ? `Cleanup done: ${summary.trashed} moved to trash (${formatBytes(summary.bytesFreed)} freed).`
          : `Limpeza concluída: ${summary.trashed} no lixo (${formatBytes(summary.bytesFreed)} libertados).`,
      );
      await reloadStorage();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCleanupRunning(false);
    }
  }

  async function handleRestoreTrash(projectId: string) {
    setError(null);
    try {
      await companiesApi.restoreTrash(projectId);
      setSuccess(en ? "Project restored (files stay purged)." : "Projecto restaurado (ficheiros continuam purgados).");
      await reloadStorage();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handlePermanentDelete(project: TrashedProject) {
    const ok = window.confirm(
      en
        ? `Permanently delete “${project.name}” from ${project.companyName}? This cannot be undone.`
        : `Apagar definitivamente “${project.name}” de ${project.companyName}? Esta acção não pode ser anulada.`,
    );
    if (!ok) return;
    setError(null);
    try {
      await companiesApi.permanentlyDeleteTrash(project.id);
      setSuccess(en ? "Project permanently deleted." : "Projecto apagado definitivamente.");
      await reloadStorage();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const views: Array<{ key: AdminView; label: string; icon: typeof IconHome }> = [
    { key: "overview", label: en ? "Overview" : "Visão geral", icon: IconHome },
    { key: "companies", label: en ? "Companies" : "Empresas", icon: IconBuilding },
    { key: "users", label: en ? "Users" : "Utilizadores", icon: IconUsers },
    { key: "storage", label: en ? "Disk & trash" : "Disco e lixo", icon: IconHardDrive },
    { key: "configuration", label: en ? "Modules & branding" : "Módulos e identidade", icon: IconSettings },
  ];

  return (
    <Layout
      title={en ? "SIGO Control Center" : "Centro de Controlo SIGO"}
      subtitle={en ? "Billing, usage, subscriptions and platform health" : "Facturação, uso, subscrições e estado da plataforma"}
      actions={
        <button type="button" onClick={() => setShowCreateCompany(true)} className="btn btn-primary btn-sm">
          <IconPlus className="h-4 w-4" />
          {en ? "New company" : "Nova empresa"}
        </button>
      }
    >
      <div className="mx-auto w-full max-w-7xl space-y-5">
        {error && (
          <AlertBanner tone="error" onDismiss={() => setError(null)}>
            {error}
          </AlertBanner>
        )}
        {success && <AlertBanner tone="success">{success}</AlertBanner>}

        <nav className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5" aria-label="Administração">
          {views.map((item) => {
            const Icon = item.icon;
            return (
              <button
                type="button"
                key={item.key}
                onClick={() => {
                  setView(item.key);
                  setQuery("");
                }}
                className={`flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-semibold ${
                  view === item.key ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </nav>

        {view === "overview" && stats && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard label={en ? "Companies" : "Empresas"} value={stats.totalCompanies} />
              <StatCard label={en ? "Active" : "Activas"} value={stats.activeCompanies} tone="text-emerald-700" />
              <StatCard label="Trial" value={stats.trialCompanies} tone="text-amber-700" />
              <StatCard label={en ? "Suspended" : "Suspensas"} value={stats.suspendedCompanies} tone="text-red-700" />
              <StatCard
                label={en ? "Est. monthly revenue" : "Receita mensal est."}
                value={money(stats.estimatedMonthlyRevenueMzn ?? 0)}
                hint={en ? "From active paid plans" : "Com base nos planos activos"}
                tone="text-brand-700"
              />
              <StatCard
                label={en ? "Collected this month" : "Cobrado este mês"}
                value={money(stats.collectedThisMonthMzn ?? 0)}
                tone="text-emerald-700"
              />
              <StatCard label={en ? "Total collected" : "Total cobrado"} value={money(stats.totalCollectedMzn ?? 0)} />
              <StatCard label={en ? "Users · Projects" : "Utilizadores · Projectos"} value={`${stats.totalUsers} · ${stats.totalProjects}`} />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <section className="card p-5">
                <h2 className="section-title">{en ? "Portfolio by plan" : "Carteira por plano"}</h2>
                <p className="muted mt-1">{en ? "Active commercial mix" : "Distribuição comercial actual"}</p>
                <div className="mt-4 space-y-3">
                  {SUBSCRIPTION_PLANS.map((plan) => {
                    const total = stats.planCounts[plan.key] ?? 0;
                    if (!total && !["profissional", "individual", "empresa", "free"].includes(plan.key)) return null;
                    return (
                      <div key={plan.key} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                        <div>
                          <strong className="text-sm text-slate-950">{plan.label}</strong>
                          <p className="text-xs text-slate-500">
                            {plan.monthlyPriceMzn == null
                              ? en
                                ? "On request"
                                : "Sob proposta"
                              : `${money(plan.monthlyPriceMzn)}/mês`}
                          </p>
                        </div>
                        <span className="badge badge-brand tabular-nums">{total}</span>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="card p-5">
                <h2 className="section-title">{en ? "Platform services" : "Serviços da plataforma"}</h2>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">API</p>
                    <strong className={stats.services.api ? "text-emerald-700" : "text-red-700"}>
                      {stats.services.api ? (en ? "Online" : "Operacional") : "Offline"}
                    </strong>
                  </div>
                  <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">Plant service</p>
                    <strong className={stats.services.plantService ? "text-emerald-700" : "text-red-700"}>
                      {stats.services.plantService ? (en ? "Online" : "Operacional") : "Offline"}
                    </strong>
                  </div>
                  <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">Assistente Ollama</p>
                    <strong className="text-slate-800">
                      {(() => {
                        const ai = stats.services.plantAi as { enabled?: boolean; reachable?: boolean; model?: string } | null | undefined;
                        if (!stats.services.plantService) return en ? "n/a" : "n/d";
                        if (!ai?.enabled) return en ? "Off" : "Desligada";
                        if (!ai.reachable) return "Ollama offline";
                        return ai.model ? `Ollama · ${ai.model}` : "Ollama";
                      })()}
                    </strong>
                  </div>
                  <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">{en ? "Email (SMTP)" : "Email (SMTP)"}</p>
                    <div className="flex items-center justify-between gap-2">
                      <strong className={mailEnabled ? "text-emerald-700" : "text-slate-500"}>
                        {mailEnabled === null ? "…" : mailEnabled ? (en ? "Configured" : "Configurado") : (en ? "Not configured" : "Não configurado")}
                      </strong>
                      {mailEnabled && (
                        <button type="button" onClick={handleTestEmail} disabled={testingEmail} className="btn btn-secondary btn-sm">
                          {testingEmail ? "…" : en ? "Test" : "Testar"}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">Sentry</p>
                    <div className="flex items-center justify-between gap-2">
                      <strong className={monitoringEnabled ? "text-emerald-700" : "text-slate-500"}>
                        {monitoringEnabled === null ? "…" : monitoringEnabled ? (en ? "Configured" : "Configurado") : (en ? "Not configured" : "Não configurado")}
                      </strong>
                      {monitoringEnabled && (
                        <button type="button" onClick={handleTestMonitoring} disabled={testingMonitoring} className="btn btn-secondary btn-sm">
                          {testingMonitoring ? "…" : en ? "Test" : "Testar"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </section>
            </div>

            <section className="card p-5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="section-title">{en ? "Commercial requests" : "Pedidos comerciais"}</h2>
                <span className="badge">{leads.length}</span>
              </div>
              {leads.length === 0 ? (
                <p className="text-sm text-slate-500">{en ? "Nothing new." : "Nada de novo."}</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {leads.map((lead) => (
                    <div key={lead.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div>
                        <strong className="text-sm text-slate-950">
                          {lead.name}
                          {lead.company ? ` · ${lead.company}` : ""}
                        </strong>
                        <p className="text-xs text-slate-500">
                          {lead.planOrPack ? `${lead.planOrPack} · ` : ""}
                          {lead.email}
                          {lead.phone ? ` · ${lead.phone}` : ""} · {fmtDate(lead.createdAt)}
                        </p>
                        {lead.notes && <p className="mt-1 text-xs text-slate-500">{lead.notes}</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        <a href={`mailto:${lead.email}`} className="btn btn-secondary btn-sm">
                          {en ? "Email" : "Email"}
                        </a>
                        {lead.phone && (
                          <a href={`tel:${lead.phone}`} className="btn btn-secondary btn-sm">
                            {en ? "Call" : "Ligar"}
                          </a>
                        )}
                        <button
                          type="button"
                          disabled={leadActionId === lead.id}
                          onClick={() => handleLeadStatus(lead.id, "contactado")}
                          className="btn btn-secondary btn-sm"
                        >
                          {en ? "Contacted" : "Contactado"}
                        </button>
                        <button
                          type="button"
                          disabled={leadActionId === lead.id}
                          onClick={() => handleLeadStatus(lead.id, "resolvido")}
                          className="btn btn-primary btn-sm"
                        >
                          {leadActionId === lead.id ? "..." : en ? "Resolved" : "Resolvido"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="card p-5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="section-title">{en ? "Pending payment proofs" : "Comprovativos de pagamento pendentes"}</h2>
                <span className="badge">{pendingProofs.length}</span>
              </div>
              {pendingProofs.length === 0 ? (
                <p className="text-sm text-slate-500">{en ? "Nothing to review." : "Nada por rever."}</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {pendingProofs.map((proof) => (
                    <div key={proof.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div>
                        <strong className="text-sm text-slate-950">{proof.companyName}</strong>
                        <p className="text-xs text-slate-500">
                          {getPlanDefinition(proof.plan)?.label ?? proof.plan} · {money(Number(proof.amount), proof.currency)} ·{" "}
                          {METHOD_LABELS[proof.method] ?? proof.method}
                          {proof.reference ? ` · ref. ${proof.reference}` : ""} · {fmtDate(proof.createdAt)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <a
                          href={companiesApi.paymentProofFileUrl(proof.id)}
                          target="_blank"
                          rel="noreferrer"
                          className="btn btn-secondary btn-sm"
                        >
                          {en ? "View file" : "Ver ficheiro"}
                        </a>
                        <button
                          type="button"
                          disabled={proofActionId === proof.id}
                          onClick={() => handleRejectProof(proof)}
                          className="btn btn-secondary btn-sm"
                        >
                          {en ? "Reject" : "Rejeitar"}
                        </button>
                        <button
                          type="button"
                          disabled={proofActionId === proof.id}
                          onClick={() => handleApproveProof(proof)}
                          className="btn btn-primary btn-sm"
                        >
                          {proofActionId === proof.id ? "..." : en ? "Approve" : "Aprovar"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <div className="grid gap-4 lg:grid-cols-2">
              <section className="card p-5">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2 className="section-title">{en ? "Expiring in 30 days" : "A expirar em 30 dias"}</h2>
                  <span className="badge">{stats.expiringSoon?.length ?? 0}</span>
                </div>
                {(stats.expiringSoon?.length ?? 0) === 0 ? (
                  <p className="text-sm text-slate-500">{en ? "No renewals due soon." : "Sem renovações próximas."}</p>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {stats.expiringSoon.map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        onClick={() => {
                          setDetailCompanyId(item.id);
                          setView("companies");
                        }}
                        className="flex w-full items-center justify-between gap-3 py-3 text-left hover:bg-slate-50"
                      >
                        <div>
                          <strong className="text-sm text-slate-950">{item.name}</strong>
                          <p className="text-xs text-slate-500">
                            {getPlanDefinition(item.plan)?.label ?? item.plan} · {STATUS_LABELS[item.status]}
                          </p>
                        </div>
                        <span className="text-xs font-medium text-amber-700">{fmtDate(item.expiresAt)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              <section className="card p-5">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2 className="section-title">{en ? "Near plan limits" : "Perto do limite do plano"}</h2>
                  <span className="badge">{stats.nearLimit?.length ?? 0}</span>
                </div>
                {(stats.nearLimit?.length ?? 0) === 0 ? (
                  <p className="text-sm text-slate-500">{en ? "No companies near limits." : "Nenhuma empresa perto do limite."}</p>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {stats.nearLimit.map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        onClick={() => {
                          setDetailCompanyId(item.id);
                          setView("companies");
                        }}
                        className="flex w-full items-center justify-between gap-3 py-3 text-left hover:bg-slate-50"
                      >
                        <strong className="text-sm text-slate-950">{item.name}</strong>
                        <span className="text-xs text-slate-500">
                          {item.users}/{item.maxUsers ?? "∞"} users · {item.projects}/{item.maxProjects ?? "∞"} proj.
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </>
        )}

        {view === "storage" && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="section-title">{en ? "Platform disk usage" : "Uso de disco da plataforma"}</h2>
                <p className="muted mt-1">
                  {en
                    ? `Read projects idle ${storage?.idleDays ?? 7}+ days move to trash weekly; Super Admin decides permanent delete.`
                    : `Projectos lidos há ${storage?.idleDays ?? 7}+ dias vão para o lixo semanalmente; o Super Admin decide o apagamento definitivo.`}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-secondary btn-sm" disabled={storageLoading} onClick={() => reloadStorage().catch((err) => setError(err.message))}>
                  {storageLoading ? (en ? "Loading…" : "A carregar…") : en ? "Refresh" : "Actualizar"}
                </button>
                <button type="button" className="btn btn-primary btn-sm" disabled={cleanupRunning} onClick={() => void handleRunCleanup()}>
                  {cleanupRunning ? (en ? "Running…" : "A correr…") : en ? "Run cleanup now" : "Correr limpeza agora"}
                </button>
              </div>
            </div>

            {storage && (
              <>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <StatCard label={en ? "Total on disk" : "Total no disco"} value={formatBytes(storage.totalBytes)} hint={storage.uploadsRoot} />
                  <StatCard label={en ? "Attributed to companies" : "Atribuído a empresas"} value={formatBytes(storage.attributedBytes ?? 0)} />
                  <StatCard
                    label={en ? "Eligible for cleanup" : "Elegíveis para limpeza"}
                    value={storage.eligibleForTrashCount}
                    hint={en ? `${storage.idleDays} days idle · ${storage.trashCount} in trash` : `${storage.idleDays} dias idle · ${storage.trashCount} no lixo`}
                  />
                  <StatCard label={en ? "Untracked / orphans" : "Sem dono / órfãos"} value={formatBytes(storage.orphanBytes)} tone="text-amber-700" />
                </div>

                <section className="card p-5">
                  <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
                    <div>
                      <h3 className="font-semibold text-slate-900">{en ? "Folders on disk" : "Pastas no disco"}</h3>
                      <p className="mt-1 text-xs text-slate-500">
                        {en ? "Real upload directories on the server" : "Pastas reais de uploads no servidor"}
                      </p>
                    </div>
                    <span className="text-sm font-semibold tabular-nums text-slate-700">{formatBytes(storage.totalBytes)}</span>
                  </div>

                  {storage.totalBytes > 0 && (
                    <div className="mb-5 flex h-3 overflow-hidden rounded-full bg-slate-100">
                      {(storage.folders?.length ? storage.folders : []).map((folder, index) => {
                        const pct = Math.max(0.4, (folder.bytes / storage.totalBytes) * 100);
                        const tones = ["bg-sky-500", "bg-emerald-500", "bg-violet-500", "bg-amber-500", "bg-rose-500", "bg-slate-500", "bg-orange-500"];
                        return (
                          <div
                            key={folder.name}
                            className={`${tones[index % tones.length]} h-full`}
                            style={{ width: `${pct}%` }}
                            title={`${folder.name}: ${formatBytes(folder.bytes)}`}
                          />
                        );
                      })}
                    </div>
                  )}

                  <div className="space-y-3">
                    {(storage.folders ?? []).length === 0 ? (
                      <p className="text-sm text-slate-500">{en ? "No upload folders found." : "Nenhuma pasta de uploads encontrada."}</p>
                    ) : (
                      (storage.folders ?? []).map((folder) => {
                        const label = FOLDER_LABELS[folder.name];
                        const pct = storage.totalBytes > 0 ? Math.round((folder.bytes / storage.totalBytes) * 100) : 0;
                        return (
                          <div key={folder.name}>
                            <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                              <div className="min-w-0">
                                <span className="font-medium text-slate-900">{label ? (en ? label.en : label.pt) : folder.name}</span>
                                <span className="ml-2 text-xs text-slate-400">/{folder.name}</span>
                              </div>
                              <div className="shrink-0 text-right">
                                <span className="font-semibold tabular-nums text-slate-900">{formatBytes(folder.bytes)}</span>
                                <span className="ml-2 text-xs tabular-nums text-slate-500">
                                  {folder.fileCount} {en ? "files" : "ficheiros"} · {pct}%
                                </span>
                              </div>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                              <div className="h-full rounded-full bg-brand-600" style={{ width: `${Math.max(pct, pct > 0 ? 2 : 0)}%` }} />
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </section>

                <section className="card p-5">
                  <h3 className="font-semibold text-slate-900">{en ? "By file type (linked to companies)" : "Por tipo de ficheiro (ligado a empresas)"}</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    {en ? "Only files still referenced in the database" : "Só ficheiros ainda referenciados na base de dados"}
                  </p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {Object.entries(storage.byCategory)
                      .filter(([, bytes]) => bytes > 0)
                      .sort((a, b) => b[1] - a[1])
                      .map(([key, bytes]) => {
                        const meta = STORAGE_CATEGORY_META[key] ?? { pt: key, en: key, tone: "bg-slate-400" };
                        const pct = storage.totalBytes > 0 ? Math.round((bytes / storage.totalBytes) * 100) : 0;
                        return (
                          <div key={key} className="rounded-xl border border-slate-200 p-4">
                            <div className="flex items-center gap-2">
                              <span className={`h-2.5 w-2.5 rounded-full ${meta.tone}`} />
                              <span className="text-xs font-medium text-slate-600">{en ? meta.en : meta.pt}</span>
                            </div>
                            <strong className="mt-2 block text-xl tabular-nums text-slate-950">{formatBytes(bytes)}</strong>
                            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                              <div className={`h-full rounded-full ${meta.tone}`} style={{ width: `${Math.max(pct, 2)}%` }} />
                            </div>
                            <span className="mt-1 block text-[11px] tabular-nums text-slate-400">{pct}% {en ? "of disk" : "do disco"}</span>
                          </div>
                        );
                      })}
                  </div>
                </section>

                <section className="card overflow-hidden">
                  <div className="border-b border-slate-100 px-4 py-3">
                    <h3 className="font-semibold text-slate-900">{en ? "By company" : "Por empresa"}</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      {en ? "Disk share and breakdown by file type" : "Quota de disco e distribuição por tipo de ficheiro"}
                    </p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                        <tr>
                          <th className="px-4 py-2">{en ? "Company" : "Empresa"}</th>
                          <th className="px-4 py-2 min-w-[12rem]">{en ? "Disk share" : "Quota de disco"}</th>
                          <th className="px-4 py-2">{en ? "Size" : "Tamanho"}</th>
                          <th className="px-4 py-2">{en ? "Active" : "Activos"}</th>
                          <th className="px-4 py-2">{en ? "Trash" : "Lixo"}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {storage.companies
                          .filter((row) => row.bytes > 0 || row.trashedProjects > 0)
                          .map((row) => {
                            const pct = storage.totalBytes > 0 ? Math.round((row.bytes / storage.totalBytes) * 100) : 0;
                            const parts = Object.entries(row.byCategory ?? {})
                              .filter(([, v]) => v > 0)
                              .sort((a, b) => b[1] - a[1]);
                            return (
                              <tr key={row.companyId}>
                                <td className="px-4 py-3">
                                  <strong className="text-slate-900">{row.companyName}</strong>
                                  {parts.length > 0 && (
                                    <p className="mt-1 text-[11px] text-slate-500">
                                      {parts
                                        .slice(0, 3)
                                        .map(([key, bytes]) => {
                                          const meta = STORAGE_CATEGORY_META[key];
                                          return `${meta ? (en ? meta.en : meta.pt) : key} ${formatBytes(bytes)}`;
                                        })
                                        .join(" · ")}
                                    </p>
                                  )}
                                </td>
                                <td className="px-4 py-3">
                                  <div className="flex h-2 overflow-hidden rounded-full bg-slate-100">
                                    {parts.length === 0 ? (
                                      <div className="h-full bg-slate-300" style={{ width: `${Math.max(pct, pct > 0 ? 2 : 0)}%` }} />
                                    ) : (
                                      parts.map(([key, bytes]) => {
                                        const partPct = row.bytes > 0 ? (bytes / row.bytes) * 100 : 0;
                                        const meta = STORAGE_CATEGORY_META[key];
                                        return (
                                          <div
                                            key={key}
                                            className={`h-full ${meta?.tone ?? "bg-slate-400"}`}
                                            style={{ width: `${Math.max(partPct, 1)}%` }}
                                            title={`${key}: ${formatBytes(bytes)}`}
                                          />
                                        );
                                      })
                                    )}
                                  </div>
                                  <span className="mt-1 block text-[11px] tabular-nums text-slate-400">{pct}% {en ? "of platform" : "da plataforma"}</span>
                                </td>
                                <td className="px-4 py-3 font-medium tabular-nums text-slate-900">{formatBytes(row.bytes)}</td>
                                <td className="px-4 py-3 tabular-nums">{row.activeProjects}</td>
                                <td className="px-4 py-3 tabular-nums">{row.trashedProjects}</td>
                              </tr>
                            );
                          })}
                        {storage.companies.filter((row) => row.bytes > 0 || row.trashedProjects > 0).length === 0 && (
                          <tr>
                            <td colSpan={5} className="px-4 py-6 text-sm text-slate-500">
                              {en ? "No company storage recorded yet." : "Ainda sem armazenamento por empresa."}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              </>
            )}

            <section className="card overflow-hidden">
              <div className="border-b border-slate-100 px-4 py-3">
                <h3 className="font-semibold text-slate-900">{en ? "Trash" : "Lixo"}</h3>
                <p className="mt-1 text-xs text-slate-500">
                  {en
                    ? "Metadata kept; plant PDFs and diary photos already purged. Restore does not bring files back."
                    : "Características mantidas; PDFs e fotos já foram purgados. Restaurar não recupera os ficheiros."}
                </p>
              </div>
              {trash.length === 0 ? (
                <p className="px-4 py-6 text-sm text-slate-500">{en ? "Trash is empty." : "O lixo está vazio."}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-4 py-2">{en ? "Project" : "Projecto"}</th>
                        <th className="px-4 py-2">{en ? "Company" : "Empresa"}</th>
                        <th className="px-4 py-2">{en ? "Trashed" : "No lixo"}</th>
                        <th className="px-4 py-2">{en ? "Reason" : "Motivo"}</th>
                        <th className="px-4 py-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {trash.map((row) => (
                        <tr key={row.id}>
                          <td className="px-4 py-2">
                            <strong className="text-slate-900">{row.name}</strong>
                            <p className="text-xs text-slate-500">
                              {row.client || "—"} · {row.plantCount} {en ? "plants" : "plantas"}
                            </p>
                          </td>
                          <td className="px-4 py-2">{row.companyName}</td>
                          <td className="px-4 py-2 whitespace-nowrap">{fmtDate(row.trashedAt)}</td>
                          <td className="px-4 py-2 text-xs text-slate-500">{row.trashReason ?? "—"}</td>
                          <td className="px-4 py-2">
                            <div className="flex flex-wrap justify-end gap-2">
                              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void handleRestoreTrash(row.id)}>
                                {en ? "Restore" : "Restaurar"}
                              </button>
                              <button type="button" className="btn btn-sm bg-red-600 text-white hover:bg-red-700" onClick={() => void handlePermanentDelete(row)}>
                                {en ? "Delete forever" : "Apagar de vez"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}

        {view === "companies" && (
          <>
            <section className="card p-4">
              <PageSearch
                value={query}
                onChange={setQuery}
                placeholder={en ? "Search company, plan, province or status…" : "Pesquisar empresa, plano, província ou estado…"}
                resultLabel={`${filteredCompanies.length} ${en ? "result(s)" : "resultado(s)"}`}
              />
            </section>
            <section className="card overflow-hidden">
              <div className="divide-y divide-slate-100">
                {filteredCompanies.map((company) => {
                  const days = daysUntil(company.subscription?.expiresAt);
                  const plan = getPlanDefinition(company.subscription?.plan ?? "free");
                  const expired = days != null && days < 0;
                  const soon = days != null && days >= 0 && days <= 14;
                  return (
                    <article key={company.id} className="grid gap-4 p-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] xl:items-center">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <strong className="text-base text-slate-950">{company.name}</strong>
                          <span className={`badge ${STATUS_BADGE[company.subscription?.status ?? "trial"]}`}>
                            {STATUS_LABELS[company.subscription?.status ?? "trial"]}
                          </span>
                          {expired && <span className="badge badge-red">{en ? "Expired" : "Expirada"}</span>}
                          {!expired && soon && <span className="badge badge-yellow">{en ? "Renew soon" : "Renovar em breve"}</span>}
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          {plan?.label ?? company.subscription?.plan} ·{" "}
                          {company.subscription?.billingCycle ? CYCLE_LABELS[company.subscription.billingCycle] ?? company.subscription.billingCycle : "—"} ·{" "}
                          {company.province ?? "Moçambique"}
                        </p>
                        <p className="mt-2 text-xs text-slate-600">
                          {en ? "Valid until" : "Válida até"} <strong>{fmtDate(company.subscription?.expiresAt)}</strong>
                          {days != null && !expired ? ` · ${days}d` : ""}
                          {" · "}
                          {en ? "Paid" : "Pago"} <strong>{money(company.totalPaidMzn ?? 0)}</strong>
                        </p>
                      </div>
                      <div className="space-y-2">
                        <UsageBar label={en ? "Users" : "Utilizadores"} used={company.usage?.users ?? 0} max={company.usage?.maxUsers ?? null} />
                        <UsageBar label={en ? "Projects" : "Projectos"} used={company.usage?.projects ?? 0} max={company.usage?.maxProjects ?? null} />
                        <p className="text-[11px] text-slate-400">
                          {company.enabledModules.length}/{MODULES.length} {en ? "modules" : "módulos"}
                          {company.usage?.lastLoginAt ? ` · ${en ? "Last login" : "Último acesso"} ${fmtDate(company.usage.lastLoginAt)}` : ""}
                        </p>
                      </div>
                      <div className="flex flex-wrap justify-end gap-2">
                        <button type="button" onClick={() => setDetailCompanyId(company.id)} className="btn btn-secondary btn-sm">
                          {en ? "Manage" : "Gerir"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void enterCompany(company.id)}
                          disabled={enteringCompanyId === company.id}
                          className="btn btn-primary btn-sm"
                        >
                          {enteringCompanyId === company.id ? (en ? "Entering…" : "A entrar…") : en ? "Enter" : "Entrar"}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          </>
        )}

        {view === "users" && (
          <>
            <section className="card p-4">
              <div className="grid gap-3 md:grid-cols-[260px_minmax(0,1fr)_auto]">
                <select value={selectedCompanyId} onChange={(event) => setSelectedCompanyId(event.target.value)} className="input">
                  {companies.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.name}
                    </option>
                  ))}
                </select>
                <PageSearch
                  value={query}
                  onChange={setQuery}
                  placeholder={en ? "Search name, email or role…" : "Pesquisar nome, email ou perfil…"}
                  resultLabel={`${filteredUsers.length} ${en ? "user(s)" : "utilizador(es)"}`}
                />
                <button type="button" onClick={() => setShowCreateUser(true)} disabled={!selectedCompanyId} className="btn btn-primary">
                  <IconPlus className="h-4 w-4" />
                  {en ? "New user" : "Novo utilizador"}
                </button>
              </div>
            </section>
            <section className="card overflow-hidden">
              <div className="divide-y divide-slate-100">
                {filteredUsers.map((member) => (
                  <article key={member.id} className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_190px_150px_110px_auto] lg:items-center">
                    <div className="min-w-0">
                      <strong className="block truncate text-sm text-slate-950">{member.name}</strong>
                      <span className="block truncate text-xs text-slate-500">{member.email}</span>
                    </div>
                    <select
                      value={member.role}
                      onChange={(event) => updateUser(member, { role: event.target.value as UserRole })}
                      className="input text-sm"
                    >
                      {Object.entries(ROLE_LABELS).map(([role, label]) => (
                        <option key={role} value={role}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={member.preferredLanguage}
                      onChange={(event) => updateUser(member, { preferredLanguage: event.target.value as "pt" | "en" })}
                      className="input text-sm"
                    >
                      <option value="pt">Português</option>
                      <option value="en">English</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => updateUser(member, { isActive: !member.isActive })}
                      className={`badge justify-center ${member.isActive ? "badge-green" : "badge-red"}`}
                    >
                      {member.isActive ? (en ? "Active" : "Activo") : en ? "Inactive" : "Inactivo"}
                    </button>
                    <button type="button" onClick={() => setResetUser(member)} className="btn btn-secondary btn-sm">
                      {en ? "Reset password" : "Repor palavra-passe"}
                    </button>
                  </article>
                ))}
              </div>
            </section>
          </>
        )}

        {view === "configuration" && (
          <>
            <section className="card p-4">
              <label className="label">{en ? "Company to configure" : "Empresa a configurar"}</label>
              <select value={selectedCompanyId} onChange={(event) => setSelectedCompanyId(event.target.value)} className="input max-w-md">
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
            </section>
            {selectedCompany && (
              <form onSubmit={saveSettings} className="space-y-5">
                <section className="card p-5">
                  <div className="mb-4">
                    <h2 className="section-title">{en ? "Identity and defaults" : "Identidade e padrões"}</h2>
                    <p className="muted mt-1">
                      {en ? "Controls the company workspace appearance and initial language." : "Controla a apresentação do espaço da empresa e o idioma inicial."}
                    </p>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    <div>
                      <label className="label">{en ? "Legal/company name" : "Nome da empresa"}</label>
                      <input value={settings.name} onChange={(event) => setSettings({ ...settings, name: event.target.value })} className="input" required />
                    </div>
                    <div>
                      <label className="label">{en ? "Display brand" : "Marca apresentada"}</label>
                      <input value={settings.brandName} onChange={(event) => setSettings({ ...settings, brandName: event.target.value })} placeholder="SIGO" className="input" />
                    </div>
                    <div>
                      <label className="label">{en ? "Default currency" : "Moeda padrão"}</label>
                      <select value={settings.defaultCurrency} onChange={(event) => setSettings({ ...settings, defaultCurrency: event.target.value })} className="input">
                        <option value="MZN">MZN</option>
                        <option value="USD">USD</option>
                      </select>
                    </div>
                    <div>
                      <label className="label">{en ? "Default language" : "Idioma padrão"}</label>
                      <select
                        value={settings.defaultLanguage}
                        onChange={(event) => setSettings({ ...settings, defaultLanguage: event.target.value as "pt" | "en" })}
                        className="input"
                      >
                        <option value="pt">Português</option>
                        <option value="en">English</option>
                      </select>
                    </div>
                    <div>
                      <label className="label">{en ? "Primary colour" : "Cor principal"}</label>
                      <div className="flex gap-2">
                        <input type="color" value={settings.primaryColor} onChange={(event) => setSettings({ ...settings, primaryColor: event.target.value })} className="h-11 w-14 rounded-lg border bg-white p-1" />
                        <input value={settings.primaryColor} onChange={(event) => setSettings({ ...settings, primaryColor: event.target.value })} className="input" />
                      </div>
                    </div>
                    <div>
                      <label className="label">{en ? "Action colour" : "Cor de acção"}</label>
                      <div className="flex gap-2">
                        <input type="color" value={settings.accentColor} onChange={(event) => setSettings({ ...settings, accentColor: event.target.value })} className="h-11 w-14 rounded-lg border bg-white p-1" />
                        <input value={settings.accentColor} onChange={(event) => setSettings({ ...settings, accentColor: event.target.value })} className="input" />
                      </div>
                    </div>
                  </div>
                </section>
                <section className="card p-5">
                  <div className="mb-4">
                    <h2 className="section-title">{en ? "Enabled modules" : "Módulos activos"}</h2>
                    <p className="muted mt-1">
                      {en ? "Disabled modules disappear from navigation and are blocked by the API." : "Módulos desligados desaparecem da navegação e ficam bloqueados na API."}
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {MODULES.map((module) => {
                      const active = settings.enabledModules.includes(module.key);
                      return (
                        <button
                          type="button"
                          key={module.key}
                          onClick={() => toggleModule(module.key)}
                          className={`flex min-h-20 items-center justify-between gap-3 rounded-xl border p-4 text-left ${
                            active ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-slate-50 opacity-70"
                          }`}
                        >
                          <span>
                            <strong className="block text-sm text-slate-950">{en ? module.en : module.pt}</strong>
                            <small className="mt-1 block text-slate-500">{en ? module.descriptionEn : module.descriptionPt}</small>
                          </span>
                          <span className={`relative h-6 w-11 shrink-0 rounded-full ${active ? "bg-emerald-500" : "bg-slate-300"}`}>
                            <span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-transform ${active ? "translate-x-6" : "translate-x-1"}`} />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
                <div className="flex justify-end">
                  <button type="submit" disabled={saving} className="btn btn-primary">
                    {saving ? (en ? "Saving…" : "A guardar…") : en ? "Save configuration" : "Guardar configuração"}
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </div>

      {detailCompany && (
        <Modal
          title={detailCompany.name}
          subtitle={`${getPlanDefinition(detailCompany.subscription?.plan ?? "")?.label ?? detailCompany.subscription?.plan} · ${STATUS_LABELS[detailCompany.subscription?.status ?? "trial"]}`}
          onClose={() => setDetailCompanyId(null)}
          maxWidth="max-w-4xl"
        >
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["subscription", en ? "Subscription" : "Subscrição"],
                  ["usage", en ? "Usage" : "Uso"],
                  ["credits", en ? "Credits" : "Créditos"],
                  ["payments", en ? "Payments" : "Pagamentos"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setDetailTab(key)}
                  className={`rounded-lg px-3 py-2 text-sm font-semibold ${detailTab === key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}
                >
                  {label}
                </button>
              ))}
              <div className="ml-auto flex flex-wrap gap-2">
                <button type="button" onClick={() => void downloadBackup(detailCompany)} disabled={saving} className="btn btn-secondary btn-sm">
                  {en ? "Full backup (ZIP)" : "Backup completo (ZIP)"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCompanyId(detailCompany.id);
                    setDetailCompanyId(null);
                    setView("configuration");
                  }}
                  className="btn btn-secondary btn-sm"
                >
                  {en ? "Modules" : "Módulos"}
                </button>
                <button type="button" onClick={() => void enterCompany(detailCompany.id)} className="btn btn-primary btn-sm">
                  {en ? "Enter" : "Entrar"}
                </button>
              </div>
            </div>

            {detailTab === "subscription" && (
              <form onSubmit={saveSubscription} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="label">{en ? "Plan" : "Plano"}</label>
                    <select value={subForm.plan} onChange={(event) => onPlanChange(event.target.value)} className="input">
                      {SUBSCRIPTION_PLANS.map((plan) => (
                        <option key={plan.key} value={plan.key}>
                          {plan.label}
                          {plan.monthlyPriceMzn != null ? ` · ${money(plan.monthlyPriceMzn)}/mês` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">{en ? "Status" : "Estado"}</label>
                    <select
                      value={subForm.status}
                      onChange={(event) => setSubForm({ ...subForm, status: event.target.value as typeof subForm.status })}
                      className="input"
                    >
                      <option value="trial">Trial</option>
                      <option value="activo">{en ? "Active" : "Activo"}</option>
                      <option value="suspenso">{en ? "Suspended" : "Suspenso"}</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">{en ? "Billing cycle" : "Ciclo"}</label>
                    <select
                      value={subForm.billingCycle}
                      onChange={(event) => {
                        const billingCycle = event.target.value as typeof subForm.billingCycle;
                        const plan = getPlanDefinition(subForm.plan);
                        const amount =
                          billingCycle === "annual" ? plan?.annualPriceMzn ?? plan?.monthlyPriceMzn ?? 0 : plan?.monthlyPriceMzn ?? 0;
                        setSubForm({
                          ...subForm,
                          billingCycle,
                          amount: amount ? String(amount) : "",
                          periodEnd: addMonthsIso(billingCycle === "annual" ? 12 : 1),
                        });
                      }}
                      className="input"
                    >
                      <option value="monthly">{en ? "Monthly" : "Mensal"}</option>
                      <option value="annual">{en ? "Annual" : "Anual"}</option>
                      <option value="custom">{en ? "Custom" : "Personalizado"}</option>
                      <option value="trial">Trial</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">{en ? "Valid until" : "Válida até"}</label>
                    <input type="date" value={subForm.expiresAt} onChange={(event) => setSubForm({ ...subForm, expiresAt: event.target.value })} className="input" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="label">{en ? "Notes" : "Notas"}</label>
                    <textarea value={subForm.notes} onChange={(event) => setSubForm({ ...subForm, notes: event.target.value })} className="input min-h-20" />
                  </div>
                </div>

                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={subForm.recordPayment}
                    onChange={(event) => setSubForm({ ...subForm, recordPayment: event.target.checked })}
                  />
                  {en ? "Also record a payment for this change" : "Registar também um pagamento nesta alteração"}
                </label>

                {subForm.recordPayment && (
                  <div className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
                    <div>
                      <label className="label">{en ? "Amount (MZN)" : "Valor (MZN)"}</label>
                      <input type="number" min={0} step="1" value={subForm.amount} onChange={(event) => setSubForm({ ...subForm, amount: event.target.value })} className="input" required={subForm.recordPayment} />
                    </div>
                    <div>
                      <label className="label">{en ? "Method" : "Método"}</label>
                      <select value={subForm.method} onChange={(event) => setSubForm({ ...subForm, method: event.target.value as typeof subForm.method })} className="input">
                        {Object.entries(METHOD_LABELS).map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="label">{en ? "Reference" : "Referência"}</label>
                      <input value={subForm.reference} onChange={(event) => setSubForm({ ...subForm, reference: event.target.value })} className="input" placeholder="Transferência / M-Pesa…" />
                    </div>
                    <div>
                      <label className="label">{en ? "Period start" : "Início do período"}</label>
                      <input type="date" value={subForm.periodStart} onChange={(event) => setSubForm({ ...subForm, periodStart: event.target.value })} className="input" />
                    </div>
                    <div>
                      <label className="label">{en ? "Period end" : "Fim do período"}</label>
                      <input type="date" value={subForm.periodEnd} onChange={(event) => setSubForm({ ...subForm, periodEnd: event.target.value })} className="input" />
                    </div>
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setDetailCompanyId(null)} className="btn btn-secondary">
                    {en ? "Close" : "Fechar"}
                  </button>
                  <button type="submit" disabled={saving} className="btn btn-primary">
                    {saving ? (en ? "Saving…" : "A guardar…") : en ? "Save subscription" : "Guardar subscrição"}
                  </button>
                </div>
              </form>
            )}

            {detailTab === "usage" && detailUsage && (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <UsageBar label={en ? "Users" : "Utilizadores"} used={detailUsage.users} max={detailUsage.maxUsers} />
                  <UsageBar label={en ? "Projects" : "Projectos"} used={detailUsage.projects} max={detailUsage.maxProjects} />
                </div>
                {creditInfo?.summary?.usage && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <UsageBar
                      label={en ? "Smart imports (month)" : "Importações (mês)"}
                      used={creditInfo.summary.usage.smartImportsUsed}
                      max={creditInfo.summary.smartImportsPerMonth ?? null}
                    />
                    <UsageBar
                      label={en ? "Plant analyses (month)" : "Plantas (mês)"}
                      used={creditInfo.summary.usage.plantAnalysesUsed}
                      max={creditInfo.summary.plantAnalysesPerMonth ?? null}
                    />
                    <UsageBar
                      label={en ? "Custom compositions" : "Composições próprias"}
                      used={creditInfo.summary.usage.customCompositions}
                      max={creditInfo.summary.customCompositions ?? null}
                    />
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                      <p className="text-xs text-slate-500">{en ? "Credit balance" : "Saldo de créditos"}</p>
                      <p className="mt-1 font-semibold text-slate-950">
                        {creditInfo.balances.smartImportCredits} imports · {creditInfo.balances.plantAnalysisCredits}{" "}
                        {en ? "plants" : "plantas"}
                      </p>
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <StatCard label={en ? "Budgets" : "Orçamentos"} value={detailUsage.budgets} />
                  <StatCard label={en ? "Drawings" : "Plantas"} value={detailUsage.plants} />
                  <StatCard label={en ? "Clients" : "Clientes"} value={detailUsage.practiceClients} />
                  <StatCard label={en ? "Quotes" : "Propostas"} value={detailUsage.practiceQuotes} />
                </div>
                <p className="text-sm text-slate-500">
                  {en ? "Last login" : "Último acesso"}: <strong>{fmtDate(detailUsage.lastLoginAt)}</strong>
                  {" · "}
                  {en ? "Engagements" : "Contratos comerciais"}: <strong>{detailUsage.practiceEngagements}</strong>
                </p>
              </div>
            )}

            {detailTab === "credits" && (
              <div className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <StatCard
                    label={en ? "Import credits" : "Créditos importação"}
                    value={creditInfo?.balances.smartImportCredits ?? 0}
                  />
                  <StatCard
                    label={en ? "Plant credits" : "Créditos plantas"}
                    value={creditInfo?.balances.plantAnalysisCredits ?? 0}
                  />
                </div>

                <form onSubmit={grantCredits} className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <h3 className="text-sm font-semibold text-slate-800">
                    {en ? "Grant credit pack" : "Atribuir pack de créditos"}
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label className="label">{en ? "Pack" : "Pack"}</label>
                      <select
                        value={creditForm.packId}
                        onChange={(event) => {
                          const packId = event.target.value;
                          const pack = CREDIT_PACKS.find((p) => p.id === packId);
                          setCreditForm({
                            ...creditForm,
                            packId,
                            amount: pack ? String(pack.priceMzn) : creditForm.amount,
                            smartImports: "",
                            plantAnalyses: "",
                          });
                        }}
                        className="input"
                      >
                        {CREDIT_PACKS.map((pack) => (
                          <option key={pack.id} value={pack.id}>
                            {pack.label} · {money(pack.priceMzn)}
                          </option>
                        ))}
                        <option value="">{en ? "Custom quantities" : "Quantidades manuais"}</option>
                      </select>
                    </div>
                    {!creditForm.packId && (
                      <>
                        <div>
                          <label className="label">{en ? "Import credits" : "Créditos importação"}</label>
                          <input
                            type="number"
                            min={0}
                            value={creditForm.smartImports}
                            onChange={(event) => setCreditForm({ ...creditForm, smartImports: event.target.value })}
                            className="input"
                          />
                        </div>
                        <div>
                          <label className="label">{en ? "Plant credits" : "Créditos plantas"}</label>
                          <input
                            type="number"
                            min={0}
                            value={creditForm.plantAnalyses}
                            onChange={(event) => setCreditForm({ ...creditForm, plantAnalyses: event.target.value })}
                            className="input"
                          />
                        </div>
                      </>
                    )}
                    <div>
                      <label className="label">{en ? "Amount (MZN net)" : "Valor (MZN líquido)"}</label>
                      <input
                        type="number"
                        min={0}
                        value={creditForm.amount}
                        onChange={(event) => setCreditForm({ ...creditForm, amount: event.target.value })}
                        className="input"
                      />
                    </div>
                    <div>
                      <label className="label">{en ? "Method" : "Método"}</label>
                      <select
                        value={creditForm.method}
                        onChange={(event) =>
                          setCreditForm({ ...creditForm, method: event.target.value as typeof creditForm.method })
                        }
                        className="input"
                      >
                        {Object.entries(METHOD_LABELS).map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="label">{en ? "Reference" : "Referência"}</label>
                      <input
                        value={creditForm.reference}
                        onChange={(event) => setCreditForm({ ...creditForm, reference: event.target.value })}
                        className="input"
                      />
                    </div>
                    <div>
                      <label className="label">{en ? "Note" : "Nota"}</label>
                      <input
                        value={creditForm.note}
                        onChange={(event) => setCreditForm({ ...creditForm, note: event.target.value })}
                        className="input"
                      />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={creditForm.recordPayment}
                      onChange={(event) => setCreditForm({ ...creditForm, recordPayment: event.target.checked })}
                    />
                    {en ? "Also record a payment" : "Registar também o pagamento"}
                  </label>
                  <button type="submit" disabled={saving} className="btn btn-primary">
                    {saving ? (en ? "Saving…" : "A guardar…") : en ? "Grant credits" : "Atribuir créditos"}
                  </button>
                </form>

                <div className="overflow-hidden rounded-xl border border-slate-200">
                  <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {en ? "Credit ledger" : "Movimentos de créditos"}
                  </div>
                  {!creditInfo?.ledger?.length ? (
                    <p className="p-4 text-sm text-slate-500">{en ? "No credit movements yet." : "Ainda sem movimentos."}</p>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {creditInfo.ledger.map((entry) => (
                        <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                          <div>
                            <strong className={entry.delta >= 0 ? "text-emerald-700" : "text-rose-700"}>
                              {entry.delta >= 0 ? "+" : ""}
                              {entry.delta}
                            </strong>{" "}
                            <span className="text-slate-600">
                              {entry.kind === "smart_import" ? (en ? "imports" : "importações") : en ? "plants" : "plantas"}
                              {entry.packId ? ` · ${entry.packId}` : ""}
                              {entry.note ? ` · ${entry.note}` : ""}
                            </span>
                          </div>
                          <span className="text-xs text-slate-500">{fmtDate(entry.createdAt)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {detailTab === "payments" && (
              <div className="space-y-5">
                <form onSubmit={recordPayment} className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <label className="label">{en ? "Amount" : "Valor"}</label>
                    <input required type="number" min={1} value={payForm.amount} onChange={(event) => setPayForm({ ...payForm, amount: event.target.value })} className="input" />
                  </div>
                  <div>
                    <label className="label">{en ? "Method" : "Método"}</label>
                    <select value={payForm.method} onChange={(event) => setPayForm({ ...payForm, method: event.target.value as typeof payForm.method })} className="input">
                      {Object.entries(METHOD_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">{en ? "Reference" : "Referência"}</label>
                    <input value={payForm.reference} onChange={(event) => setPayForm({ ...payForm, reference: event.target.value })} className="input" />
                  </div>
                  <div>
                    <label className="label">{en ? "Period start" : "Início"}</label>
                    <input type="date" value={payForm.periodStart} onChange={(event) => setPayForm({ ...payForm, periodStart: event.target.value })} className="input" />
                  </div>
                  <div>
                    <label className="label">{en ? "Period end" : "Fim"}</label>
                    <input type="date" value={payForm.periodEnd} onChange={(event) => setPayForm({ ...payForm, periodEnd: event.target.value })} className="input" />
                  </div>
                  <div className="flex items-end">
                    <button type="submit" disabled={saving} className="btn btn-primary w-full">
                      {en ? "Record payment" : "Registar pagamento"}
                    </button>
                  </div>
                </form>

                <div className="overflow-hidden rounded-xl border border-slate-200">
                  <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {en ? "Payment history" : "Histórico de pagamentos"} · {money(detailCompany.totalPaidMzn ?? 0)}
                  </div>
                  {payments.length === 0 ? (
                    <p className="p-4 text-sm text-slate-500">{en ? "No payments recorded yet." : "Ainda sem pagamentos registados."}</p>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {payments.map((payment) => (
                        <div key={payment.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[120px_minmax(0,1fr)_auto] sm:items-center">
                          <strong className="tabular-nums text-slate-950">{money(Number(payment.amount), payment.currency)}</strong>
                          <div className="min-w-0 text-xs text-slate-500">
                            <p>
                              {METHOD_LABELS[payment.method] ?? payment.method}
                              {payment.reference ? ` · ${payment.reference}` : ""}
                            </p>
                            <p>
                              {getPlanDefinition(payment.plan)?.label ?? payment.plan}
                              {payment.periodStart || payment.periodEnd
                                ? ` · ${fmtDate(payment.periodStart)} → ${fmtDate(payment.periodEnd)}`
                                : ""}
                            </p>
                          </div>
                          <span className="text-xs text-slate-500">{fmtDate(payment.paidAt)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {showCreateCompany && (
        <Modal
          title={en ? "New company" : "Nova empresa"}
          subtitle={en ? "Creates the company and its first administrator" : "Cria a empresa e o primeiro administrador"}
          onClose={() => setShowCreateCompany(false)}
          maxWidth="max-w-3xl"
        >
          <form onSubmit={createCompany} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label">{en ? "Company name" : "Nome da empresa"}</label>
                <input required value={companyForm.name} onChange={(event) => setCompanyForm({ ...companyForm, name: event.target.value })} className="input" />
              </div>
              <div>
                <label className="label">{en ? "Administrator name" : "Nome do administrador"}</label>
                <input required value={companyForm.adminName} onChange={(event) => setCompanyForm({ ...companyForm, adminName: event.target.value })} className="input" />
              </div>
              <div>
                <label className="label">{en ? "Administrator email" : "Email do administrador"}</label>
                <input required type="email" value={companyForm.adminEmail} onChange={(event) => setCompanyForm({ ...companyForm, adminEmail: event.target.value })} className="input" />
              </div>
              <div>
                <label className="label">{en ? "Temporary password" : "Palavra-passe temporária"}</label>
                <input required minLength={8} type="password" value={companyForm.adminPassword} onChange={(event) => setCompanyForm({ ...companyForm, adminPassword: event.target.value })} className="input" />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowCreateCompany(false)} className="btn btn-secondary">
                {en ? "Cancel" : "Cancelar"}
              </button>
              <button type="submit" disabled={saving} className="btn btn-primary">
                {en ? "Create company" : "Criar empresa"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {showCreateUser && (
        <Modal title={en ? "New company user" : "Novo utilizador da empresa"} subtitle={selectedCompany?.name} onClose={() => setShowCreateUser(false)} maxWidth="max-w-2xl">
          <form onSubmit={createUser} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label">{en ? "Name" : "Nome"}</label>
                <input required value={userForm.name} onChange={(event) => setUserForm({ ...userForm, name: event.target.value })} className="input" />
              </div>
              <div>
                <label className="label">Email</label>
                <input required type="email" value={userForm.email} onChange={(event) => setUserForm({ ...userForm, email: event.target.value })} className="input" />
              </div>
              <div>
                <label className="label">{en ? "Role" : "Perfil"}</label>
                <select value={userForm.role} onChange={(event) => setUserForm({ ...userForm, role: event.target.value as UserRole })} className="input">
                  {Object.entries(ROLE_LABELS).map(([role, label]) => (
                    <option key={role} value={role}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">{en ? "Language" : "Idioma"}</label>
                <select
                  value={userForm.preferredLanguage}
                  onChange={(event) => setUserForm({ ...userForm, preferredLanguage: event.target.value as "pt" | "en" })}
                  className="input"
                >
                  <option value="pt">Português</option>
                  <option value="en">English</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="label">{en ? "Temporary password" : "Palavra-passe temporária"}</label>
                <input required minLength={8} type="password" value={userForm.password} onChange={(event) => setUserForm({ ...userForm, password: event.target.value })} className="input" />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowCreateUser(false)} className="btn btn-secondary">
                {en ? "Cancel" : "Cancelar"}
              </button>
              <button type="submit" disabled={saving} className="btn btn-primary">
                {en ? "Create user" : "Criar utilizador"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {resetUser && (
        <Modal title={en ? "Reset password" : "Repor palavra-passe"} subtitle={`${resetUser.name} · ${resetUser.companyName}`} onClose={() => setResetUser(null)} maxWidth="max-w-lg">
          <form onSubmit={performPasswordReset} className="space-y-4">
            <div>
              <label className="label">{en ? "New temporary password" : "Nova palavra-passe temporária"}</label>
              <input required minLength={8} type="password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} className="input" />
              <p className="muted mt-1">{en ? "All active sessions will be revoked." : "Todas as sessões activas serão terminadas."}</p>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setResetUser(null)} className="btn btn-secondary">
                {en ? "Cancel" : "Cancelar"}
              </button>
              <button type="submit" disabled={saving} className="btn btn-primary">
                {en ? "Reset password" : "Repor palavra-passe"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </Layout>
  );
}

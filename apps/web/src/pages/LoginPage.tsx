import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth, ApiError } from "../auth/AuthContext";
import { LogoMark } from "../components/Logo";

// Mensagens para os códigos de erro que a API devolve via query string depois de um callback do
// Google mal sucedido (não há forma de devolver JSON num redirect de browser completo).
const GOOGLE_ERROR_MESSAGES: Record<string, string> = {
  google_nao_configurado: "O login com Google não está disponível neste momento.",
  falha_google: "Não foi possível confirmar a sua conta Google. Tente novamente.",
  email_google_nao_verificado: "O seu email Google não está verificado.",
  conta_google_nao_encontrada: "Não existe nenhuma conta SIGO com este email. Peça ao administrador da sua empresa para a criar primeiro.",
  conta_desactivada: "Esta conta foi desactivada. Contacte o administrador da sua empresa.",
  subscricao_suspensa: "A subscrição da sua empresa está suspensa. Contacte o suporte.",
};

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);

  useEffect(() => {
    const code = searchParams.get("error");
    if (code) setError(GOOGLE_ERROR_MESSAGES[code] ?? "Não foi possível entrar com Google.");
  }, [searchParams]);

  useEffect(() => {
    fetch("/api/auth/config")
      .then((res) => res.json())
      .then((data) => setGoogleEnabled(Boolean(data.googleEnabled)))
      .catch(() => setGoogleEnabled(false));
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const loggedInUser = await login(email, password);
      navigate(loggedInUser.mustChangePassword ? "/perfil?password=required" : loggedInUser.role === "super_admin" ? "/admin" : "/painel");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erro ao entrar");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-[#172033]">
      {/* Painel de marca */}
      <div className="hidden lg:flex flex-col justify-between text-white p-14 xl:p-20">
        <Link to="/" className="flex items-center gap-3">
          <LogoMark className="h-10 w-10" />
          <div>
            <p className="text-2xl font-black tracking-[0.2em]">SIGO</p>
            <p className="text-[9px] uppercase tracking-[0.14em] text-slate-400">Sistema Integrado de Gestão de Obras</p>
          </div>
        </Link>
        <div className="max-w-lg">
          <h1 className="text-4xl font-bold leading-tight tracking-tight">Gestão de obras sem complicação.</h1>
          <p className="mt-4 max-w-md text-base leading-7 text-slate-300">
            Orçamentos, medições, compras e controlo financeiro numa plataforma feita para equipas de construção.
          </p>
          <div className="mt-8 space-y-3 text-sm text-slate-200">
            {["Planeamento e orçamento", "Acompanhamento da execução", "Controlo de custos e compras"].map((item) => (
              <div key={item} className="flex items-center gap-3">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-white/10 text-[#1AADB4] text-xs">✓</span>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs text-slate-500">Moçambique · MZN & USD</p>
      </div>

      {/* Formulário */}
      <div className="flex items-center justify-center bg-[#f4f6f8] px-6 py-12">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center justify-center gap-2.5 mb-6">
            <LogoMark className="h-8 w-8" />
            <p className="text-2xl font-black tracking-[0.18em] text-brand-950">SIGO</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-7 md:p-9 shadow-sm">
            <h2 className="text-2xl font-bold tracking-tight text-slate-900">Entrar no SIGO</h2>
            <p className="text-sm text-slate-500 mt-1 mb-7">Utilize as credenciais da sua empresa.</p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="label">Email</label>
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="input" placeholder="nome@empresa.co.mz" />
              </div>
              <div>
                <label className="label">Palavra-passe</label>
                <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="input" placeholder="••••••••" />
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <button type="submit" disabled={submitting} className="btn btn-primary w-full">
                {submitting ? "A entrar..." : "Entrar"}
              </button>
            </form>

            {googleEnabled && (
              <>
                <div className="flex items-center gap-3 my-4">
                  <div className="h-px bg-gray-200 flex-1" />
                  <span className="text-xs text-gray-400">ou</span>
                  <div className="h-px bg-gray-200 flex-1" />
                </div>
                <a
                  href="/api/auth/google/start"
                  className="btn btn-secondary w-full flex items-center justify-center gap-2"
                >
                  <svg viewBox="0 0 48 48" className="w-4 h-4" aria-hidden="true">
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.9-2.26 5.36-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                    <path fill="#FBBC05" d="M10.53 28.59A14.5 14.5 0 0 1 9.5 24c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.94 23.94 0 0 0 0 24c0 3.87.92 7.53 2.56 10.78z" />
                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                  </svg>
                  Entrar com Google
                </a>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

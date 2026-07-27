import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth, ApiError } from "../auth/AuthContext";

// Mensagens para os códigos de erro que a API devolve via query string depois de um callback do
// Google mal sucedido (não há forma de devolver JSON num redirect de browser completo).
const GOOGLE_ERROR_MESSAGES: Record<string, string> = {
  google_nao_configurado: "O login com Google não está disponível neste momento.",
  falha_google: "Não foi possível confirmar a sua conta Google. Tente novamente.",
  email_google_nao_verificado: "O seu email Google não está verificado.",
  conta_google_nao_encontrada: "Não existe nenhuma conta SIGA com este email. Peça ao administrador da sua empresa para a criar primeiro.",
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
      await login(email, password);
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erro ao entrar");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-[1.08fr_0.92fr] bg-[#071d19]">
      {/* Painel de marca */}
      <div className="hidden lg:flex relative overflow-hidden flex-col justify-between text-white p-14 xl:p-20">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(52,211,153,0.22),transparent_32%),linear-gradient(145deg,#071d19_0%,#022c22_58%,#04120f_100%)]" />
        <div className="absolute -right-28 top-24 h-80 w-80 rounded-full border border-brand-300/10" />
        <div className="absolute -right-12 top-40 h-52 w-52 rounded-full border border-brand-300/10" />
        <div className="relative flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-400 text-brand-950 text-lg font-black">S</span>
          <div>
            <p className="text-2xl font-black tracking-[0.2em]">SIGA</p>
            <p className="text-[10px] uppercase tracking-[0.22em] text-brand-300/80">Gestão inteligente de obras</p>
          </div>
        </div>
        <div className="relative max-w-xl">
          <span className="inline-flex rounded-full border border-brand-300/20 bg-brand-300/10 px-3 py-1 text-xs font-semibold text-brand-200">
            Construído para a realidade moçambicana
          </span>
          <h1 className="mt-6 text-4xl xl:text-5xl font-black leading-[1.08] tracking-tight">
            Da primeira medição à entrega da obra.
          </h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-slate-300">
            Planeie custos, acompanhe a execução e tome decisões com informação clara — tudo num só lugar.
          </p>
          <div className="mt-8 grid grid-cols-2 gap-3 max-w-lg text-sm text-slate-200">
            {["Orçamentos rigorosos", "Controlo financeiro", "Autos de medição", "Leitura de plantas"].map((item) => (
              <div key={item} className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/5 px-3 py-3">
                <span className="h-2 w-2 rounded-full bg-brand-400 shadow-[0_0_12px_rgba(52,211,153,0.8)]" />
                {item}
              </div>
            ))}
          </div>
        </div>
        <p className="relative text-xs text-slate-400">Moçambique · MZN & USD</p>
      </div>

      {/* Formulário */}
      <div className="flex items-center justify-center bg-[#f7f8f6] px-6 py-12 lg:rounded-l-[2.5rem] lg:shadow-[-24px_0_80px_rgba(0,0,0,0.16)]">
        <div className="w-full max-w-md">
          <div className="lg:hidden text-center mb-6">
            <p className="text-2xl font-black tracking-[0.18em] text-brand-950">SIGA</p>
          </div>
          <div className="rounded-3xl border border-slate-200/80 bg-white p-7 md:p-9 shadow-xl shadow-slate-900/5">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-700">Bem-vindo de volta</p>
            <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-900">Entre na sua conta</h2>
            <p className="text-sm text-slate-500 mt-1 mb-7">Acompanhe as suas obras com confiança.</p>

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

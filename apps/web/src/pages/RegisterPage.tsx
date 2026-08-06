import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Eye, EyeOff } from "lucide-react";
import { ApiError } from "../api/http";
import { Logo } from "../components/landing/brand/Logo";
import { Button } from "../components/landing/ui/Button";
import AlertBanner from "../components/AlertBanner";

export default function RegisterPage() {
  const companyId = useId();
  const nameId = useId();
  const emailId = useId();
  const passwordId = useId();
  const errorId = useId();
  const companyRef = useRef<HTMLInputElement>(null);

  const [companyName, setCompanyName] = useState("");
  const [adminName, setAdminName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    document.title = "Criar conta — SIGO";
    return () => {
      document.title = "SIGO — Sistema Integrado de Gestão de Obras";
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => companyRef.current?.focus(), 80);
    return () => window.clearTimeout(timer);
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName: companyName.trim(), adminName: adminName.trim(), email: email.trim(), password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiError(res.status, typeof body.error === "string" ? body.error : "Não foi possível criar a conta");
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar a conta");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative min-h-dvh overflow-hidden bg-surface text-ink">
      <div className="sigo-grid absolute inset-0 opacity-70" aria-hidden="true" />
      <div
        className="absolute inset-x-0 top-0 h-[560px]"
        style={{
          background:
            "radial-gradient(40rem 34rem at 18% 0%, rgba(26,173,180,0.16), transparent 62%), radial-gradient(36rem 30rem at 88% 8%, rgba(237,108,34,0.12), transparent 60%)",
        }}
        aria-hidden="true"
      />

      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-[440px] flex-col justify-center px-5 py-12 sm:px-6">
        <motion.header
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="text-center"
        >
          <Link
            to="/"
            className="inline-flex rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal"
            aria-label="SIGO — voltar ao site"
          >
            <Logo size={56} className="mx-auto" />
          </Link>
          <p className="mt-5 text-[14px] leading-5 text-ink-400">
            Comece a orçamentar hoje — 14 dias grátis, sem cartão.
          </p>
        </motion.header>

        <motion.main
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.06 }}
          className="mt-8"
        >
          {done ? (
            <div className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-raised sm:p-7">
              <AlertBanner tone="success">
                Falta confirmar o email. Enviámos um link para <strong>{email}</strong> — abra-o para activar a conta e
                começar o período de avaliação.
              </AlertBanner>
              <Link to="/login" className="mt-5 block">
                <Button size="lg" fullWidth variant="secondary">Ir para o login</Button>
              </Link>
            </div>
          ) : (
            <form
              onSubmit={handleSubmit}
              noValidate
              aria-busy={submitting}
              className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-raised sm:p-7"
            >
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-[13px] font-semibold text-ink" htmlFor={companyId}>
                    Nome da empresa
                  </label>
                  <input
                    ref={companyRef}
                    id={companyId}
                    required
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    disabled={submitting}
                    className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-[15px] text-ink outline-none transition placeholder:text-slate-400 focus:border-teal focus:ring-2 focus:ring-teal/25 disabled:opacity-60"
                    placeholder="Ex: Construtora Beira Lda"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[13px] font-semibold text-ink" htmlFor={nameId}>
                    O seu nome
                  </label>
                  <input
                    id={nameId}
                    required
                    autoComplete="name"
                    value={adminName}
                    onChange={(e) => setAdminName(e.target.value)}
                    disabled={submitting}
                    className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-[15px] text-ink outline-none transition placeholder:text-slate-400 focus:border-teal focus:ring-2 focus:ring-teal/25 disabled:opacity-60"
                    placeholder="Nome completo"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[13px] font-semibold text-ink" htmlFor={emailId}>
                    Email profissional
                  </label>
                  <input
                    id={emailId}
                    type="email"
                    inputMode="email"
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={submitting}
                    className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-[15px] text-ink outline-none transition placeholder:text-slate-400 focus:border-teal focus:ring-2 focus:ring-teal/25 disabled:opacity-60"
                    placeholder="nome@empresa.co.mz"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[13px] font-semibold text-ink" htmlFor={passwordId}>
                    Palavra-passe
                  </label>
                  <div className="relative">
                    <input
                      id={passwordId}
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      required
                      minLength={8}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={submitting}
                      aria-describedby={error ? errorId : undefined}
                      className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3.5 pr-12 text-[15px] text-ink outline-none transition placeholder:text-slate-400 focus:border-teal focus:ring-2 focus:ring-teal/25 disabled:opacity-60"
                      placeholder="Mínimo 8 caracteres"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((current) => !current)}
                      disabled={submitting}
                      className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-ink-400 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal"
                      aria-label={showPassword ? "Ocultar palavra-passe" : "Mostrar palavra-passe"}
                      aria-pressed={showPassword}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>

              <div id={errorId} aria-live="polite" className="mt-4 min-h-0">
                {error && (
                  <AlertBanner tone="error" onDismiss={() => setError(null)}>
                    {error}
                  </AlertBanner>
                )}
              </div>

              <Button type="submit" size="lg" fullWidth loading={submitting} className="mt-5">
                {submitting ? "A criar conta..." : "Criar conta grátis"}
              </Button>
              <p className="mt-3 text-center text-[12px] text-ink-400">
                Ao criar conta, aceita ser contactado pela equipa SIGO sobre a sua avaliação gratuita.
              </p>
            </form>
          )}
        </motion.main>

        <motion.footer
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.12 }}
          className="mt-8 space-y-3 text-center"
        >
          <p className="text-[13.5px] text-ink-400">
            Já tem conta?{" "}
            <Link to="/login" className="font-semibold text-teal-700 hover:underline">
              Entrar
            </Link>
          </p>
          <Link
            to="/"
            className="text-[13.5px] font-semibold text-ink-400 transition-colors hover:text-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal"
          >
            ← Voltar ao site
          </Link>
        </motion.footer>
      </div>
    </div>
  );
}

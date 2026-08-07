import { useState } from "react";
import { Link } from "react-router-dom";
import { MenuIcon, XIcon } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { Logo } from "./brand/Logo";
import { Button } from "./ui/Button";

const links = [
  { label: "Produto", href: "#produto" },
  { label: "Funcionalidades", href: "#funcionalidades" },
  { label: "Perfis", href: "#perfis" },
  { label: "Planos", href: "#planos" },
  { label: "Perguntas", href: "#faq" },
];

export function LandingHeader() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const platformHref = user ? (user.role === "super_admin" ? "/admin" : "/painel") : "/login";

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-surface/85 backdrop-blur-md">
      <div className="mx-auto flex h-[72px] w-full max-w-[1500px] items-center gap-6 px-5 sm:px-8">
        <a href="#inicio" className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal" aria-label="SIGO — início">
          <Logo size={38} />
        </a>

        <nav aria-label="Secções" className="ml-4 hidden items-center gap-1 lg:flex">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="rounded-lg px-3 py-2 text-[13.5px] font-semibold text-ink-400 transition-colors hover:bg-white hover:text-teal-700"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto hidden items-center gap-2.5 sm:flex">
          <Link to={platformHref}>
            <Button variant="secondary">{user ? "Abrir plataforma" : "Entrar"}</Button>
          </Link>
          {!user && (
            <Link to="/registar">
              <Button>Criar conta grátis</Button>
            </Link>
          )}
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Fechar menu" : "Abrir menu"}
          aria-expanded={open}
          className="ml-auto rounded-xl border border-slate-200 bg-white p-2.5 text-ink sm:hidden"
        >
          {open ? <XIcon className="h-4 w-4" /> : <MenuIcon className="h-4 w-4" />}
        </button>
      </div>

      {open && (
        <div className="border-t border-slate-200 bg-white px-5 py-4 sm:hidden">
          <nav aria-label="Secções" className="flex flex-col">
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="border-b border-slate-100 py-3 text-sm font-semibold text-ink"
              >
                {l.label}
              </a>
            ))}
          </nav>
          <div className="mt-4 flex flex-col gap-2">
            <Link to={platformHref} onClick={() => setOpen(false)}>
              <Button variant="secondary" fullWidth>
                {user ? "Abrir plataforma" : "Entrar"}
              </Button>
            </Link>
            {!user && (
              <Link to="/registar" onClick={() => setOpen(false)}>
                <Button fullWidth>Criar conta grátis</Button>
              </Link>
            )}
          </div>
        </div>
      )}
    </header>
  );
}

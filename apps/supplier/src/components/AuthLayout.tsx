import { type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Logo } from "./Logo";

type AuthLayoutProps = {
  eyebrow: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function AuthLayout({ eyebrow, children, footer }: AuthLayoutProps) {
  return (
    <div className="auth-screen">
      <div className="sigo-grid" aria-hidden="true" />
      <div className="auth-glow" aria-hidden="true" />

      <div className="auth-frame">
        <header className="auth-header fade-up">
          <a href="/" className="auth-logo-link" aria-label="SIGO — site principal">
            <Logo size={56} />
          </a>
          <p className="auth-eyebrow">{eyebrow}</p>
        </header>

        <main className="auth-main fade-up delay-1">{children}</main>

        {footer && <footer className="auth-footer fade-up delay-2">{footer}</footer>}

        <p className="auth-legal fade-up delay-2">
          <Link to="/login">Portal do Fornecedor</Link>
          <span aria-hidden="true"> · </span>
          <a href="/">SIGO</a>
        </p>
      </div>
    </div>
  );
}

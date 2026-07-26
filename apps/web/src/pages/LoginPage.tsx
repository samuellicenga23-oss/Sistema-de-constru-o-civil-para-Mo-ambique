import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth, ApiError } from "../auth/AuthContext";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Painel de marca */}
      <div className="hidden lg:flex flex-col justify-between bg-gradient-to-br from-brand-900 via-brand-950 to-black text-white p-12">
        <p className="text-2xl font-bold tracking-tight">
          SIG<span className="text-brand-300">O</span>
        </p>
        <div>
          <h1 className="text-3xl font-bold leading-snug max-w-md">
            Da estimativa à entrega da obra.
          </h1>
          <ul className="mt-6 space-y-2 text-brand-200 text-sm">
            <li>• Mapas de quantidades com medições dimensionais (Nº × C × L × A)</li>
            <li>• Composições de custo completas: mão-de-obra, materiais e máquinas</li>
            <li>• Autos de medição da execução e exportação Excel/PDF</li>
            <li>• Leitura automática de plantas ArchiCAD</li>
          </ul>
        </div>
        <p className="text-xs text-brand-400">Moçambique · MZN & USD</p>
      </div>

      {/* Formulário */}
      <div className="flex items-center justify-center bg-gray-50 px-6">
        <div className="w-full max-w-sm">
          <div className="lg:hidden text-center mb-6">
            <p className="text-2xl font-bold text-brand-900">
              SIG<span className="text-brand-500">O</span>
            </p>
          </div>
          <div className="card card-pad">
            <h2 className="text-lg font-bold text-gray-900">Acesso restrito</h2>
            <p className="text-sm text-gray-500 mb-5">Entre com as credenciais da sua empresa.</p>

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
          </div>
        </div>
      </div>
    </div>
  );
}

import { useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";

export default function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("A nova password e a confirmação não coincidem");
      return;
    }
    setSaving(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erro ao mudar a password");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-gray-900/50 flex items-center justify-center p-4">
      <div className="card card-pad w-full max-w-sm">
        <h2 className="text-lg font-bold text-gray-900 mb-1">Mudar palavra-passe</h2>
        {done ? (
          <>
            <p className="text-sm text-gray-600 mb-4">
              Palavra-passe actualizada. As restantes sessões desta conta noutros dispositivos foram terminadas.
            </p>
            <button onClick={onClose} className="btn btn-primary w-full">
              Fechar
            </button>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <p className="text-sm text-gray-500 mb-2">Isto termina qualquer outra sessão activa desta conta.</p>
            <div>
              <label className="label">Palavra-passe actual</label>
              <input required type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="input" />
            </div>
            <div>
              <label className="label">Nova palavra-passe (mín. 8 caracteres)</label>
              <input required minLength={8} type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="input" />
            </div>
            <div>
              <label className="label">Confirmar nova palavra-passe</label>
              <input required minLength={8} type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="input" />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2 pt-2">
              <button type="button" onClick={onClose} className="btn btn-secondary flex-1">
                Cancelar
              </button>
              <button type="submit" disabled={saving} className="btn btn-primary flex-1">
                {saving ? "A guardar..." : "Guardar"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

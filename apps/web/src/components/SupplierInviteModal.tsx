import { useState, type FormEvent } from "react";
import Modal from "./Modal";
import { quoteRequestsApi } from "../api/quoteRequests";
import type { Supplier } from "../api/suppliers";

export default function SupplierInviteModal({ supplier, onClose, onInvited }: { supplier: Supplier; onClose: () => void; onInvited: () => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState(supplier.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ alreadyActive: boolean } | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await quoteRequestsApi.inviteSupplier(supplier.id, { email: email.trim(), name: name.trim() || undefined });
      setResult({ alreadyActive: res.alreadyActive });
      onInvited();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao convidar fornecedor");
    } finally {
      setSaving(false);
    }
  }

  if (result) {
    return (
      <Modal title="Fornecedor ligado ao Portal" onClose={onClose}>
        <p className="text-sm text-slate-700">
          {result.alreadyActive
            ? `«${email}» já tem conta no Portal do Fornecedor — foi ligado a este fornecedor e já pode receber pedidos de cotação.`
            : `Enviámos um convite por email para «${email}» com um link para definir a palavra-passe e aceder ao Portal do Fornecedor.`}
        </p>
        <div className="mt-5 flex justify-end">
          <button onClick={onClose} className="btn btn-primary">Fechar</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Convidar para o Portal do Fornecedor" subtitle={`«${supplier.name}» vai poder ver e responder aos seus pedidos de cotação`} onClose={onClose}>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="label">Email do fornecedor</label>
          <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input" placeholder="fornecedor@exemplo.com" />
        </div>
        <div>
          <label className="label">Nome do contacto/empresa</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className="input" />
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="btn btn-secondary">Cancelar</button>
          <button type="submit" disabled={saving} className="btn btn-primary">{saving ? "A enviar..." : "Enviar convite"}</button>
        </div>
      </form>
    </Modal>
  );
}

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import Modal from "./Modal";
import { IconPlus } from "./icons";
import {
  COMMERCIAL_TEXT_LIBRARY,
  PRICING_MODE_LABELS,
  SERVICE_TYPES,
  defaultConditions,
  getServiceType,
  getTemplateLines,
  type ServiceCategory,
} from "../comercial/proposalTemplates";
import { practiceApi, type PracticeBudgetSource, type PracticeClient } from "../api/practice";

type LineDraft = {
  phase: string;
  specialty: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  included: boolean;
  optional: boolean;
};

const STEPS = ["Cliente", "Serviço", "Projecto", "Escopo", "Honorários", "Condições", "PDF"];

function money(value: number, currency = "MZN") {
  return `${value.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

export default function ProposalWizard({
  clients,
  initialClient,
  onClose,
  onCreated,
}: {
  clients: PracticeClient[];
  initialClient?: PracticeClient | null;
  onClose: () => void;
  onCreated: (quoteId: string, clientId: string | null) => void;
}) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [clientId, setClientId] = useState(initialClient?.id ?? "");
  const [clientName, setClientName] = useState(initialClient?.name ?? "");
  const [serviceType, setServiceType] = useState("arquitectura");
  const service = getServiceType(serviceType);
  const [title, setTitle] = useState(service?.suggestedTitle ?? "");
  const [pricingMode, setPricingMode] = useState(service?.pricingModes[0] ?? "por_fase");

  const [projectDesignation, setProjectDesignation] = useState("");
  const [workType, setWorkType] = useState("");
  const [location, setLocation] = useState("");
  const [ownerName, setOwnerName] = useState(initialClient?.name ?? "");
  const [estimatedArea, setEstimatedArea] = useState("");
  const [floors, setFloors] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [observations, setObservations] = useState("");
  const [plannedStartDate, setPlannedStartDate] = useState("");
  const [clientDeadline, setClientDeadline] = useState("");
  const [sourceBudgetDocumentId, setSourceBudgetDocumentId] = useState("");
  const [budgetSources, setBudgetSources] = useState<PracticeBudgetSource[]>([]);
  const [budgetAttachMode, setBudgetAttachMode] = useState<"nada" | "resumo" | "mapa">("resumo");

  const [lines, setLines] = useState<LineDraft[]>(() =>
    getTemplateLines("arquitectura").map((row) => ({
      phase: row.phase,
      specialty: row.specialty ?? "",
      description: row.description,
      quantity: 1,
      unit: row.unit ?? "vb",
      unitPrice: 0,
      included: !row.optional,
      optional: Boolean(row.optional),
    })),
  );

  const [validUntil, setValidUntil] = useState(() => new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10));
  const [conditions, setConditions] = useState(() => defaultConditions("arquitectura"));
  const [notes, setNotes] = useState("");

  const total = useMemo(
    () => lines.reduce((sum, line) => sum + (line.included ? line.quantity * line.unitPrice : 0), 0),
    [lines],
  );

  const byCategory = useMemo(() => {
    const map: Record<ServiceCategory, typeof SERVICE_TYPES> = { project: [], technical: [], construction: [] };
    for (const item of SERVICE_TYPES) map[item.category].push(item);
    return map;
  }, []);

  useEffect(() => {
    if (service?.category !== "construction") return;
    practiceApi
      .listBudgetSources()
      .then(setBudgetSources)
      .catch(() => setBudgetSources([]));
  }, [service?.category]);

  function applyService(id: string) {
    const def = getServiceType(id);
    setServiceType(id);
    if (def) {
      setTitle(def.suggestedTitle);
      setPricingMode(def.pricingModes[0] ?? "por_fase");
      setConditions(defaultConditions(id));
    }
    setLines(
      getTemplateLines(id).map((row) => ({
        phase: row.phase,
        specialty: row.specialty ?? "",
        description: row.description,
        quantity: 1,
        unit: row.unit ?? "vb",
        unitPrice: 0,
        included: !row.optional,
        optional: Boolean(row.optional),
      })),
    );
    setSourceBudgetDocumentId("");
  }

  function canNext() {
    if (step === 0) return Boolean(clientName.trim());
    if (step === 1) {
      if (service?.category === "construction") return Boolean(sourceBudgetDocumentId);
      return Boolean(serviceType);
    }
    if (service?.category === "construction" && (step === 3 || step === 4)) return true;
    if (step === 3) return lines.some((line) => line.included && line.description.trim());
    if (step === 4) return total > 0;
    return true;
  }

  function selectBudgetSource(id: string) {
    setSourceBudgetDocumentId(id);
    const source = budgetSources.find((row) => row.id === id);
    if (!source) return;
    setTitle(`Proposta de execução — ${source.projectName}`);
    setProjectDesignation(source.projectName);
    if (source.location) setLocation(source.location);
    if (source.client) {
      setOwnerName(source.client);
      if (!clientName.trim()) setClientName(source.client);
    }
  }

  function goNext() {
    if (!canNext()) return;
    if (service?.category === "construction" && step === 2) {
      setStep(5);
      return;
    }
    if (service?.category === "construction" && step === 1) {
      setStep(2);
      return;
    }
    setStep(step + 1);
  }

  function goPrev() {
    if (service?.category === "construction" && step === 5) {
      setStep(2);
      return;
    }
    setStep(Math.max(0, step - 1));
  }

  async function handleSubmit(e?: FormEvent) {
    e?.preventDefault();
    if (step !== STEPS.length - 1) return;
    setError(null);
    setBusy(true);
    try {
      if (service?.category === "construction") {
        if (!sourceBudgetDocumentId) throw new Error("Execução de obra exige medição/orçamento associado.");
        const created = await practiceApi.createQuoteFromBudget({
          documentId: sourceBudgetDocumentId,
          attachMode: budgetAttachMode,
          assignNumber: true,
          clientId: clientId || null,
          clientName: clientName.trim() || undefined,
          title: title.trim() || undefined,
          validUntil: validUntil || null,
          notes: notes.trim() || null,
          projectDesignation: projectDesignation.trim() || null,
          workType: workType.trim() || null,
          location: location.trim() || null,
          ownerName: ownerName.trim() || null,
          projectDescription: projectDescription.trim() || null,
          observations: observations.trim() || null,
          plannedStartDate: plannedStartDate || null,
          clientDeadline: clientDeadline.trim() || null,
          conditions,
        });
        onCreated(created.id, clientId || created.clientId);
        return;
      }
      const includedLines = lines.filter((line) => line.included && line.description.trim());
      if (!includedLines.length) throw new Error("Inclua pelo menos um item no escopo");
      if (includedLines.every((line) => line.unitPrice <= 0)) {
        throw new Error("Indique o valor dos honorários nas linhas incluídas");
      }
      const created = await practiceApi.createQuote({
        title: title.trim(),
        clientName: clientName.trim(),
        clientId: clientId || null,
        issueDate: new Date().toISOString().slice(0, 10),
        validUntil: validUntil || undefined,
        notes: notes.trim() || undefined,
        serviceCategory: service?.category,
        serviceType,
        pricingMode,
        projectDesignation: projectDesignation.trim() || null,
        workType: workType.trim() || null,
        location: location.trim() || null,
        ownerName: ownerName.trim() || null,
        estimatedArea: estimatedArea.trim() || null,
        floors: floors.trim() || null,
        projectDescription: projectDescription.trim() || null,
        observations: observations.trim() || null,
        plannedStartDate: plannedStartDate || null,
        clientDeadline: clientDeadline.trim() || null,
        sourceBudgetDocumentId: sourceBudgetDocumentId || null,
        conditions,
        lines: includedLines.map((line) => ({
          description: line.description,
          quantity: line.quantity,
          unit: line.unit,
          unitPrice: line.unitPrice,
          phase: line.phase || undefined,
          specialty: line.specialty || undefined,
          included: line.included,
          optional: line.optional,
        })),
      });
      onCreated(created.id, clientId || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar proposta");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Nova proposta comercial" subtitle={`Passo ${step + 1} de ${STEPS.length} — ${STEPS[step]}`} onClose={onClose} maxWidth="max-w-4xl">
      <div className="mb-4 flex flex-wrap gap-1.5">
        {STEPS.map((label, index) => (
          <button
            key={label}
            type="button"
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${index === step ? "bg-brand-500 text-white" : index < step ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"}`}
            onClick={() => index <= step && setStep(index)}
          >
            {index + 1}. {label}
          </button>
        ))}
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <form className="space-y-4" onSubmit={handleSubmit}>
        {step === 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Cliente registado</label>
              <select
                className="input"
                value={clientId}
                onChange={(e) => {
                  setClientId(e.target.value);
                  const client = clients.find((c) => c.id === e.target.value);
                  if (client) {
                    setClientName(client.name);
                    setOwnerName(client.name);
                  }
                }}
              >
                <option value="">— Novo / avulso —</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Nome do cliente *</label>
              <input className="input" required value={clientName} onChange={(e) => setClientName(e.target.value)} disabled={!!clientId} />
            </div>
            {clientId && (
              <div className="sm:col-span-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                {[clients.find((c) => c.id === clientId)?.phone, clients.find((c) => c.id === clientId)?.email, clients.find((c) => c.id === clientId)?.nuit && `NUIT ${clients.find((c) => c.id === clientId)?.nuit}`, clients.find((c) => c.id === clientId)?.address]
                  .filter(Boolean)
                  .join(" · ") || "Sem contactos adicionais"}
              </div>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            {(
              [
                ["project", "Projectos"],
                ["technical", "Serviços técnicos"],
                ["construction", "Construção / Execução"],
              ] as const
            ).map(([cat, label]) => (
              <div key={cat}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {byCategory[cat].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`rounded-xl border px-3 py-2.5 text-left text-sm ${serviceType === item.id ? "border-brand-500 bg-brand-50 ring-1 ring-brand-200" : "border-slate-200 hover:bg-slate-50"}`}
                      onClick={() => applyService(item.id)}
                    >
                      <span className="font-medium text-slate-900">{item.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {service?.category === "construction" && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
                <p className="font-semibold">Execução de obra exige Medição e Orçamento</p>
                <p className="mt-1 text-xs leading-5">
                  Não é permitido indicar um preço global manual. Seleccione um documento aprovado — o Comercial não recalcula quantidades.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link to="/medicoes" className="btn btn-secondary btn-sm" onClick={onClose}>
                    Abrir Medições
                  </Link>
                  <Link to="/orcamentos" className="btn btn-secondary btn-sm" onClick={onClose}>
                    Abrir Orçamentos
                  </Link>
                </div>
                <label className="label mt-3">Documento aprovado</label>
                <select
                  className="input"
                  value={sourceBudgetDocumentId}
                  onChange={(e) => selectBudgetSource(e.target.value)}
                >
                  <option value="">— Seleccionar medição/orçamento —</option>
                  {budgetSources.map((row) => (
                    <option key={row.id} value={row.id}>
                      [{row.documentType}] {row.projectName} — {row.title}
                      {row.fileNumber ? ` (${row.fileNumber})` : ""}
                    </option>
                  ))}
                </select>
                {!budgetSources.length && (
                  <p className="mt-2 text-xs text-amber-800">Não há documentos aprovados. Aprove uma medição/orçamento primeiro.</p>
                )}
                <label className="label mt-3">Anexar ao escopo</label>
                <select
                  className="input"
                  value={budgetAttachMode}
                  onChange={(e) => setBudgetAttachMode(e.target.value as "nada" | "resumo" | "mapa")}
                >
                  <option value="nada">Nada — total global</option>
                  <option value="resumo">Resumo por capítulos</option>
                  <option value="mapa">Mapa completo</option>
                </select>
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label">Título da proposta</label>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <label className="label">Designação do projecto</label>
              <input className="input" value={projectDesignation} onChange={(e) => setProjectDesignation(e.target.value)} />
            </div>
            <div>
              <label className="label">Tipo de obra</label>
              <input className="input" value={workType} onChange={(e) => setWorkType(e.target.value)} placeholder="Habitação, comércio…" />
            </div>
            <div>
              <label className="label">Localização</label>
              <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} />
            </div>
            <div>
              <label className="label">Dono da obra</label>
              <input className="input" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
            </div>
            <div>
              <label className="label">Área estimada</label>
              <input className="input" value={estimatedArea} onChange={(e) => setEstimatedArea(e.target.value)} />
            </div>
            <div>
              <label className="label">Nº de pisos</label>
              <input className="input" value={floors} onChange={(e) => setFloors(e.target.value)} />
            </div>
            <div>
              <label className="label">Início previsto</label>
              <input className="input" type="date" value={plannedStartDate} onChange={(e) => setPlannedStartDate(e.target.value)} />
            </div>
            <div>
              <label className="label">Prazo pretendido pelo cliente</label>
              <input className="input" value={clientDeadline} onChange={(e) => setClientDeadline(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Descrição</label>
              <textarea className="input min-h-[72px]" value={projectDescription} onChange={(e) => setProjectDescription(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Observações</label>
              <textarea className="input min-h-[56px]" value={observations} onChange={(e) => setObservations(e.target.value)} />
            </div>
          </div>
        )}

        {step === 3 && service?.category === "construction" && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            <p className="font-semibold text-slate-900">Escopo a partir do orçamento</p>
            <p className="mt-1 text-xs leading-5">
              Ao criar a proposta, o escopo será importado do documento seleccionado (modo «{budgetAttachMode}»).
              O Comercial não recalcula quantidades.
            </p>
          </div>
        )}

        {step === 3 && service?.category !== "construction" && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-slate-500">Inclua/exclua itens. Opcionais começam desmarcados.</p>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() =>
                  setLines([
                    ...lines,
                    { phase: "", specialty: "", description: "", quantity: 1, unit: "vb", unitPrice: 0, included: true, optional: false },
                  ])
                }
              >
                <IconPlus className="h-3.5 w-3.5" /> Item
              </button>
            </div>
            <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
              {lines.map((line, index) => (
                <div key={index} className={`grid gap-2 rounded-lg border p-2 sm:grid-cols-[auto_7rem_1fr_5.5rem] ${line.included ? "border-slate-200" : "border-slate-100 bg-slate-50 opacity-70"}`}>
                  <label className="flex items-center gap-2 text-xs font-medium">
                    <input
                      type="checkbox"
                      checked={line.included}
                      onChange={(e) => setLines(lines.map((row, i) => (i === index ? { ...row, included: e.target.checked } : row)))}
                    />
                    Incluir
                  </label>
                  <input
                    className="input"
                    placeholder="Fase"
                    value={line.phase}
                    onChange={(e) => setLines(lines.map((row, i) => (i === index ? { ...row, phase: e.target.value } : row)))}
                  />
                  <input
                    className="input"
                    placeholder="Descrição"
                    value={line.description}
                    onChange={(e) => setLines(lines.map((row, i) => (i === index ? { ...row, description: e.target.value } : row)))}
                  />
                  <input
                    className="input"
                    placeholder="Especialidade"
                    value={line.specialty}
                    onChange={(e) => setLines(lines.map((row, i) => (i === index ? { ...row, specialty: e.target.value } : row)))}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {step === 4 && service?.category === "construction" && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            <p className="font-semibold text-slate-900">Honorários / preço de execução</p>
            <p className="mt-1 text-xs leading-5">
              O valor nasce do orçamento/medição aprovado. Não é possível definir um preço global arbitrário neste assistente.
            </p>
          </div>
        )}

        {step === 4 && service?.category !== "construction" && (
          <div className="space-y-3">
            <div>
              <label className="label">Modo de preço</label>
              <select className="input" value={pricingMode} onChange={(e) => setPricingMode(e.target.value)}>
                {(service?.pricingModes ?? Object.keys(PRICING_MODE_LABELS)).map((mode) => (
                  <option key={mode} value={mode}>
                    {PRICING_MODE_LABELS[mode] ?? mode}
                  </option>
                ))}
              </select>
            </div>
            <div className="max-h-[45vh] space-y-2 overflow-y-auto">
              {lines
                .filter((line) => line.included)
                .map((line) => {
                  const index = lines.indexOf(line);
                  return (
                    <div key={index} className="grid grid-cols-[1fr_4.5rem_3.5rem_7rem] gap-2">
                      <div className="truncate text-sm text-slate-800" title={line.description}>
                        <span className="text-xs text-slate-500">{line.phase || line.specialty} · </span>
                        {line.description}
                      </div>
                      <input
                        className="input"
                        type="number"
                        min={0}
                        step="0.001"
                        value={line.quantity}
                        onChange={(e) => setLines(lines.map((row, i) => (i === index ? { ...row, quantity: Number(e.target.value) } : row)))}
                      />
                      <input
                        className="input"
                        value={line.unit}
                        onChange={(e) => setLines(lines.map((row, i) => (i === index ? { ...row, unit: e.target.value } : row)))}
                      />
                      <input
                        className="input"
                        type="number"
                        min={0}
                        step="0.01"
                        value={line.unitPrice}
                        onChange={(e) => setLines(lines.map((row, i) => (i === index ? { ...row, unitPrice: Number(e.target.value) } : row)))}
                      />
                    </div>
                  );
                })}
            </div>
            <p className="text-sm font-semibold">Total: {money(total)}</p>
          </div>
        )}

        {step === 5 && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Válida até</label>
              <input className="input" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
            </div>
            <div>
              <label className="label">Revisões incluídas</label>
              <input
                className="input"
                type="number"
                min={0}
                value={conditions.revisionsIncluded ?? 2}
                onChange={(e) => setConditions({ ...conditions, revisionsIncluded: Number(e.target.value) })}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Introdução</label>
              <textarea className="input min-h-[72px]" value={conditions.intro ?? ""} onChange={(e) => setConditions({ ...conditions, intro: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Condições de pagamento</label>
              <textarea className="input min-h-[56px]" value={conditions.paymentTerms ?? ""} onChange={(e) => setConditions({ ...conditions, paymentTerms: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Exclusões / serviços adicionais</label>
              <textarea className="input min-h-[56px]" value={conditions.exclusions ?? ""} onChange={(e) => setConditions({ ...conditions, exclusions: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Notas / condições comerciais</label>
              <textarea className="input min-h-[88px]" value={conditions.additionalNotes ?? ""} onChange={(e) => setConditions({ ...conditions, additionalNotes: e.target.value })} />
              <button
                type="button"
                className="btn btn-secondary btn-sm mt-2"
                onClick={() =>
                  setConditions({
                    ...conditions,
                    additionalNotes: [COMMERCIAL_TEXT_LIBRARY.alteracoes, COMMERCIAL_TEXT_LIBRARY.informacoesCliente, COMMERCIAL_TEXT_LIBRARY.revisoes, COMMERCIAL_TEXT_LIBRARY.inicio].join("\n\n"),
                  })
                }
              >
                Restaurar textos da biblioteca
              </button>
            </div>
            <div className="sm:col-span-2">
              <label className="label">Observações livres</label>
              <textarea className="input min-h-[56px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
        )}

        {step === 6 && (
          <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
            <p className="font-semibold text-slate-900">{title}</p>
            <p className="text-slate-600">
              {clientName} · {service?.label}
              {service?.category === "construction"
                ? ` · anexo «${budgetAttachMode}» do orçamento`
                : ` · ${money(total)}`}
            </p>
            <p className="text-xs text-slate-500">
              Ao guardar, a proposta fica em rascunho com número PRO. O PDF usa o logótipo e os meios de pagamento da empresa.
            </p>
            <ul className="list-disc space-y-1 pl-5 text-xs text-slate-600">
              {service?.category === "construction" ? (
                <li>Escopo e valores importados do documento aprovado (sem recalcular quantidades)</li>
              ) : (
                <li>{lines.filter((l) => l.included).length} itens incluídos no escopo</li>
              )}
              <li>Validade: {validUntil || "—"}</li>
              <li>Projecto: {projectDesignation || "não indicado"}</li>
            </ul>
          </div>
        )}

        <div className="flex flex-wrap justify-between gap-2 border-t border-slate-100 pt-4">
          <button type="button" className="btn btn-secondary" onClick={step === 0 ? onClose : goPrev}>
            {step === 0 ? "Cancelar" : "Anterior"}
          </button>
          {step < STEPS.length - 1 ? (
            <button type="button" className="btn btn-primary" disabled={!canNext()} onClick={goNext}>
              Seguinte
            </button>
          ) : (
            <button type="submit" className="btn btn-primary" disabled={busy || !canNext()}>
              {busy ? "A guardar…" : "Guardar proposta"}
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { catalogApi, type CostComposition, type WorkChapter, type WorkChapterInput } from "../api/catalog";
import { useAuth } from "../auth/AuthContext";
import Modal from "./Modal";
import { IconPlus, IconTrash } from "./icons";

const DISCIPLINES: Array<[WorkChapter["discipline"], string]> = [
  ["all", "Todos os projectos"],
  ["arquitectura", "Arquitectura"],
  ["estrutura", "Estrutura"],
  ["hidrossanitario", "Hidrossanitário"],
  ["electricidade", "Electricidade"],
  ["outro", "Outra disciplina"],
];
const UNITS = ["m", "m2", "m3", "ml", "kg", "un", "vg", "h"];

type DraftItem = { code: string; description: string; unit: string; compositionId: string };
type Draft = { originalCode: string | null; code: string; name: string; discipline: WorkChapter["discipline"]; tags: string; requiresTagMatch: boolean; items: DraftItem[] };

function emptyDraft(): Draft {
  return { originalCode: null, code: "", name: "", discipline: "outro", tags: "", requiresTagMatch: true, items: [{ code: "", description: "", unit: "un", compositionId: "" }] };
}

export default function WorkChapterLibrary({ compositions, onCount, onError, onSaved }: {
  compositions: CostComposition[];
  onCount?: (count: number) => void;
  onError: (message: string) => void;
  onSaved: (message: string) => void;
}) {
  const { user } = useAuth();
  const [chapters, setChapters] = useState<WorkChapter[]>([]);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  async function reload() {
    const rows = await catalogApi.listWorkChapters();
    setChapters(rows);
    onCount?.(rows.length);
  }

  useEffect(() => { reload().catch((error) => onError(error.message)); }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("pt");
    if (!needle) return chapters;
    return chapters.filter((chapter) => `${chapter.code} ${chapter.name} ${chapter.discipline} ${chapter.detectionTags.join(" ")} ${chapter.items.map((item) => item.description).join(" ")}`.toLocaleLowerCase("pt").includes(needle));
  }, [chapters, query]);

  function edit(chapter: WorkChapter) {
    setDraft({
      originalCode: chapter.code,
      code: chapter.code,
      name: chapter.name,
      discipline: chapter.discipline,
      tags: chapter.detectionTags.join(", "),
      requiresTagMatch: chapter.requiresTagMatch,
      items: chapter.items.map((item) => ({
        code: item.code,
        description: item.description,
        unit: item.unit,
        compositionId: item.compositionId ?? compositions.find((composition) => composition.name === item.composition)?.id ?? "",
      })),
    });
  }

  function updateItem(index: number, patch: Partial<DraftItem>) {
    setDraft((current) => current ? { ...current, items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) } : current);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setSaving(true);
    try {
      const input: WorkChapterInput = {
        code: draft.code.trim(),
        name: draft.name.trim(),
        discipline: draft.discipline,
        detectionTags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        requiresTagMatch: draft.requiresTagMatch,
        items: draft.items.map((item) => ({
          code: item.code.trim(),
          description: item.description.trim(),
          unit: item.unit,
          compositionId: item.compositionId || null,
        })),
      };
      if (draft.originalCode) await catalogApi.updateWorkChapter(draft.originalCode, input);
      else await catalogApi.createWorkChapter(input);
      setDraft(null);
      await reload();
      onSaved(draft.originalCode ? "Capítulo actualizado." : "Capítulo criado e disponível para novas medições.");
    } catch (error) {
      onError(error instanceof Error ? error.message : "Não foi possível guardar o capítulo");
    } finally {
      setSaving(false);
    }
  }

  async function remove(chapter: WorkChapter) {
    try {
      await catalogApi.deleteWorkChapter(chapter.code);
      await reload();
      onSaved("Capítulo próprio removido.");
    } catch (error) {
      onError(error instanceof Error ? error.message : "Não foi possível remover o capítulo");
    }
  }

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pesquisar capítulo, item ou disciplina..." className="input max-w-sm" />
        <button type="button" onClick={() => setDraft(emptyDraft())} className="btn btn-primary btn-sm"><IconPlus className="h-3.5 w-3.5" /> Novo capítulo</button>
      </div>
      <div className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-x 2xl:grid-cols-3">
        {filtered.map((chapter) => {
          const own = user?.role === "super_admin" ? chapter.companyId === null : chapter.companyId === user?.companyId;
          return <article key={chapter.code} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><span className="font-mono text-xs font-bold text-brand-700">{chapter.code}</span><strong className="mt-1 block text-sm text-slate-950">{chapter.name}</strong></div>
              <span className={`badge ${own ? "badge-brand" : "badge-gray"}`}>{own ? "Empresa" : "SIGO"}</span>
            </div>
            <p className="mt-2 text-xs text-slate-500">{DISCIPLINES.find(([value]) => value === chapter.discipline)?.[1]} · {chapter.items.length} item(ns)</p>
            <div className="mt-3 flex flex-wrap gap-1">{chapter.detectionTags.slice(0, 4).map((tag) => <span key={tag} className="rounded bg-slate-100 px-2 py-1 text-[10px] text-slate-600">{tag}</span>)}</div>
            <div className="mt-4 flex gap-2 border-t border-slate-100 pt-3"><button type="button" onClick={() => edit(chapter)} className="btn btn-secondary btn-sm flex-1">{own ? "Editar" : "Personalizar"}</button>{own && <button type="button" onClick={() => remove(chapter)} className="btn btn-danger btn-sm"><IconTrash className="h-3.5 w-3.5" /></button>}</div>
          </article>;
        })}
        {!filtered.length && <p className="p-6 text-sm text-slate-500">Nenhum capítulo encontrado.</p>}
      </div>

      {draft && <Modal title={draft.originalCode ? "Editar capítulo" : "Novo capítulo"} subtitle="Os itens entram automaticamente nas medições da disciplina escolhida" onClose={() => setDraft(null)}>
        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[120px_1fr]"><div><label className="label">Código</label><input required disabled={!!draft.originalCode} value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value })} className="input" /></div><div><label className="label">Nome</label><input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className="input" /></div></div>
          <div className="grid gap-3 sm:grid-cols-2"><div><label className="label">Disciplina</label><select value={draft.discipline} onChange={(event) => setDraft({ ...draft, discipline: event.target.value as WorkChapter["discipline"] })} className="input">{DISCIPLINES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div><label className="label">Palavras de detecção</label><input value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} placeholder="ex: incêndio, extintor, hidrante" className="input" /><label className="mt-2 flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={draft.requiresTagMatch} onChange={(event) => setDraft({ ...draft, requiresTagMatch: event.target.checked })} /> Incluir apenas quando uma destas palavras aparecer na planta</label></div></div>
          <div className="space-y-2"><div className="flex items-center justify-between"><label className="label !mb-0">Itens do capítulo</label><button type="button" onClick={() => setDraft({ ...draft, items: [...draft.items, { code: "", description: "", unit: "un", compositionId: "" }] })} className="btn btn-secondary btn-sm"><IconPlus className="h-3.5 w-3.5" /> Item</button></div>{draft.items.map((item, index) => <div key={index} className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-[90px_1fr_80px_1fr_auto]"><input required value={item.code} onChange={(event) => updateItem(index, { code: event.target.value })} placeholder="14.1" className="input input-sm" /><input required value={item.description} onChange={(event) => updateItem(index, { description: event.target.value })} placeholder="Descrição do trabalho" className="input input-sm" /><select value={item.unit} onChange={(event) => updateItem(index, { unit: event.target.value })} className="input input-sm">{UNITS.map((unit) => <option key={unit}>{unit}</option>)}</select><select value={item.compositionId} onChange={(event) => updateItem(index, { compositionId: event.target.value })} className="input input-sm"><option value="">Preço por definir</option>{compositions.map((composition) => <option key={composition.id} value={composition.id}>{composition.name}</option>)}</select><button type="button" disabled={draft.items.length === 1} onClick={() => setDraft({ ...draft, items: draft.items.filter((_, itemIndex) => itemIndex !== index) })} className="btn btn-ghost btn-sm"><IconTrash className="h-3.5 w-3.5" /></button></div>)}</div>
          <div className="flex justify-end gap-2 border-t border-slate-200 pt-4"><button type="button" onClick={() => setDraft(null)} className="btn btn-secondary">Cancelar</button><button type="submit" disabled={saving} className="btn btn-primary">{saving ? "A guardar..." : "Guardar capítulo"}</button></div>
        </form>
      </Modal>}
    </section>
  );
}

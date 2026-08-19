import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyBoqEditOperations,
  createBoqEditHistory,
  type BoqEditItemFields,
  type BoqEditOperation,
  type BoqEditSection,
} from "@sigo/shared";
import { boqApi, type BudgetDocumentSummary, type SectionNode } from "../api/boq";
import { ApiError } from "../api/http";
import type { BoqLineMutations } from "../components/LineItemRow";
import { resolveBoqHistoryShortcut } from "../utils/boqEditShortcuts";

function newId() {
  return crypto.randomUUID();
}

function asSections(sections: SectionNode[]): BoqEditSection[] {
  return sections as BoqEditSection[];
}

export function useBoqEditSession(input: {
  documentId: string | undefined;
  summary: BudgetDocumentSummary | null;
  enabled: boolean;
  onSaved: (summary: BudgetDocumentSummary) => void;
  onReload: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sections, setSections] = useState<SectionNode[] | null>(null);
  const [changeCount, setChangeCount] = useState(0);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const historyRef = useRef(createBoqEditHistory());
  const baseFingerprintRef = useRef<string | null>(null);
  const baseSectionsRef = useRef<SectionNode[] | null>(null);

  const syncFlags = useCallback(() => {
    const history = historyRef.current;
    setChangeCount(history.changeCount);
    setCanUndo(history.canUndo);
    setCanRedo(history.canRedo);
  }, []);

  const replay = useCallback((operations: BoqEditOperation[]) => {
    const base = baseSectionsRef.current;
    if (!base) return;
    setSections(applyBoqEditOperations(asSections(base), operations) as SectionNode[]);
  }, []);

  const { documentId, summary, enabled, onSaved, onReload, onError } = input;

  const begin = useCallback(() => {
    if (!summary || !enabled) return;
    historyRef.current.reset();
    baseFingerprintRef.current = summary.editFingerprint;
    baseSectionsRef.current = summary.sections;
    setSections(summary.sections);
    setEditing(true);
    syncFlags();
  }, [enabled, summary, syncFlags]);

  const push = useCallback((operation: BoqEditOperation | BoqEditOperation[]) => {
    historyRef.current.push(operation);
    replay(historyRef.current.operations);
    syncFlags();
  }, [replay, syncFlags]);

  const undo = useCallback(() => {
    replay(historyRef.current.undo());
    syncFlags();
  }, [replay, syncFlags]);

  const redo = useCallback(() => {
    replay(historyRef.current.redo());
    syncFlags();
  }, [replay, syncFlags]);

  const discard = useCallback(async () => {
    historyRef.current.reset();
    setEditing(false);
    setSections(null);
    baseFingerprintRef.current = null;
    baseSectionsRef.current = null;
    syncFlags();
    onError(null);
    await onReload();
  }, [onError, onReload, syncFlags]);

  const save = useCallback(async () => {
    if (!documentId || !baseFingerprintRef.current) return;
    const operations = historyRef.current.operations;
    if (operations.length === 0) {
      setEditing(false);
      setSections(null);
      return;
    }
    setSaving(true);
    onError(null);
    try {
      const next = await boqApi.applyEditSession(documentId, {
        baseFingerprint: baseFingerprintRef.current,
        operations,
      });
      historyRef.current.reset();
      setEditing(false);
      setSections(null);
      baseFingerprintRef.current = null;
      baseSectionsRef.current = null;
      syncFlags();
      onSaved(next);
    } catch (err) {
      const message = err instanceof ApiError && err.status === 409
        ? (err.message || "Documento alterado. Recarregar")
        : err instanceof Error ? err.message : "Erro ao guardar";
      onError(message);
    } finally {
      setSaving(false);
    }
  }, [documentId, onError, onSaved, syncFlags]);

  useEffect(() => {
    if (!editing) return;
    function onKeyDown(event: KeyboardEvent) {
      const action = resolveBoqHistoryShortcut(event, historyRef.current);
      if (!action) return;
      event.preventDefault();
      if (action === "undo") undo();
      else redo();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editing, redo, undo]);

  const mutations: BoqLineMutations = useMemo(() => ({
    createItem: (sectionId, parentId, data) => {
      push({
        op: "add_item",
        id: newId(),
        sectionId,
        parentId,
        fields: {
          kind: data.kind,
          code: data.code ?? null,
          description: data.description,
          unit: data.unit ?? null,
          quantity: data.quantity ?? null,
          unitPrice: data.unitPrice ?? null,
          compositionId: data.compositionId ?? null,
        },
      });
    },
    updateItem: (id, data) => {
      const fields: BoqEditItemFields = {};
      if (data.description !== undefined) fields.description = data.description;
      if (data.technicalSpecification !== undefined) fields.technicalSpecification = data.technicalSpecification;
      if (data.quantity !== undefined) fields.quantity = data.quantity;
      if (data.compositionId !== undefined) fields.compositionId = data.compositionId;
      if (Object.keys(fields).length === 0) return;
      push({ op: "update_item", id, fields });
    },
    deleteItem: (id) => {
      push({ op: "delete_item", id });
    },
  }), [push]);

  const addSection = useCallback((name: string, sortOrder?: number) => {
    push({ op: "add_section", id: newId(), name, sortOrder });
  }, [push]);

  const renameSection = useCallback((id: string, name: string) => {
    push({ op: "rename_section", id, name });
  }, [push]);

  const deleteSection = useCallback((id: string) => {
    push({ op: "delete_section", id });
  }, [push]);

  return {
    editing,
    saving,
    changeCount,
    canUndo,
    canRedo,
    sections,
    begin,
    undo,
    redo,
    discard,
    save,
    mutations,
    addSection,
    renameSection,
    deleteSection,
  };
}

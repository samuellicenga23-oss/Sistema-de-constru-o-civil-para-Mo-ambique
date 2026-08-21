/**
 * Outbox offline para rascunhos de campo — Diário, observações e fotos.
 * Nunca enfileirar aprovações, pagamentos, adjudicações ou acções financeiras irreversíveis.
 */

export type OfflineOutboxKind = "diary_draft" | "observation_draft" | "photo_draft";

/** Tipos bloqueados em runtime — reforço além da tipagem estreita acima. */
const BLOCKED_KINDS = new Set([
  "approval",
  "payment",
  "adjudication",
  "fiscal_issue",
  "financial_action",
]);

export type OfflineOutboxItem = {
  id: string;
  kind: OfflineOutboxKind;
  projectId: string;
  payload: Record<string, unknown>;
  createdAt: string;
  idempotencyKey: string;
};

const DB_NAME = "sigo-offline-outbox";
const DB_VERSION = 1;
const STORE = "queue";
const LS_FALLBACK_KEY = "sigo-offline-outbox-v1";

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `offline-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB indisponível"));
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

async function idbGetAll(): Promise<OfflineOutboxItem[]> {
  const db = await openDb();
  if (!db) return lsGetAll();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result as OfflineOutboxItem[]) ?? []);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

async function idbPut(item: OfflineOutboxItem): Promise<void> {
  const db = await openDb();
  if (!db) {
    lsPut(item);
    return;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(item);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(id: string): Promise<boolean> {
  const db = await openDb();
  if (!db) return lsDelete(id);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve(true);
    };
    tx.onerror = () => reject(tx.error);
  });
}

function lsGetAll(): OfflineOutboxItem[] {
  try {
    const raw = window.localStorage.getItem(LS_FALLBACK_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as OfflineOutboxItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function lsSaveAll(items: OfflineOutboxItem[]): void {
  window.localStorage.setItem(LS_FALLBACK_KEY, JSON.stringify(items));
}

function lsPut(item: OfflineOutboxItem): void {
  const items = lsGetAll();
  const idx = items.findIndex((i) => i.id === item.id);
  if (idx >= 0) items[idx] = item;
  else items.push(item);
  lsSaveAll(items);
}

function lsDelete(id: string): boolean {
  const next = lsGetAll().filter((i) => i.id !== id);
  if (next.length === lsGetAll().length) return false;
  lsSaveAll(next);
  return true;
}

export type EnqueueInput = {
  kind: OfflineOutboxKind | string;
  projectId: string;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
};

export async function enqueueOfflineDraft(input: EnqueueInput): Promise<OfflineOutboxItem> {
  if (BLOCKED_KINDS.has(input.kind)) {
    throw new Error(`Tipo «${input.kind}» não permitido offline — use ligação activa.`);
  }
  const allowed: OfflineOutboxKind[] = ["diary_draft", "observation_draft", "photo_draft"];
  if (!allowed.includes(input.kind as OfflineOutboxKind)) {
    throw new Error(`Tipo «${input.kind}» desconhecido para outbox offline.`);
  }

  const item: OfflineOutboxItem = {
    id: newId(),
    kind: input.kind as OfflineOutboxKind,
    projectId: input.projectId,
    payload: input.payload,
    createdAt: new Date().toISOString(),
    idempotencyKey: input.idempotencyKey ?? newId(),
  };
  await idbPut(item);
  return item;
}

export async function listPendingOfflineDrafts(projectId?: string): Promise<OfflineOutboxItem[]> {
  const all = await idbGetAll();
  return projectId ? all.filter((i) => i.projectId === projectId) : all;
}

export async function dequeueOfflineDraft(id: string): Promise<boolean> {
  return idbDelete(id);
}

export async function clearOfflineOutbox(): Promise<void> {
  const db = await openDb();
  if (!db) {
    lsSaveAll([]);
    return;
  }
  const items = await idbGetAll();
  await Promise.all(items.map((i) => idbDelete(i.id)));
}

/** Stub de sincronização — integração API numa fase posterior. */
export async function flushOfflineOutboxOnOnline(): Promise<{ flushed: number; remaining: number }> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { flushed: 0, remaining: (await idbGetAll()).length };
  }
  const pending = await idbGetAll();
  // TODO(fase offline): enviar cada item à API com idempotencyKey; remover só após 2xx.
  void pending;
  return { flushed: 0, remaining: pending.length };
}

let onlineListenerAttached = false;

/** Regista listener «online» uma única vez por sessão de página. */
export function startOfflineOutboxSync(): () => void {
  if (typeof window === "undefined" || onlineListenerAttached) return () => undefined;
  onlineListenerAttached = true;
  const handler = () => {
    void flushOfflineOutboxOnOnline();
  };
  window.addEventListener("online", handler);
  if (navigator.onLine) void flushOfflineOutboxOnOnline();
  return () => {
    window.removeEventListener("online", handler);
    onlineListenerAttached = false;
  };
}

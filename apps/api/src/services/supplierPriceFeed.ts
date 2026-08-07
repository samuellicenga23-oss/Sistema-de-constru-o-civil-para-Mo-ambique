import { and, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { supplierPriceFeeds, suppliers, materials, supplierMaterialPrices } from "../db/schema.js";
import { fanOutSigoPriceToAllCompanies, isSigoPricesSupplier } from "./sigoPrices.js";

// Contrato simples que qualquer sistema externo de um fornecedor pode implementar para os seus
// preços serem puxados automaticamente pelo SIGO, sem precisar de responder pedidos de cotação
// um a um no Portal do Fornecedor: GET <feedUrl> (com "Authorization: Bearer <apiKey>" se
// configurado) devolve { "items": [{ "material": "<nome tal como no Catálogo>", "unitCost": 480,
// "currency": "MZN" }, ...] }. Itens cujo nome não corresponde a nenhum material visível para a
// empresa são ignorados e contados como "não reconhecidos" — nunca bloqueiam os restantes.
const feedResponseSchema = z.object({
  items: z.array(
    z.object({
      material: z.string().trim().min(1),
      unitCost: z.number().nonnegative(),
      currency: z.enum(["MZN", "USD"]).optional(),
    }),
  ),
});

const FETCH_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_ITEMS = 5000;

// Defesa contra SSRF: um utilizador de empresa pode configurar qualquer URL aqui, e é o servidor
// SIGO que lhe faz o pedido — sem isto, seria possível apontar o feed para serviços internos
// (localhost, rede privada) e usar o SIGO como proxy para os sondar.
function isPubliclyRoutableHttpUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") return false;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = ipv4.slice(1).map(Number);
    if (a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254)) return false;
  }
  return true;
}

export type SupplierPriceFeedSyncResult =
  | { ok: true; matched: number; unmatched: number }
  | { ok: false; error: string };

export async function syncSupplierPriceFeed(supplierId: string): Promise<SupplierPriceFeedSyncResult> {
  const [feed] = await db.select().from(supplierPriceFeeds).where(eq(supplierPriceFeeds.supplierId, supplierId)).limit(1);
  if (!feed) return { ok: false, error: "Ligação automática não configurada" };

  const result = await runFeedSync(supplierId, feed.feedUrl, feed.apiKey);

  await db
    .update(supplierPriceFeeds)
    .set(
      result.ok
        ? { lastSyncAt: new Date(), lastSyncStatus: "sucesso", lastSyncError: null, lastSyncMatched: result.matched, lastSyncUnmatched: result.unmatched }
        : { lastSyncAt: new Date(), lastSyncStatus: "erro", lastSyncError: result.error.slice(0, 2000) },
    )
    .where(eq(supplierPriceFeeds.id, feed.id));

  return result;
}

async function runFeedSync(supplierId: string, feedUrl: string, apiKey: string | null): Promise<SupplierPriceFeedSyncResult> {
  if (!isPubliclyRoutableHttpUrl(feedUrl)) {
    return { ok: false, error: "URL do feed inválido — tem de ser um endereço http(s) público" };
  }

  const [supplier] = await db.select().from(suppliers).where(eq(suppliers.id, supplierId)).limit(1);
  if (!supplier) return { ok: false, error: "Fornecedor não encontrado" };

  let response: Response;
  try {
    response = await fetch(feedUrl, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } : { Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? `Falha ao contactar o feed: ${error.message}` : "Falha ao contactar o feed" };
  }
  if (!response.ok) {
    return { ok: false, error: `O feed respondeu com o estado ${response.status}` };
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return { ok: false, error: "A resposta do feed não é JSON válido" };
  }

  const parsed = feedResponseSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, error: "A resposta do feed não segue o formato esperado ({ items: [{ material, unitCost, currency? }] })" };
  }
  const items = parsed.data.items.slice(0, MAX_RESPONSE_ITEMS);

  // Fornecedor do marketplace (companyId null) só vê materiais globais — não tem empresa própria
  // para "ver" materiais privados de ninguém. A ficha SIGO Preços de uma empresa continua a poder
  // casar também com os materiais privados dessa empresa, como antes.
  const available = await db
    .select({ id: materials.id, name: materials.name, currency: materials.currency })
    .from(materials)
    .where(
      and(
        supplier.companyId ? or(isNull(materials.companyId), eq(materials.companyId, supplier.companyId)) : isNull(materials.companyId),
        eq(materials.isActive, true),
      ),
    );
  const byName = new Map(available.map((m) => [m.name.trim().toLocaleLowerCase("pt"), m]));

  let matched = 0;
  let unmatched = 0;
  for (const item of items) {
    const material = byName.get(item.material.trim().toLocaleLowerCase("pt"));
    if (!material) {
      unmatched++;
      continue;
    }
    matched++;
    const unitCost = item.unitCost.toFixed(2);
    const currency = item.currency ?? material.currency;

    const [existing] = await db
      .select()
      .from(supplierMaterialPrices)
      .where(and(eq(supplierMaterialPrices.supplierId, supplierId), eq(supplierMaterialPrices.materialId, material.id), isNull(supplierMaterialPrices.zoneId)))
      .limit(1);
    if (existing) {
      await db.update(supplierMaterialPrices).set({ unitCost, currency }).where(eq(supplierMaterialPrices.id, existing.id));
    } else {
      await db.insert(supplierMaterialPrices).values({ supplierId, materialId: material.id, unitCost, currency });
    }
    if (isSigoPricesSupplier(supplier)) {
      await fanOutSigoPriceToAllCompanies(supplierId, material.id, unitCost, currency);
    }
  }

  return { ok: true, matched, unmatched };
}

let feedSchedulerTimer: ReturnType<typeof setInterval> | null = null;
let feedSchedulerRunning = false;

// Corre de hora a hora, mas só sincroniza os feeds cujo `intervalHours` já passou desde o último
// sucesso/erro — cada fornecedor pode escolher a sua própria cadência sem precisar de vários
// temporizadores.
export function startSupplierPriceFeedScheduler(logger: { info: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void }) {
  if (feedSchedulerTimer) return;

  const tick = async () => {
    if (feedSchedulerRunning) return;
    feedSchedulerRunning = true;
    try {
      const feeds = await db.select().from(supplierPriceFeeds).where(eq(supplierPriceFeeds.isActive, true));
      const now = Date.now();
      let synced = 0;
      for (const feed of feeds) {
        const dueAt = feed.lastSyncAt ? feed.lastSyncAt.getTime() + feed.intervalHours * 60 * 60 * 1000 : 0;
        if (dueAt > now) continue;
        await syncSupplierPriceFeed(feed.supplierId);
        synced++;
      }
      if (synced) logger.info({ synced }, "Supplier price feed sync finished");
    } catch (error) {
      logger.error(error, "Supplier price feed scheduler failed");
    } finally {
      feedSchedulerRunning = false;
    }
  };

  const initial = setTimeout(() => void tick(), 5 * 60 * 1000);
  initial.unref?.();

  feedSchedulerTimer = setInterval(() => void tick(), 60 * 60 * 1000);
  feedSchedulerTimer.unref?.();

  logger.info({}, "Supplier price feed scheduler started");
}

import { and, eq, isNull, ne, or } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db } from "../db/index.js";
import { materials, supplierAccounts, supplierMaterialPrices, suppliers, quoteRequests, quoteRequestLines, users, priceZones } from "../db/schema.js";
import { sendEmail, emailLayout } from "./mailer.js";
import { env } from "../env.js";

export const SIGO_PRICES_SUPPLIER_NAME = "SIGO Preços";
export const SIGO_PRICES_REVIEW_DATE = "2026-08-03";
export const SIGO_PRICES_NOTES = [
  "Fornecedor SIGO (catálogo nacional), sem IVA.",
  "Base inicial: INE Moçambique e preços públicos de fornecedores locais.",
  "Os preços são geridos pela equipa SIGO através do Portal do Fornecedor — pedidos de cotação para materiais novos são gerados automaticamente pelo sistema.",
].join(" ");

// Conta global única (não por empresa) — é ligada à ficha "SIGO Preços" de TODAS as empresas,
// para a equipa SIGO responder pedidos de cotação de qualquer empresa com um único login no
// Portal do Fornecedor, tal como qualquer fornecedor externo.
export const SIGO_PRICES_SUPPLIER_EMAIL = "precos@sigomz.com";

export function isSigoPricesSupplier(supplier: { name: string }) {
  return supplier.name.trim().toLocaleLowerCase("pt") === SIGO_PRICES_SUPPLIER_NAME.toLocaleLowerCase("pt");
}

/** Conta do Portal da Equipa de Preços SIGO (email ou nome). */
export function isSigoPricesAccount(account: { name: string; email: string }) {
  const email = account.email.trim().toLowerCase();
  const name = account.name.trim().toLocaleLowerCase("pt");
  return email === SIGO_PRICES_SUPPLIER_EMAIL || name === "equipa de preços sigo" || isSigoPricesSupplier(account);
}

/** Ficha marketplace nacional (companyId null) da Equipa SIGO — onde gerem «Meus preços». */
export async function ensureSigoMarketplaceSupplier() {
  const account = await ensureSigoPricesSupplierAccount();
  const [existing] = await db
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.supplierAccountId, account.id), isNull(suppliers.companyId)))
    .limit(1);
  if (existing) {
    if (existing.name !== SIGO_PRICES_SUPPLIER_NAME || existing.notes !== SIGO_PRICES_NOTES) {
      const [updated] = await db
        .update(suppliers)
        .set({ name: SIGO_PRICES_SUPPLIER_NAME, notes: SIGO_PRICES_NOTES, location: existing.location ?? "Moçambique" })
        .where(eq(suppliers.id, existing.id))
        .returning();
      return updated;
    }
    return existing;
  }
  const [zone] = await db.select().from(priceZones).where(isNull(priceZones.companyId)).orderBy(priceZones.name).limit(1);
  const [row] = await db
    .insert(suppliers)
    .values({
      companyId: null,
      name: SIGO_PRICES_SUPPLIER_NAME,
      supplierAccountId: account.id,
      zoneId: zone?.id ?? null,
      location: zone?.name ?? "Moçambique",
      notes: SIGO_PRICES_NOTES,
    })
    .returning();
  return row;
}

// Garante a conta global "SIGO Preços" no Portal do Fornecedor. Se ainda não existir, cria-a e
// notifica os super-admins com o link de activação — a equipa SIGO entra com este login e passa a
// responder pedidos de cotação exactamente como qualquer fornecedor externo.
async function ensureSigoPricesSupplierAccount() {
  const [existing] = await db.select().from(supplierAccounts).where(eq(supplierAccounts.email, SIGO_PRICES_SUPPLIER_EMAIL)).limit(1);
  if (existing) return existing;

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const [account] = await db
    .insert(supplierAccounts)
    .values({
      name: "Equipa de Preços SIGO",
      email: SIGO_PRICES_SUPPLIER_EMAIL,
      inviteToken: token,
      inviteTokenExpiresAt: expiresAt,
    })
    .returning();

  const admins = await db.select({ email: users.email }).from(users).where(and(eq(users.role, "super_admin"), eq(users.isActive, true)));
  const emails = admins.map((a) => a.email);
  if (emails.length) {
    void sendEmail(
      {
        to: emails,
        subject: "SIGO — Activar conta «SIGO Preços» no Portal do Fornecedor",
        html: emailLayout(
          "Conta de preços de referência criada",
          `<p>A conta global «SIGO Preços» (${SIGO_PRICES_SUPPLIER_EMAIL}) acabou de ser criada — é através dela que os preços de referência do catálogo nacional passam a ser geridos no Portal do Fornecedor, em vez de editados directamente na base de dados.</p>
           <p>Active-a para começar a responder aos pedidos de cotação automáticos que o sistema vai gerar para materiais novos ainda sem preço.</p>`,
          `${env.supplierPublicUrl}/aceitar-convite?token=${token}`,
          "Activar conta SIGO Preços",
        ),
      },
      undefined,
    );
  }

  return account;
}

/**
 * Garante o fornecedor «SIGO Preços» para uma empresa, liga-o à conta global do Portal do
 * Fornecedor, e preenche cotações em falta com o preço base do catálogo — um ponto de partida
 * imediato para a empresa, nunca sobrescrito depois. Para cada material realmente novo (sem
 * cotação anterior nesta empresa), gera também um pedido de cotação automático dirigido à equipa
 * SIGO, para que o preço definitivo passe a vir de uma resposta real no portal, não só do valor
 * base gravado no Catálogo.
 */
export async function syncSigoPricesForCompany(companyId: string) {
  const sigoAccount = await ensureSigoPricesSupplierAccount();
  await ensureSigoMarketplaceSupplier();

  let [supplier] = await db
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.companyId, companyId), eq(suppliers.name, SIGO_PRICES_SUPPLIER_NAME)))
    .limit(1);

  if (!supplier) {
    [supplier] = await db
      .insert(suppliers)
      .values({
        companyId,
        name: SIGO_PRICES_SUPPLIER_NAME,
        location: "Moçambique",
        notes: SIGO_PRICES_NOTES,
        supplierAccountId: sigoAccount.id,
      })
      .returning();
  } else if (supplier.notes !== SIGO_PRICES_NOTES || supplier.location !== "Moçambique" || supplier.supplierAccountId !== sigoAccount.id) {
    [supplier] = await db
      .update(suppliers)
      .set({ location: "Moçambique", notes: SIGO_PRICES_NOTES, supplierAccountId: sigoAccount.id })
      .where(eq(suppliers.id, supplier.id))
      .returning();
  }

  const available = await db
    .select()
    .from(materials)
    .where(and(or(isNull(materials.companyId), eq(materials.companyId, companyId)), eq(materials.isActive, true)));

  const visibleByName = new Map<string, (typeof available)[number]>();
  for (const material of available.filter((item) => item.companyId == null)) {
    visibleByName.set(material.name.trim().toLocaleLowerCase("pt"), material);
  }
  for (const material of available.filter((item) => item.companyId === companyId)) {
    visibleByName.set(material.name.trim().toLocaleLowerCase("pt"), material);
  }
  const visible = [...visibleByName.values()];

  const current = await db
    .select()
    .from(supplierMaterialPrices)
    .where(and(eq(supplierMaterialPrices.supplierId, supplier.id), isNull(supplierMaterialPrices.zoneId)));
  const currentByMaterial = new Map(current.map((price) => [price.materialId, price]));
  const newlyPriced: Array<{ material: (typeof available)[number]; unitCost: string }> = [];

  for (const material of visible) {
    if (currentByMaterial.has(material.id)) continue;
    const unitCost = (Number(material.baseUnitCost) * Number(material.importFactor)).toFixed(2);
    await db.insert(supplierMaterialPrices).values({
      supplierId: supplier.id,
      materialId: material.id,
      zoneId: null,
      unitCost,
      currency: material.currency,
    });
    newlyPriced.push({ material, unitCost });
  }

  if (newlyPriced.length) {
    try {
      await createAutomaticQuoteRequest(companyId, supplier.id, newlyPriced);
    } catch (error) {
      // Tabelas de RFQ podem ainda não estar migradas — preços base já foram gravados.
      console.warn("[sigoPrices] createAutomaticQuoteRequest skipped", error);
    }
  }

  return { supplier, materials: visible.length, created: newlyPriced.length, updated: 0 };
}

// Pedido de cotação gerado pelo próprio sistema (sem utilizador humano a pedir) — a equipa SIGO
// responde-lhe no Portal do Fornecedor como a qualquer outro pedido; o preço base do catálogo já
// aplicado acima fica só como valor provisório até essa resposta.
async function createAutomaticQuoteRequest(
  companyId: string,
  supplierId: string,
  items: Array<{ material: { id: string; name: string; unit: string }; unitCost: string }>,
) {
  const [quoteRequest] = await db
    .insert(quoteRequests)
    .values({
      companyId,
      supplierId,
      title: `Confirmação de preços — ${items.length} material(is) novo(s)`,
      message:
        "Pedido gerado automaticamente pelo sistema: estes materiais foram adicionados ao Catálogo e receberam um preço base provisório. Confirme ou actualize o preço de cada um.",
    })
    .returning();

  await db.insert(quoteRequestLines).values(
    items.map(({ material }, index) => ({
      quoteRequestId: quoteRequest.id,
      kind: "material" as const,
      materialId: material.id,
      description: material.name,
      unit: material.unit,
      sortOrder: index,
    })),
  );
}

/**
 * Quando a equipa SIGO aceita uma cotação numa empresa, o preço aplica-se automaticamente à ficha
 * "SIGO Preços" de TODAS as outras empresas ligadas à mesma conta global — é o mesmo catálogo
 * nacional em todo o lado, uma única resposta do fornecedor actualiza-o de uma vez.
 */
export async function fanOutSigoPriceToAllCompanies(acceptedSupplierId: string, materialId: string, unitCost: string, currency: "MZN" | "USD") {
  const [acceptedSupplier] = await db.select().from(suppliers).where(eq(suppliers.id, acceptedSupplierId)).limit(1);
  if (!acceptedSupplier?.supplierAccountId || !isSigoPricesSupplier(acceptedSupplier)) return;

  const otherRows = await db
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.supplierAccountId, acceptedSupplier.supplierAccountId), eq(suppliers.name, SIGO_PRICES_SUPPLIER_NAME), ne(suppliers.id, acceptedSupplierId)));

  for (const row of otherRows) {
    const [existing] = await db
      .select()
      .from(supplierMaterialPrices)
      .where(and(eq(supplierMaterialPrices.supplierId, row.id), eq(supplierMaterialPrices.materialId, materialId), isNull(supplierMaterialPrices.zoneId)))
      .limit(1);
    if (existing) {
      await db.update(supplierMaterialPrices).set({ unitCost, currency }).where(eq(supplierMaterialPrices.id, existing.id));
    } else {
      await db.insert(supplierMaterialPrices).values({ supplierId: row.id, materialId, unitCost, currency });
    }
  }
}

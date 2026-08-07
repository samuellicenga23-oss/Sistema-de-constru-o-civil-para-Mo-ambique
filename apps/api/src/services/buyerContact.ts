import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users, companies } from "../db/schema.js";

export type BuyerContact = {
  companyName: string;
  companyPhone: string | null;
  buyerName: string | null;
  buyerEmail: string | null;
};

// Quem pediu a cotação/criou a ordem de compra — é este contacto que o fornecedor recebe (por
// email e no seu Portal) para poder ligar directamente e tentar fechar a venda, em vez de só
// ver "uma empresa qualquer pediu um preço".
export async function resolveBuyerContact(companyId: string, buyerUserId: string | null): Promise<BuyerContact> {
  const [company] = await db.select({ name: companies.name, phone: companies.phone }).from(companies).where(eq(companies.id, companyId)).limit(1);
  let buyerName: string | null = null;
  let buyerEmail: string | null = null;
  if (buyerUserId) {
    const [buyer] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, buyerUserId)).limit(1);
    buyerName = buyer?.name ?? null;
    buyerEmail = buyer?.email ?? null;
  }
  return {
    companyName: company?.name ?? "",
    companyPhone: company?.phone ?? null,
    buyerName,
    buyerEmail,
  };
}

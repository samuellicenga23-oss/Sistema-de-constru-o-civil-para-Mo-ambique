import { eq } from "drizzle-orm";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { db } from "../db/index.js";
import { companies } from "../db/schema.js";
import { env } from "../env.js";

export type CompanyBrand = {
  name: string;
  brandName: string | null;
  logoUrl: string | null;
  nuit: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  bankDetails: string | null;
  documentFooter: string | null;
  primaryColor: string;
};

export async function loadCompanyBrand(companyId: string): Promise<CompanyBrand> {
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!company) {
    return {
      name: "Empresa",
      brandName: null,
      logoUrl: null,
      nuit: null,
      address: null,
      phone: null,
      email: null,
      bankDetails: null,
      documentFooter: null,
      primaryColor: "#ED6C22",
    };
  }
  const address = [company.address, company.district, company.province].filter(Boolean).join(" · ") || null;
  return {
    name: company.name,
    brandName: company.brandName,
    logoUrl: company.logoUrl,
    nuit: company.nuit,
    address,
    phone: company.phone,
    email: company.email,
    bankDetails: company.bankDetails,
    documentFooter: company.documentFooter,
    primaryColor: company.primaryColor || company.accentColor || "#ED6C22",
  };
}

export function logoDataUri(logoUrl: string | null): string | null {
  if (!logoUrl) return null;
  try {
    let filePath: string | null = null;
    const cleaned = logoUrl.split("?")[0];
    if (cleaned.startsWith("/uploads/logos/")) {
      filePath = path.resolve(env.uploadsDir, "logos", path.basename(cleaned));
    } else if (cleaned.startsWith("uploads/logos/")) {
      filePath = path.resolve(env.uploadsDir, "logos", path.basename(cleaned));
    } else if (path.isAbsolute(cleaned) && existsSync(cleaned)) {
      filePath = cleaned;
    } else {
      filePath = path.resolve(env.uploadsDir, "logos", path.basename(cleaned));
    }
    if (!filePath || !existsSync(filePath)) return null;
    const buf = readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mime =
      ext === ".png"
        ? "image/png"
        : ext === ".webp"
          ? "image/webp"
          : ext === ".gif"
            ? "image/gif"
            : "image/jpeg";
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

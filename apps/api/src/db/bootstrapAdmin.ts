import { randomBytes } from "node:crypto";
import { eq, isNull } from "drizzle-orm";
import { db, sql } from "./index.js";
import { users } from "./schema.js";
import { hashPassword } from "../auth/password.js";

// Cria o primeiro (e só o primeiro) super_admin — substitui a conta fixa que o seed criava
// antes (super@sigo.local / admin123), que era pública no código-fonte. Uso:
//   npm run bootstrap:admin -- --name "Nome" --email admin@empresa.co.mz [--password "..."]
// Sem --password, gera uma password aleatória forte e imprime-a uma única vez — não fica
// guardada em lado nenhum além da base de dados (já com hash).
function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      if (value && !value.startsWith("--")) {
        out[key] = value;
        i++;
      } else {
        out[key] = "true";
      }
    }
  }
  return out;
}

function generatePassword(): string {
  // 24 caracteres, alfanumérico + símbolos comuns — suficiente para uma conta única de
  // plataforma, sem os problemas de compatibilidade que símbolos exóticos causam em alguns
  // clientes/copy-paste.
  return randomBytes(18).toString("base64").replace(/[+/=]/g, "").slice(0, 22);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const name = args.name;
  const email = args.email;

  if (!name || !email) {
    console.error('Uso: npm run bootstrap:admin -- --name "Nome" --email admin@empresa.co.mz [--password "..."]');
    process.exit(1);
  }

  const [existingSuperAdmin] = await db.select().from(users).where(isNull(users.companyId)).limit(1);
  if (existingSuperAdmin) {
    console.error(`Já existe um super_admin (${existingSuperAdmin.email}). Este script só cria o primeiro.`);
    process.exit(1);
  }

  const [existingEmail] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existingEmail) {
    console.error(`Já existe uma conta com este email: ${email}`);
    process.exit(1);
  }

  const password = args.password ?? generatePassword();
  const passwordHash = await hashPassword(password);

  await db.insert(users).values({
    companyId: null,
    name,
    email,
    passwordHash,
    role: "super_admin",
    permissions: ["plataforma.configuracoes"],
  });

  console.log(`super_admin criado: ${email}`);
  if (!args.password) {
    console.log(`Password gerada (guarde-a agora, não volta a ser mostrada): ${password}`);
  }

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

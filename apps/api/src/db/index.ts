import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { env } from "../env.js";
import * as schema from "./schema.js";

export const sql = postgres(env.databaseUrl);
export const db = drizzle(sql, { schema });

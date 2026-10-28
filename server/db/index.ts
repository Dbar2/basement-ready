// One database handle for the API, the worker and tests.
// DATABASE_URL set: real Postgres. Not set: embedded PGlite on disk (dev) or in memory (tests).
import { PGlite } from "@electric-sql/pglite";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { migrate as migratePg } from "drizzle-orm/postgres-js/migrator";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = PgDatabase<any, typeof schema>;

const MIGRATIONS = fileURLToPath(new URL("./migrations", import.meta.url));

export const usingPglite = !process.env.DATABASE_URL;

function connect(): { db: Db; migrate: () => Promise<void> } {
  if (process.env.DATABASE_URL) {
    const client = postgres(process.env.DATABASE_URL, { max: 10 });
    const db = drizzlePg(client, { schema });
    return { db: db as unknown as Db, migrate: () => migratePg(db, { migrationsFolder: MIGRATIONS }) };
  }
  const dataDir = process.env.PGLITE_DIR ?? ".data/pglite";
  if (dataDir !== "memory://") mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  const db = drizzlePglite(client, { schema });
  return { db: db as unknown as Db, migrate: () => migratePglite(db, { migrationsFolder: MIGRATIONS }) };
}

const conn = connect();
export const db = conn.db;

let migrated: Promise<void> | null = null;
export function migrateDb() {
  migrated ??= conn.migrate();
  return migrated;
}

export { schema };

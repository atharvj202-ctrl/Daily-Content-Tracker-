import fs from "node:fs";
import path from "node:path";
import { drizzle as drizzlePg, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

export type DB = PostgresJsDatabase<typeof schema>;

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("DATABASE_URL is not configured for this deployment.");
  }
}

const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");

/**
 * Local development and tests use PGlite (embedded Postgres, no install needed).
 * Production uses a real Postgres server via DATABASE_URL (e.g. Neon).
 */
export async function createDb(url: string | undefined, opts: { migrate?: boolean } = {}): Promise<DB> {
  if (!url || url.startsWith("pglite:") || url === "memory://") {
    if (!url && process.env.NODE_ENV === "production") {
      throw new DatabaseNotConfiguredError();
    }
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const dataDir =
      url === "memory://" ? undefined : url?.startsWith("pglite:") ? url.slice("pglite:".length) : path.join(process.cwd(), ".data", "pglite");
    if (dataDir) fs.mkdirSync(dataDir, { recursive: true });
    const client = dataDir ? new PGlite(dataDir) : new PGlite();
    await client.waitReady;
    const db = drizzle(client, { schema });
    if (opts.migrate !== false) {
      const { migrate } = await import("drizzle-orm/pglite/migrator");
      await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    }
    return db as unknown as DB;
  }
  const postgres = (await import("postgres")).default;
  const client = postgres(url, { max: 5, prepare: false, idle_timeout: 20 });
  const db = drizzlePg(client, { schema });
  if (opts.migrate) {
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  }
  return db;
}

const globalForDb = globalThis as unknown as { __dctDb?: Promise<DB> };

export function getDb(): Promise<DB> {
  if (!globalForDb.__dctDb) {
    // PGlite migrates itself on first use; hosted Postgres is migrated at build time.
    globalForDb.__dctDb = createDb(process.env.DATABASE_URL || undefined).catch((err) => {
      globalForDb.__dctDb = undefined;
      throw err;
    });
  }
  return globalForDb.__dctDb;
}

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL) || process.env.NODE_ENV !== "production";
}

/** Test hook: replace the shared DB instance. */
export function setDbForTests(db: DB) {
  globalForDb.__dctDb = Promise.resolve(db);
}

export { schema };

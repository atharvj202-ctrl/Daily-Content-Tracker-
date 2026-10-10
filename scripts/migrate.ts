// Applies database migrations. Runs automatically during the Vercel build.
import { createDb } from "../src/lib/db";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url && process.env.VERCEL) {
    console.warn("[migrate] DATABASE_URL is not set - skipping migrations. The app will show a 'Setup required' page.");
    return;
  }
  await createDb(url || undefined, { migrate: true });
  console.log(`[migrate] Migrations applied to ${url ? "DATABASE_URL" : "local PGlite (.data/pglite)"}.`);
  process.exit(0);
}

main().catch((e) => {
  console.error("[migrate] failed", e);
  process.exit(1);
});

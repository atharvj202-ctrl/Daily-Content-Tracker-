// Account recovery from the command line (e.g. if every Super Admin is locked out).
// Usage: npm run setup-link -- someone@company.com
import { eq } from "drizzle-orm";
import { createDb } from "../src/lib/db";
import { users } from "../src/lib/db/schema";
import { createSetupLink } from "../src/lib/services/auth";
import { normalizeEmail } from "../src/lib/validation";

async function main() {
  const email = normalizeEmail(process.argv[2]);
  const db = await createDb(process.env.DATABASE_URL || undefined, { migrate: false });
  const [user] = await db.select().from(users).where(eq(users.email, email));
  if (!user) throw new Error(`No user with email ${email}`);
  if (user.status !== "active") throw new Error(`${email} is ${user.status}; activate the account first.`);
  // Acts with Super Admin authority because whoever runs this has database access.
  const token = await createSetupLink(db, { ...user, role: "super_admin" }, user.id, new Date());
  const base = (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
  console.log(`One-time setup / reset link for ${email} (expires in 72 hours):\n${base}/setup/${token}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});

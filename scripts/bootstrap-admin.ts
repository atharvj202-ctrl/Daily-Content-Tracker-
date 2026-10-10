// Creates (or promotes) the first Super Admin and prints a one-time setup link.
// Usage: npm run bootstrap-admin -- someone@company.com "Full Name"
import { createDb } from "../src/lib/db";
import { bootstrapSuperAdmin, createSetupLink } from "../src/lib/services/auth";
import { isValidEmail, normalizeEmail } from "../src/lib/validation";

async function main() {
  const email = normalizeEmail(process.argv[2]);
  const name = process.argv[3] || email.split("@")[0];
  if (!isValidEmail(email)) {
    console.error('Usage: npm run bootstrap-admin -- someone@company.com "Full Name"');
    process.exit(1);
  }
  const db = await createDb(process.env.DATABASE_URL || undefined, { migrate: true });
  const at = new Date();
  const user = await bootstrapSuperAdmin(db, email, name, at);
  const token = await createSetupLink(db, user, user.id, at);
  const base = (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
  console.log(`Super Admin ready: ${user.email}`);
  console.log(`One-time setup link (expires in 72 hours):\n${base}/setup/${token}`);
  console.log("If Google sign-in is configured, they can also just sign in with Google.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

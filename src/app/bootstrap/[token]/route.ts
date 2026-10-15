import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { bootstrapSuperAdmin, createSetupLink } from "@/lib/services/auth";
import { isValidEmail, normalizeEmail } from "@/lib/validation";
import { appUrl } from "@/lib/session";
import { now } from "@/lib/time";

/**
 * First-run only: creates the Super Admin named in BOOTSTRAP_SUPER_ADMIN_EMAIL and
 * forwards to a one-time password setup page. Requires the secret BOOTSTRAP_TOKEN.
 * Stops working as soon as any Super Admin has set a password or signed in.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const notFound = () => new NextResponse("Not found", { status: 404 });
  const expected = process.env.BOOTSTRAP_TOKEN ?? "";
  const email = normalizeEmail(process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL);
  const { token } = await params;
  if (expected.length < 32 || !isValidEmail(email)) return notFound();
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return notFound();

  const db = await getDb();
  const admins = await db.select().from(users).where(and(eq(users.role, "super_admin"), eq(users.status, "active")));
  if (admins.some((u) => u.passwordHash || u.lastLoginAt)) return notFound();

  const at = now();
  const user = await bootstrapSuperAdmin(db, email, email.split("@")[0], at);
  const setupToken = await createSetupLink(db, user, user.id, at);
  return NextResponse.redirect(`${appUrl()}/setup/${setupToken}`);
}

import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
import type { DB } from "../db";
import { sessions, setupTokens, users, type User } from "../db/schema";
import { canManageUser, can, assert, PermissionError, ValidationError } from "../permissions";
import { normalizeEmail } from "../validation";
import { audit } from "./audit";
import { todayInDubai } from "../calendar";

export const SESSION_DAYS = 14;
export const SETUP_LINK_HOURS = 72;
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
export const PASSWORD_MIN = 10;

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function newToken() {
  return randomBytes(32).toString("base64url");
}

// ---------------------------------------------------------------- sessions

export async function createSession(db: DB, userId: string, at: Date) {
  const token = newToken();
  const expiresAt = new Date(at.getTime() + SESSION_DAYS * 86_400_000);
  await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt, createdAt: at });
  await db.update(users).set({ lastLoginAt: at, failedLogins: 0, lockedUntil: null }).where(eq(users.id, userId));
  // Opportunistic cleanup of expired sessions.
  await db.delete(sessions).where(lt(sessions.expiresAt, at));
  return { token, expiresAt };
}

/** Returns the signed-in user only if the session is valid AND the account is active. */
export async function validateSession(db: DB, token: string | undefined, at: Date): Promise<User | null> {
  if (!token || token.length > 200) return null;
  const [row] = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, at)));
  if (!row || row.user.status !== "active") return null;
  return row.user;
}

export async function deleteSession(db: DB, token: string | undefined) {
  if (token) await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
}

// ---------------------------------------------------------- setup links

/**
 * Creates a one-time account setup / password reset link. Only the hash is
 * stored; the link is shown once to the Admin, who sends it personally.
 */
export async function createSetupLink(db: DB, actor: User, userId: string, at: Date) {
  assert(can.manageTracking(actor.role));
  const [target] = await db.select().from(users).where(eq(users.id, userId));
  if (!target) throw new ValidationError("User not found.");
  if (!canManageUser(actor, target)) throw new PermissionError("Only a Super Admin can create links for staff accounts.");
  if (target.status !== "active") throw new ValidationError("Approve or reactivate this person before sending a setup link.");
  // Invalidate older unused links.
  await db.delete(setupTokens).where(and(eq(setupTokens.userId, userId), isNull(setupTokens.usedAt)));
  const token = newToken();
  await db.insert(setupTokens).values({
    id: hashToken(token),
    userId,
    expiresAt: new Date(at.getTime() + SETUP_LINK_HOURS * 3_600_000),
    createdById: actor.id,
    createdAt: at,
  });
  await audit(db, actor, "user.setup_link", userId, { email: target.email });
  return token;
}

export async function getSetupTokenUser(db: DB, token: string, at: Date) {
  if (!token || token.length > 200) return null;
  const [row] = await db
    .select({ user: users, t: setupTokens })
    .from(setupTokens)
    .innerJoin(users, eq(users.id, setupTokens.userId))
    .where(and(eq(setupTokens.id, hashToken(token)), isNull(setupTokens.usedAt), gt(setupTokens.expiresAt, at)));
  if (!row || row.user.status !== "active") return null;
  return row.user;
}

export function checkPasswordStrength(password: string, user: Pick<User, "name" | "email" | "instagramHandle">) {
  if (password.length < PASSWORD_MIN) throw new ValidationError(`Use at least ${PASSWORD_MIN} characters.`);
  if (password.length > 128) throw new ValidationError("Password is too long.");
  const lower = password.toLowerCase();
  const personal = [user.email.split("@")[0], user.instagramHandle ?? "", ...user.name.toLowerCase().split(/\s+/)]
    .map((s) => s.toLowerCase())
    .filter((s) => s.length >= 3);
  if (personal.some((p) => lower.includes(p))) {
    throw new ValidationError("Don't use your name, email or Instagram handle in your password.");
  }
}

export async function completeSetup(db: DB, token: string, password: string, at: Date) {
  const user = await getSetupTokenUser(db, token, at);
  if (!user) throw new ValidationError("This link has expired or was already used. Ask the content team for a new one.");
  checkPasswordStrength(password, user);
  const passwordHash = await bcrypt.hash(password, 12);
  const used = await db
    .update(setupTokens)
    .set({ usedAt: at })
    .where(and(eq(setupTokens.id, hashToken(token)), isNull(setupTokens.usedAt)))
    .returning();
  if (!used.length) throw new ValidationError("This link was already used.");
  await db.update(users).set({ passwordHash, failedLogins: 0, lockedUntil: null, updatedAt: at }).where(eq(users.id, user.id));
  // A password reset signs out every other device.
  await db.delete(sessions).where(eq(sessions.userId, user.id));
  await audit(db, user, "user.password_set", user.id);
  return user;
}

// ---------------------------------------------------------- sign-in

const GENERIC_LOGIN_ERROR = "Email or password is incorrect, or your account isn't active yet.";
// Keeps timing similar whether or not the account exists.
let dummyHash: string | null = null;
function getDummyHash() {
  dummyHash ??= bcrypt.hashSync(newToken(), 12);
  return dummyHash;
}

export async function passwordLogin(db: DB, emailInput: string, password: string, at: Date) {
  const email = normalizeEmail(emailInput);
  const [user] = await db.select().from(users).where(eq(users.email, email));
  if (user?.lockedUntil && user.lockedUntil > at) {
    throw new ValidationError(`Too many attempts. Try again after ${LOCK_MINUTES} minutes.`);
  }
  const ok = await bcrypt.compare(password || "", user?.passwordHash ?? getDummyHash());
  if (!user || !user.passwordHash || !ok || user.status !== "active") {
    if (user) {
      const failed = user.failedLogins + 1;
      await db
        .update(users)
        .set({
          failedLogins: failed >= MAX_FAILED_LOGINS ? 0 : failed,
          lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(at.getTime() + LOCK_MINUTES * 60_000) : user.lockedUntil,
        })
        .where(eq(users.id, user.id));
    }
    throw new ValidationError(GENERIC_LOGIN_ERROR);
  }
  return user;
}

export function allowedGoogleDomains(): string[] {
  return (process.env.ALLOWED_GOOGLE_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Resolve a verified Google identity to an approved, active account.
 * The only exception is first-run bootstrap: if no Super Admin exists yet and
 * the email equals BOOTSTRAP_SUPER_ADMIN_EMAIL, that person becomes Super Admin.
 */
export async function resolveGoogleUser(
  db: DB,
  claims: { email?: string; email_verified?: boolean; name?: string; hd?: string },
  at: Date,
): Promise<{ user: User } | { error: string }> {
  const email = normalizeEmail(claims.email);
  if (!email || claims.email_verified !== true) return { error: "Your Google account email is not verified." };
  const domains = allowedGoogleDomains();
  if (domains.length && !domains.includes(email.split("@")[1])) {
    return { error: "Please sign in with your company Google account." };
  }
  const [user] = await db.select().from(users).where(eq(users.email, email));
  if (user) {
    if (user.status === "pending") return { error: "Your account is waiting for approval by the content team." };
    if (user.status !== "active") return { error: "Your account is not active. Contact the content team." };
    return { user };
  }
  const bootstrap = normalizeEmail(process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL);
  if (bootstrap && email === bootstrap) {
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(users)
      .where(eq(users.role, "super_admin"));
    if (n === 0) {
      const created = await bootstrapSuperAdmin(db, email, claims.name || email.split("@")[0], at);
      return { user: created };
    }
  }
  return { error: "This email isn't on the approved list. Contact the content team." };
}

export async function bootstrapSuperAdmin(db: DB, email: string, name: string, at: Date) {
  const [created] = await db
    .insert(users)
    .values({
      email: normalizeEmail(email),
      name,
      role: "super_admin",
      status: "active",
      approvedAt: at,
      trackingStartDate: todayInDubai(at),
      source: "bootstrap",
      createdAt: at,
      updatedAt: at,
    })
    .onConflictDoUpdate({ target: users.email, set: { role: "super_admin", status: "active", updatedAt: at } })
    .returning();
  await audit(db, null, "user.bootstrap_super_admin", created.id, { email: created.email });
  return created;
}

import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "./db";
import { validateSession, createSession, deleteSession } from "./services/auth";
import type { User, Role } from "./db/schema";
import { now } from "./time";

export const SESSION_COOKIE = "dct_session";

const secureCookies = () => process.env.NODE_ENV === "production";

export const getCurrentUser = cache(async (): Promise<User | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = await getDb();
  return validateSession(db, token, now());
});

/** Use in every protected page / action. Redirects to sign-in if not allowed. */
export async function requireUser(check?: (role: Role) => boolean): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (check && !check(user.role)) redirect("/?denied=1");
  return user;
}

export async function startSession(userId: string) {
  const db = await getDb();
  const { token, expiresAt } = await createSession(db, userId, now());
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function endSession() {
  const jar = await cookies();
  const db = await getDb();
  await deleteSession(db, jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
}

export function googleEnabled() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function passwordLoginEnabled() {
  return process.env.ENABLE_PASSWORD_LOGIN !== "false";
}

export function devLoginEnabled() {
  return process.env.NODE_ENV !== "production" && process.env.ENABLE_DEV_LOGIN === "true";
}

export function appUrl() {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}

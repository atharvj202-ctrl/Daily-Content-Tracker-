import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { decodeIdToken } from "arctic";
import { googleClient } from "@/lib/google";
import { googleEnabled, startSession, appUrl } from "@/lib/session";
import { getDb } from "@/lib/db";
import { resolveGoogleUser } from "@/lib/services/auth";
import { now } from "@/lib/time";

function fail(message: string) {
  return NextResponse.redirect(`${appUrl()}/login?error=${encodeURIComponent(message)}`);
}

export async function GET(req: NextRequest) {
  if (!googleEnabled()) return fail("Google sign-in is not configured.");
  const jar = await cookies();
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const storedState = jar.get("g_state")?.value;
  const verifier = jar.get("g_verifier")?.value;
  jar.delete("g_state");
  jar.delete("g_verifier");
  if (!code || !state || !storedState || !verifier || state !== storedState) {
    return fail("Sign-in expired. Please try again.");
  }
  let claims: { email?: string; email_verified?: boolean; name?: string; hd?: string };
  try {
    const tokens = await googleClient().validateAuthorizationCode(code, verifier);
    claims = decodeIdToken(tokens.idToken()) as typeof claims;
  } catch (e) {
    console.error("Google sign-in failed", e);
    return fail("Google sign-in failed. Please try again.");
  }
  const result = await resolveGoogleUser(await getDb(), claims, now());
  if ("error" in result) return fail(result.error);
  await startSession(result.user.id);
  return NextResponse.redirect(`${appUrl()}/`);
}

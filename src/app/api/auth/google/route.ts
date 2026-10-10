import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { generateCodeVerifier, generateState } from "arctic";
import { googleClient } from "@/lib/google";
import { googleEnabled } from "@/lib/session";

export async function GET() {
  if (!googleEnabled()) return NextResponse.redirect(new URL("/login", process.env.APP_URL || "http://localhost:3000"));
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const url = googleClient().createAuthorizationURL(state, codeVerifier, ["openid", "email", "profile"]);
  url.searchParams.set("prompt", "select_account");
  const domains = (process.env.ALLOWED_GOOGLE_DOMAINS ?? "").split(",").map((d) => d.trim()).filter(Boolean);
  if (domains.length === 1) url.searchParams.set("hd", domains[0]);
  const jar = await cookies();
  const opts = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: 600 };
  jar.set("g_state", state, opts);
  jar.set("g_verifier", codeVerifier, opts);
  return NextResponse.redirect(url);
}

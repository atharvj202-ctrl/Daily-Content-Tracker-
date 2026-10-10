import "server-only";
import { redirect } from "next/navigation";
import { PermissionError, ValidationError } from "./permissions";
import { ConflictError } from "./services/records";

/** Only allow same-site relative paths (prevents open redirects). */
export function safePath(value: FormDataEntryValue | null | undefined, fallback = "/"): string {
  const v = typeof value === "string" ? value : "";
  return v.startsWith("/") && !v.startsWith("//") && !v.includes("\\") ? v : fallback;
}

export function withParam(path: string, key: string, value: string) {
  const url = new URL(path, "http://x");
  url.searchParams.delete("ok");
  url.searchParams.delete("error");
  url.searchParams.set(key, value);
  return url.pathname + url.search;
}

export function userMessage(e: unknown): string | null {
  if (e instanceof ValidationError || e instanceof PermissionError || e instanceof ConflictError) return e.message;
  return null;
}

/**
 * Run a server action body and redirect back with a success or error message.
 * Unknown errors are logged server-side and shown as a generic message.
 */
export async function runAction(back: string, fn: () => Promise<string | void>): Promise<never> {
  let target: string;
  try {
    const msg = await fn();
    target = withParam(back, "ok", msg || "Saved.");
  } catch (e) {
    const msg = userMessage(e);
    if (!msg) console.error(e);
    target = withParam(back, "error", msg ?? "Something went wrong. Please try again.");
  }
  redirect(target);
}

export function str(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
}

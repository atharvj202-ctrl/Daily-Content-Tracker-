const EMAIL_RE = /^[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-z]{2,}$/i;
const HANDLE_RE = /^[a-z0-9._]{1,30}$/;
const INSTAGRAM_HOSTS = new Set(["instagram.com", "www.instagram.com", "m.instagram.com"]);

export function normalizeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_RE.test(value);
}

export function cleanText(value: unknown, max = 200): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, max);
}

function parseInstagramUrl(value: string): URL | null {
  try {
    const url = new URL(value.startsWith("http") ? value : `https://${value}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!INSTAGRAM_HOSTS.has(url.hostname.toLowerCase())) return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * Accepts "@name", "name", or an instagram.com profile URL; returns the bare
 * lower-case handle, or null if it isn't a valid handle.
 */
export function normalizeHandle(value: string | null | undefined): string | null {
  let v = (value ?? "").trim();
  if (!v) return null;
  if (/instagram\.com/i.test(v)) {
    const url = parseInstagramUrl(v);
    if (!url) return null;
    v = url.pathname.split("/").filter(Boolean)[0] ?? "";
  }
  v = v.replace(/^@+/, "").toLowerCase();
  return HANDLE_RE.test(v) ? v : null;
}

export function profileUrlForHandle(handle: string): string {
  return `https://www.instagram.com/${handle}/`;
}

/** Returns a canonical https profile URL, or null if not an instagram.com profile URL. */
export function normalizeProfileUrl(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  const url = parseInstagramUrl(v);
  if (!url) return null;
  const handle = url.pathname.split("/").filter(Boolean)[0];
  if (!handle || !HANDLE_RE.test(handle.toLowerCase())) return null;
  return profileUrlForHandle(handle.toLowerCase());
}

/** A direct link to an Instagram post / reel. */
export function normalizePostUrl(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v || v.length > 500) return null;
  const url = parseInstagramUrl(v);
  if (!url) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  // /p/<code>, /reel/<code>, /reels/<code>, /tv/<code>, optionally /<user>/p/<code>
  const idx = parts.findIndex((p) => ["p", "reel", "reels", "tv"].includes(p.toLowerCase()));
  if (idx === -1 || !parts[idx + 1] || !/^[A-Za-z0-9_-]+$/.test(parts[idx + 1])) return null;
  return `https://www.instagram.com/${parts.slice(0, idx + 2).join("/")}/`;
}

export const REASON_MIN = 3;
export const REASON_MAX = 500;

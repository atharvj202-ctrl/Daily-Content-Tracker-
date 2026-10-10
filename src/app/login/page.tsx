import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { getCurrentUser, googleEnabled, passwordLoginEnabled, devLoginEnabled, startSession } from "@/lib/session";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { passwordLogin } from "@/lib/services/auth";
import { userMessage, withParam, str } from "@/lib/actions";
import { now } from "@/lib/time";
import { Flash } from "@/components/ui";
import { ROLE_LABELS } from "@/lib/permissions";

async function loginWithPassword(form: FormData) {
  "use server";
  if (!passwordLoginEnabled()) redirect("/login");
  let userId: string;
  try {
    const db = await getDb();
    const user = await passwordLogin(db, str(form, "email"), str(form, "password"), now());
    userId = user.id;
  } catch (e) {
    const msg = userMessage(e);
    if (!msg) console.error(e);
    redirect(withParam("/login", "error", msg ?? "Sign-in failed."));
  }
  await startSession(userId);
  redirect("/");
}

async function devLogin(form: FormData) {
  "use server";
  // Local development only: never available in production builds.
  if (!devLoginEnabled()) redirect("/login");
  const db = await getDb();
  const [u] = await db.select().from(users).where(eq(users.id, str(form, "userId")));
  if (!u || u.status !== "active") redirect(withParam("/login", "error", "That sample user is not active."));
  await startSession(u.id);
  redirect("/");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  if (await getCurrentUser()) redirect("/");
  const sp = await searchParams;
  const devUsers = devLoginEnabled()
    ? await (await getDb()).select().from(users).where(eq(users.status, "active")).orderBy(asc(users.role), asc(users.name))
    : [];
  return (
    <div className="narrow" style={{ margin: "0 auto" }}>
      <div className="card">
        <h1>Sign in</h1>
        <p className="muted">Daily Content Tracker for IND Global Realty. Only approved team members can sign in.</p>
        <Flash sp={sp} />
        {googleEnabled() && (
          <p>
            <a className="btn" href="/api/auth/google" style={{ width: "100%", textAlign: "center" }}>
              Sign in with company Google account
            </a>
          </p>
        )}
        {passwordLoginEnabled() && (
          <>
            {googleEnabled() && <p className="muted small" style={{ textAlign: "center" }}>or, if you were sent a setup link</p>}
            <form action={loginWithPassword}>
              <div className="field">
                <label htmlFor="email">Work email</label>
                <input id="email" name="email" type="email" autoComplete="username" required />
              </div>
              <div className="field">
                <label htmlFor="password">Password</label>
                <input id="password" name="password" type="password" autoComplete="current-password" required />
              </div>
              <button type="submit">Sign in</button>
            </form>
            <p className="muted small" style={{ marginTop: "0.75rem" }}>
              First time, or forgot your password? Ask the content team for a new account setup link.
            </p>
          </>
        )}
        {!googleEnabled() && !passwordLoginEnabled() && <p>No sign-in method is configured. Contact the administrator.</p>}
      </div>
      {devUsers.length > 0 && (
        <div className="card">
          <h2>Development sign-in</h2>
          <p className="muted small">
            Shown only because <code>ENABLE_DEV_LOGIN=true</code> and this is not a production build. Sample (fictional) users:
          </p>
          <form action={devLogin}>
            <div className="field">
              <select name="userId" aria-label="Sample user">
                {devUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {ROLE_LABELS[u.role]} — {u.name} ({u.email})
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="secondary">
              Sign in as this user
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

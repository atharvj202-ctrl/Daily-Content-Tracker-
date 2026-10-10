import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { getSetupTokenUser, completeSetup, PASSWORD_MIN } from "@/lib/services/auth";
import { startSession, passwordLoginEnabled } from "@/lib/session";
import { userMessage, withParam, str } from "@/lib/actions";
import { now } from "@/lib/time";
import { Flash } from "@/components/ui";

async function setPassword(form: FormData) {
  "use server";
  const token = str(form, "token");
  const back = `/setup/${encodeURIComponent(token)}`;
  if (str(form, "password") !== str(form, "confirm")) redirect(withParam(back, "error", "The two passwords don't match."));
  let userId: string;
  try {
    const user = await completeSetup(await getDb(), token, str(form, "password"), now());
    userId = user.id;
  } catch (e) {
    const msg = userMessage(e);
    if (!msg) console.error(e);
    redirect(withParam(back, "error", msg ?? "Something went wrong."));
  }
  await startSession(userId);
  redirect("/");
}

export default async function SetupPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const { token } = await params;
  const sp = await searchParams;
  const user = await getSetupTokenUser(await getDb(), token, now());
  return (
    <div className="narrow" style={{ margin: "0 auto" }}>
      <div className="card">
        <h1>Set up your account</h1>
        <Flash sp={sp} />
        {!passwordLoginEnabled() ? (
          <p>Password sign-in is turned off. Please use “Sign in with company Google account” on the sign-in page.</p>
        ) : !user ? (
          <p>This link has expired or was already used. Ask the content team to send you a new setup link.</p>
        ) : (
          <form action={setPassword}>
            <p>
              Welcome, <strong>{user.name}</strong>. Choose a password for <strong>{user.email}</strong>.
            </p>
            <input type="hidden" name="token" value={token} />
            <div className="field">
              <label htmlFor="password">
                New password <span className="hint">at least {PASSWORD_MIN} characters; not your name, email or Instagram handle</span>
              </label>
              <input id="password" name="password" type="password" minLength={PASSWORD_MIN} autoComplete="new-password" required />
            </div>
            <div className="field">
              <label htmlFor="confirm">Confirm password</label>
              <input id="confirm" name="confirm" type="password" minLength={PASSWORD_MIN} autoComplete="new-password" required />
            </div>
            <button type="submit">Save password and sign in</button>
          </form>
        )}
      </div>
    </div>
  );
}

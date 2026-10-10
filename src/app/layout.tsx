import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { getCurrentUser, endSession } from "@/lib/session";
import { can, ROLE_LABELS } from "@/lib/permissions";
import { isDatabaseConfigured } from "@/lib/db";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Daily Content Tracker · IND Global Realty",
  description: "Internal daily Instagram content tracker",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

async function signOut() {
  "use server";
  await endSession();
  redirect("/login");
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const configured = isDatabaseConfigured();
  const user = configured ? await getCurrentUser() : null;
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <div className="topbar-inner">
            <Link href="/" className="brand">
              IND Global Realty <span>·</span> Content Tracker
            </Link>
            {user && (
              <nav className="nav" aria-label="Main">
                {can.submitOwnUpdates(user.role) && <Link href="/me">My updates</Link>}
                {can.viewDashboard(user.role) && <Link href="/admin">Dashboard</Link>}
                {can.viewDashboard(user.role) && <Link href="/admin/users">Roster</Link>}
                {can.manageTracking(user.role) && <Link href="/admin/import">Import CSV</Link>}
                {can.exportCsv(user.role) && <Link href="/admin/export">Export</Link>}
                {can.viewDashboard(user.role) && <Link href="/admin/settings">Settings</Link>}
                {can.viewAuditLog(user.role) && <Link href="/admin/audit">Audit log</Link>}
              </nav>
            )}
            {user && (
              <div className="who">
                <span>
                  {user.name} · {ROLE_LABELS[user.role]}
                </span>
                <form action={signOut}>
                  <button type="submit">Sign out</button>
                </form>
              </div>
            )}
          </div>
        </header>
        <main>
          {configured ? (
            children
          ) : (
            <div className="card narrow">
              <h1>Setup required</h1>
              <p>
                This deployment has no database configured yet, so nobody can sign in. An administrator needs to add a
                Postgres database and the <code>DATABASE_URL</code> environment variable, then redeploy. See{" "}
                <code>docs/DEPLOYMENT.md</code> in the repository.
              </p>
            </div>
          )}
        </main>
      </body>
    </html>
  );
}

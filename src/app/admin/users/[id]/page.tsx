import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { can, canManageUser, ROLE_LABELS } from "@/lib/permissions";
import type { Role } from "@/lib/db/schema";
import { getDb } from "@/lib/db";
import { getUser } from "@/lib/services/users";
import { formatDateTime } from "@/lib/time";
import { Flash } from "@/components/ui";
import { UserForm } from "../UserForm";
import { updateUserAction, setActiveAction, rejectPendingAction } from "../actions";
import { SetupLinkButton } from "../SetupLinkButton";

type SP = Record<string, string | string[] | undefined>;

export default async function EditUserPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const actor = await requireUser(can.viewDashboard);
  const { id } = await params;
  const sp = await searchParams;
  const db = await getDb();
  const user = await getUser(db, id);
  if (!user) notFound();
  const manage = can.manageTracking(actor.role) && canManageUser(actor, user);
  const roles: Role[] = can.manageRoles(actor.role) ? ["member", "viewer", "admin", "super_admin"] : [user.role];
  const approver = user.approvedById ? await getUser(db, user.approvedById) : null;
  const deactivator = user.deactivatedById ? await getUser(db, user.deactivatedById) : null;

  return (
    <div style={{ maxWidth: 820, margin: "0 auto" }}>
      <p>
        <Link href="/admin/users">← Roster</Link>
      </p>
      <div className="card">
        <div className="page-head" style={{ marginBottom: "0.5rem" }}>
          <div>
            <h1>{user.name}</h1>
            <div className="muted small">
              {ROLE_LABELS[user.role]} · <span className={`badge ${user.status}`}>{user.status}</span>
            </div>
          </div>
        </div>
        <dl className="kv small">
          <dt>Approved</dt>
          <dd>{user.approvedAt ? `${formatDateTime(user.approvedAt)} by ${approver?.name ?? "system"}` : "Not approved"}</dd>
          {user.deactivatedAt && (
            <>
              <dt>Deactivated</dt>
              <dd>
                {formatDateTime(user.deactivatedAt)} by {deactivator?.name ?? "—"}
              </dd>
            </>
          )}
          <dt>Source</dt>
          <dd>
            {user.source === "csv" ? "Google Form CSV import" : user.source}
            {user.formSubmittedAt && ` (form submitted ${user.formSubmittedAt})`}
          </dd>
          <dt>Password sign-in</dt>
          <dd>{user.passwordHash ? "Set up" : "Not set up"}</dd>
          <dt>Last sign-in</dt>
          <dd>{formatDateTime(user.lastLoginAt)}</dd>
        </dl>
      </div>
      <Flash sp={sp} />
      {!manage && (
        <div className="flash info">
          {can.manageTracking(actor.role) ? "Only a Super Admin can change staff accounts." : "You have read-only access."}
        </div>
      )}
      <div className="card">
        <h2>Details</h2>
        <UserForm action={updateUserAction} user={user} roles={roles} defaultRole={user.role} isNew={false} readOnly={!manage} />
      </div>
      {manage && (
        <div className="card">
          <h2>Access</h2>
          <div className="grid">
            {user.status === "pending" && (
              <div className="row">
                <form action={setActiveAction} className="inline-form">
                  <input type="hidden" name="id" value={user.id} />
                  <input type="hidden" name="active" value="true" />
                  <button type="submit">Approve</button>
                </form>
                <form action={rejectPendingAction} className="inline-form">
                  <input type="hidden" name="id" value={user.id} />
                  <button type="submit" className="danger">
                    Reject and remove applicant
                  </button>
                </form>
              </div>
            )}
            {user.status === "active" && (
              <>
                <div>
                  <p className="small muted">
                    If Google sign-in is enabled, the person can simply sign in with their company Google account. Otherwise send a
                    one-time setup link. Use the same button to reset a forgotten password.
                  </p>
                  <SetupLinkButton userId={user.id} hasPassword={Boolean(user.passwordHash)} />
                </div>
                {user.id !== actor.id && (
                  <form action={setActiveAction}>
                    <input type="hidden" name="id" value={user.id} />
                    <input type="hidden" name="active" value="false" />
                    <p className="small muted">
                      Deactivating signs the person out immediately, blocks sign-in and removes them from daily tracking. Their
                      history is kept.
                    </p>
                    <button type="submit" className="danger">
                      Deactivate
                    </button>
                  </form>
                )}
              </>
            )}
            {user.status === "inactive" && (
              <form action={setActiveAction}>
                <input type="hidden" name="id" value={user.id} />
                <input type="hidden" name="active" value="true" />
                <button type="submit">Reactivate</button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

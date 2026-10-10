import Link from "next/link";
import { requireUser } from "@/lib/session";
import { can, canManageUser, ROLE_LABELS } from "@/lib/permissions";
import { getDb } from "@/lib/db";
import { listRoster } from "@/lib/services/users";
import { formatDateTime } from "@/lib/time";
import { Flash, InstagramLink, first } from "@/components/ui";
import { approveSelectedAction } from "./actions";

type SP = Record<string, string | string[] | undefined>;

export default async function RosterPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireUser(can.viewDashboard);
  const sp = await searchParams;
  const status = ["active", "pending", "inactive", "all"].includes(first(sp, "status")) ? first(sp, "status") : "active";
  const q = first(sp, "q").trim();
  const role = first(sp, "role");
  const db = await getDb();
  const [rows, pendingCount] = await Promise.all([
    listRoster(db, actor, { q, status: status === "all" ? "" : status, role }),
    listRoster(db, actor, { status: "pending" }).then((r) => r.length),
  ]);
  const approvers = new Map((await listRoster(db, actor, {})).map((u) => [u.id, u.name]));
  const editable = can.manageTracking(actor.role);
  const tab = (s: string, label: string) => (
    <Link href={`/admin/users?status=${s}`} className={status === s ? "on" : ""}>
      {label}
    </Link>
  );
  const back = `/admin/users?status=${status}`;
  const showBulk = editable && status === "pending";

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Roster</h1>
          <p className="muted small" style={{ margin: 0 }}>
            Only approved, active people can sign in. Imported applicants wait in “Pending” until approved.
          </p>
        </div>
        {editable && (
          <div className="row">
            <Link href="/admin/users/new" className="btn">
              Add agent / manager
            </Link>
            {can.manageRoles(actor.role) && (
              <Link href="/admin/users/new?staff=1" className="btn btn-secondary">
                Invite staff (Admin / Viewer)
              </Link>
            )}
            <Link href="/admin/import" className="btn btn-secondary">
              Import CSV
            </Link>
          </div>
        )}
      </div>
      <Flash sp={sp} />
      <div className="tabs">
        {tab("active", "Active")}
        {tab("pending", `Pending approval (${pendingCount})`)}
        {tab("inactive", "Inactive")}
        {tab("all", "All")}
      </div>
      <form className="card filters" method="get">
        <input type="hidden" name="status" value={status} />
        <div className="field">
          <label htmlFor="q">Search</label>
          <input id="q" name="q" type="search" defaultValue={q} placeholder="Name, email, @handle, team" />
        </div>
        <div className="field">
          <label htmlFor="role">Access role</label>
          <select id="role" name="role" defaultValue={role}>
            <option value="">All</option>
            {Object.entries(ROLE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <button type="submit">Search</button>
        </div>
      </form>

      <form action={approveSelectedAction}>
        <input type="hidden" name="back" value={back} />
        {showBulk && rows.length > 0 && (
          <div className="row" style={{ marginBottom: "0.75rem" }}>
            <button type="submit">Approve selected</button>
            <span className="muted small">Review each applicant first. Approved people can sign in and are tracked from today.</span>
          </div>
        )}
        <div className="table-wrap">
          <table className="stack">
            <thead>
              <tr>
                {showBulk && <th>Select</th>}
                <th>Name</th>
                <th>Email</th>
                <th>Instagram</th>
                <th>Role</th>
                <th>Status</th>
                <th>Approved</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted">
                    Nobody here.
                  </td>
                </tr>
              )}
              {rows.map((u) => (
                <tr key={u.id}>
                  {showBulk && (
                    <td data-label="Select">
                      {canManageUser(actor, u) && <input type="checkbox" name="ids" value={u.id} aria-label={`Select ${u.name}`} />}
                    </td>
                  )}
                  <td data-label="Name">
                    <strong>{u.name}</strong>
                    <div className="muted small">{[u.position, u.team].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td data-label="Email" className="break">{u.email}</td>
                  <td data-label="Instagram">
                    <InstagramLink handle={u.instagramHandle} url={u.instagramUrl} />
                  </td>
                  <td data-label="Role">
                    {ROLE_LABELS[u.role]}
                    {u.trackingStatus === "exempt" && <div className="badge">Not tracked</div>}
                  </td>
                  <td data-label="Status">
                    <span className={`badge ${u.status}`}>{u.status}</span>
                  </td>
                  <td data-label="Approved" className="small">
                    {u.approvedAt ? (
                      <>
                        {formatDateTime(u.approvedAt)}
                        <div className="muted">by {approvers.get(u.approvedById ?? "") ?? "system"}</div>
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td data-label="">
                    <Link href={`/admin/users/${u.id}`}>{editable && canManageUser(actor, u) ? "Manage" : "View"}</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </form>
    </>
  );
}

import { inArray } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { recentAudit } from "@/lib/services/audit";
import { formatDateTime } from "@/lib/time";

export default async function AuditPage() {
  await requireUser(can.viewAuditLog);
  const db = await getDb();
  const rows = await recentAudit(db, 300);
  const ids = [...new Set(rows.flatMap((r) => [r.actorId, r.targetUserId]).filter(Boolean))] as string[];
  const names = new Map(
    ids.length ? (await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids))).map((u) => [u.id, u.name]) : [],
  );
  return (
    <>
      <h1>Audit log</h1>
      <p className="muted">Last 300 administrative actions (roster, roles, approvals, settings, exports, setup links).</p>
      <div className="table-wrap">
        <table className="stack">
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>Action</th>
              <th>Person</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td data-label="When" className="small nowrap">{formatDateTime(r.createdAt)}</td>
                <td data-label="Who">{r.actorId ? names.get(r.actorId) ?? "Deleted user" : "System"}</td>
                <td data-label="Action">
                  <code>{r.action}</code>
                </td>
                <td data-label="Person">{r.targetUserId ? names.get(r.targetUserId) ?? "—" : "—"}</td>
                <td data-label="Details" className="small break">{r.details ? JSON.stringify(r.details) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

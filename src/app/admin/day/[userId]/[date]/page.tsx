import Link from "next/link";
import { notFound } from "next/navigation";
import { inArray } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getUser } from "@/lib/services/users";
import { getDayDetail } from "@/lib/services/records";
import { getCalendar } from "@/lib/services/settings";
import { computeDayStatus } from "@/lib/status";
import { safePath } from "@/lib/actions";
import { formatDate, formatDateTime, isIsoDate, now } from "@/lib/time";
import { Flash, InstagramLink, PostLink, StatusBadge, first } from "@/components/ui";
import { addFollowupAction } from "../../../actions";

type SP = Record<string, string | string[] | undefined>;

const KIND_LABEL = { note: "Note", resolution: "Resolution", reviewed: "Post link reviewed" } as const;

export default async function DayDetail({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string; date: string }>;
  searchParams: Promise<SP>;
}) {
  const actor = await requireUser(can.viewDashboard);
  const { userId, date } = await params;
  const sp = await searchParams;
  if (!isIsoDate(date)) notFound();
  const db = await getDb();
  const person = await getUser(db, userId);
  if (!person || person.role !== "member") notFound();
  const [detail, cal] = await Promise.all([getDayDetail(db, actor, userId, date), getCalendar(db)]);
  const ids = [...new Set([...detail.history.map((h) => h.changedById), ...detail.notes.map((n) => n.authorId)].filter(Boolean))] as string[];
  const names = new Map(
    ids.length ? (await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids))).map((u) => [u.id, u.name]) : [],
  );
  const resolved = detail.notes.some((n) => n.kind === "resolution");
  const computed = computeDayStatus({ record: detail.record, resolved, cutoffAt: cal.cutoffAt(date), now: now() });
  const back = safePath(first(sp, "back"), `/admin?date=${date}`);
  const self = `/admin/day/${userId}/${date}?back=${encodeURIComponent(back)}`;
  const editable = can.manageTracking(actor.role);

  return (
    <div className="narrow" style={{ margin: "0 auto", maxWidth: 820 }}>
      <p>
        <Link href={back}>← Back to dashboard</Link>
      </p>
      <div className="card">
        <h1>{person.name}</h1>
        <p className="muted" style={{ marginBottom: "0.5rem" }}>
          {formatDate(date)} · <InstagramLink handle={person.instagramHandle} url={person.instagramUrl} /> · {person.email}
        </p>
        <StatusBadge computed={computed} />
        {!cal.isWorkingDay(date) && <p className="small muted">Not a tracked working day.</p>}
      </div>
      <Flash sp={sp} />

      <section className="card">
        <h2>Submitted update</h2>
        {detail.record ? (
          <dl className="kv">
            <dt>Status</dt>
            <dd>{detail.record.status === "posted" ? "Posted" : "Not posted"}</dd>
            <dt>Post link</dt>
            <dd>
              <PostLink url={detail.record.postUrl} />
              {detail.record.postUrl && <div className="small muted break">{detail.record.postUrl}</div>}
            </dd>
            <dt>Reason</dt>
            <dd>{detail.record.reason ?? "—"}</dd>
            <dt>First submitted</dt>
            <dd>{formatDateTime(detail.record.submittedAt)}</dd>
            <dt>Cutoff</dt>
            <dd>
              {formatDateTime(detail.record.cutoffAt)}{" "}
              {detail.record.submittedLate ? (
                <span className="badge no_update">Flagged “No update” at cutoff</span>
              ) : (
                <span className="badge posted">On time</span>
              )}
            </dd>
          </dl>
        ) : (
          <p className="muted">
            Nothing submitted.{" "}
            {computed.followUpNeeded ? "Flagged “No update — follow-up needed” since the cutoff." : computed.status === "awaiting" ? "Cutoff not reached yet." : ""}
          </p>
        )}
      </section>

      <section className="card">
        <h2>Record history</h2>
        {detail.history.length === 0 ? (
          <p className="muted">No changes recorded.</p>
        ) : (
          <ul className="history">
            {detail.history.map((h) => (
              <li key={h.id}>
                <div className="small muted">
                  {formatDateTime(h.changedAt)} · {names.get(h.changedById ?? "") ?? "Unknown"} · {h.action === "created" ? "submitted" : "corrected"}
                  {h.afterCutoff && " · after cutoff"}
                </div>
                {h.action === "updated" && (
                  <div className="small">
                    Before: {h.previousStatus === "posted" ? `Posted — ${h.previousPostUrl}` : `Not posted — ${h.previousReason}`}
                  </div>
                )}
                <div className="small">
                  {h.action === "updated" ? "After: " : ""}
                  {h.newStatus === "posted" ? `Posted — ${h.newPostUrl}` : `Not posted — ${h.newReason}`}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Internal follow-up notes</h2>
        <p className="muted small">Visible to Admins and Viewers only — never shown to the agent.</p>
        {detail.notes.length === 0 ? (
          <p className="muted">No notes yet.</p>
        ) : (
          <ul className="history">
            {detail.notes.map((n) => (
              <li key={n.id}>
                <div className="small muted">
                  {formatDateTime(n.createdAt)} · {names.get(n.authorId) ?? "Unknown"} · <strong>{KIND_LABEL[n.kind]}</strong>
                </div>
                <div style={{ whiteSpace: "pre-wrap" }}>{n.body}</div>
              </li>
            ))}
          </ul>
        )}
        {editable && (
          <form action={addFollowupAction} style={{ marginTop: "1rem" }}>
            <input type="hidden" name="userId" value={userId} />
            <input type="hidden" name="workDate" value={date} />
            <input type="hidden" name="back" value={self} />
            <div className="field">
              <label htmlFor="kind">Type</label>
              <select id="kind" name="kind" defaultValue={computed.followUpNeeded ? "resolution" : "note"}>
                <option value="note">Internal note</option>
                <option value="resolution">Resolve missing update (removes the follow-up flag)</option>
                <option value="reviewed">Post link reviewed</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="body">Note</label>
              <textarea id="body" name="body" maxLength={1000} placeholder="e.g. Called Sara — she posted a reel, will add the link tomorrow." />
            </div>
            <button type="submit">Save</button>
          </form>
        )}
      </section>
    </div>
  );
}

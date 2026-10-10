import Link from "next/link";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { getDb } from "@/lib/db";
import { getDayBoard, getOutstanding } from "@/lib/services/dashboard";
import { todayInDubai } from "@/lib/calendar";
import { getCalendar } from "@/lib/services/settings";
import { formatDate, formatDateTime, formatTime12, isIsoDate, now, addDays } from "@/lib/time";
import { Flash, InstagramLink, PostLink, StatusBadge, first } from "@/components/ui";
import { addFollowupAction } from "./actions";

type SP = Record<string, string | string[] | undefined>;

export default async function AdminDashboard({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser(can.viewDashboard);
  const sp = await searchParams;
  const at = now();
  const db = await getDb();
  const today = todayInDubai(at);
  const date = isIsoDate(first(sp, "date")) ? first(sp, "date") : today;
  const filters = { q: first(sp, "q").trim(), position: first(sp, "position"), team: first(sp, "team"), status: first(sp, "status") };
  const [board, outstanding, cal] = await Promise.all([
    getDayBoard(db, user, date, filters, at),
    date === today ? getOutstanding(db, user, at) : Promise.resolve([]),
    getCalendar(db),
  ]);
  const editable = can.manageTracking(user.role);
  const qs = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ date, ...filters, ...patch });
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    return `/admin?${p.toString()}`;
  };
  const back = qs({});
  const prevDay = cal.previousWorkingDay(date);
  let nextDay: string | null = null;
  for (let d = addDays(date, 1); d <= today; d = addDays(d, 1)) {
    if (cal.isWorkingDay(d)) {
      nextDay = d;
      break;
    }
  }
  const s = board.summary;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Daily content — {formatDate(date)}</h1>
          <div className="muted small">
            Cutoff {formatTime12(cal.config.cutoffTime)} Dubai time ·{" "}
            {board.pastCutoff ? "cutoff has passed: missing updates are flagged for follow-up" : "before cutoff: missing updates show as “Awaiting update”"}
          </div>
        </div>
        <div className="row">
          {prevDay && (
            <Link className="btn btn-secondary btn-small" href={qs({ date: prevDay })}>
              ← {formatDate(prevDay)}
            </Link>
          )}
          {date !== today && (
            <Link className="btn btn-secondary btn-small" href={qs({ date: today })}>
              Today
            </Link>
          )}
          {nextDay && (
            <Link className="btn btn-secondary btn-small" href={qs({ date: nextDay })}>
              {formatDate(nextDay)} →
            </Link>
          )}
        </div>
      </div>
      <Flash sp={sp} />
      {!board.isWorkingDay && (
        <div className="flash info">
          {board.isHoliday ? "This date is a configured holiday." : "This date is not a tracked working day."} Nobody is flagged for it.
        </div>
      )}

      {outstanding.length > 0 && (
        <section className="card" style={{ borderColor: "#f0b4b4" }}>
          <h2>Still missing from previous working days ({outstanding.length})</h2>
          <p className="muted small">
            These people had no update at the cutoff and haven&apos;t backfilled it. They stay here until they submit a late update or
            an Admin marks the day resolved.
          </p>
          <div className="table-wrap">
            <table className="stack">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Name</th>
                  <th>Instagram</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {outstanding.map((r) => (
                  <tr key={`${r.user.id}-${r.date}`} className="flagged">
                    <td data-label="Date" className="nowrap">{formatDate(r.date)}</td>
                    <td data-label="Name">{r.user.name}</td>
                    <td data-label="Instagram">
                      <InstagramLink handle={r.user.instagramHandle} url={r.user.instagramUrl} />
                    </td>
                    <td data-label="Action">
                      <Link href={`/admin/day/${r.user.id}/${r.date}?back=${encodeURIComponent(back)}`}>Follow up / resolve</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="stats">
        <Link href={qs({ status: "posted" })} className="stat ok">
          <div className="n">{s.posted}</div>
          <div className="l">Posted</div>
        </Link>
        <Link href={qs({ status: "not_posted" })} className="stat warn">
          <div className="n">{s.not_posted}</div>
          <div className="l">Not posted</div>
        </Link>
        <Link href={qs({ status: board.pastCutoff ? "no_update" : "awaiting" })} className="stat bad">
          <div className="n">{board.pastCutoff ? s.no_update : s.awaiting}</div>
          <div className="l">{board.pastCutoff ? "No update (follow-up)" : "No update yet"}</div>
        </Link>
        <Link href={qs({ status: "late" })} className="stat">
          <div className="n">{s.late}</div>
          <div className="l">Submitted late</div>
        </Link>
        <Link href={qs({ status: "resolved" })} className="stat">
          <div className="n">{s.resolved}</div>
          <div className="l">Resolved by admin</div>
        </Link>
        <Link href={qs({ status: "" })} className="stat">
          <div className="n">{s.total}</div>
          <div className="l">Tracked people</div>
        </Link>
      </div>

      <form className="card filters" method="get" action="/admin">
        <div className="field">
          <label htmlFor="date">Date</label>
          <input id="date" type="date" name="date" defaultValue={date} max={today} />
        </div>
        <div className="field">
          <label htmlFor="q">Search</label>
          <input id="q" type="search" name="q" defaultValue={filters.q} placeholder="Name, email or @handle" />
        </div>
        <div className="field">
          <label htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={filters.status}>
            <option value="">All</option>
            <option value="posted">Posted</option>
            <option value="not_posted">Not posted</option>
            <option value="no_update">No update (after cutoff)</option>
            <option value="awaiting">Awaiting update (before cutoff)</option>
            <option value="late">Submitted late</option>
            <option value="resolved">Resolved by admin</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="position">Role</label>
          <select id="position" name="position" defaultValue={filters.position}>
            <option value="">All</option>
            {board.positions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="team">Team</label>
          <select id="team" name="team" defaultValue={filters.team}>
            <option value="">All</option>
            {board.teams.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <button type="submit">Apply</button>
          <Link href={`/admin?date=${date}`} className="btn btn-secondary">
            Clear
          </Link>
        </div>
      </form>

      <p className="muted small">
        Showing {board.rows.length} of {s.total} active tracked people.
      </p>
      <div className="table-wrap">
        <table className="stack">
          <thead>
            <tr>
              <th>Name</th>
              <th>Instagram</th>
              <th>Status</th>
              <th>Post link / reason</th>
              <th>Updated</th>
              <th>Follow-up</th>
            </tr>
          </thead>
          <tbody>
            {board.rows.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  Nobody matches these filters.
                </td>
              </tr>
            )}
            {board.rows.map((r) => {
              const lastNote = r.notes[r.notes.length - 1];
              const detail = `/admin/day/${r.user.id}/${r.date}?back=${encodeURIComponent(back)}`;
              return (
                <tr key={r.user.id} className={r.computed.followUpNeeded ? "flagged" : undefined}>
                  <td data-label="Name">
                    <strong>{r.user.name}</strong>
                    <div className="muted small">{[r.user.position, r.user.team].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td data-label="Instagram">
                    <InstagramLink handle={r.user.instagramHandle} url={r.user.instagramUrl} />
                  </td>
                  <td data-label="Status">
                    <StatusBadge computed={r.computed} />
                    {r.reviewed && <div className="small muted">✓ link reviewed</div>}
                  </td>
                  <td data-label="Post link / reason">
                    {r.record?.status === "posted" ? <PostLink url={r.record.postUrl} /> : r.record?.reason ?? <span className="muted">—</span>}
                  </td>
                  <td data-label="Updated" className="small">
                    {r.record ? (
                      <>
                        {formatDateTime(r.record.submittedAt)}
                        {r.record.version > 1 && <div className="muted">edited {formatDateTime(r.record.updatedAt)}</div>}
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td data-label="Follow-up" className="small">
                    {lastNote && (
                      <div className="muted" title={lastNote.body}>
                        {lastNote.kind === "resolution" ? "Resolved: " : ""}
                        {lastNote.body.length > 60 ? lastNote.body.slice(0, 60) + "…" : lastNote.body}
                      </div>
                    )}
                    <div className="row" style={{ marginTop: "0.25rem" }}>
                      <Link href={detail}>{editable ? "Details / note" : "Details"}</Link>
                      {editable && r.record?.status === "posted" && !r.reviewed && (
                        <form action={addFollowupAction} className="inline-form">
                          <input type="hidden" name="userId" value={r.user.id} />
                          <input type="hidden" name="workDate" value={r.date} />
                          <input type="hidden" name="kind" value="reviewed" />
                          <input type="hidden" name="body" value="" />
                          <input type="hidden" name="back" value={back} />
                          <button type="submit" className="secondary small">
                            Mark reviewed
                          </button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { getDb } from "@/lib/db";
import { getOwnHistory } from "@/lib/services/dashboard";
import { submitOwnUpdate } from "@/lib/services/records";
import { allowedSubmissionDates, todayInDubai } from "@/lib/calendar";
import { runAction, str } from "@/lib/actions";
import { formatDate, formatDateTime, formatTime12, now } from "@/lib/time";
import { Flash, InstagramLink, PostLink, StatusBadge } from "@/components/ui";
import type { DailyRecord } from "@/lib/db/schema";
import type { DayStatusResult } from "@/lib/status";

async function submitUpdate(form: FormData) {
  "use server";
  const user = await requireUser(can.submitOwnUpdates);
  await runAction("/me", async () => {
    const status = str(form, "status");
    await submitOwnUpdate(
      await getDb(),
      user,
      {
        workDate: str(form, "workDate"),
        status: status as "posted" | "not_posted",
        postUrl: str(form, "postUrl"),
        reason: str(form, "reason"),
        expectedVersion: Number(str(form, "expectedVersion") || "0"),
      },
      now(),
    );
    return "Thanks — your update was saved.";
  });
}

function UpdateForm({ date, record, label }: { date: string; record: DailyRecord | null; label: string }) {
  const id = `f-${date}`;
  return (
    <form action={submitUpdate} className="update-form">
      <input type="hidden" name="workDate" value={date} />
      <input type="hidden" name="expectedVersion" value={record?.version ?? 0} />
      <fieldset>
        <legend className="small muted" style={{ marginBottom: "0.4rem" }}>
          {label}
        </legend>
        <div className="choice">
          <label>
            <input type="radio" name="status" value="posted" required defaultChecked={record?.status === "posted"} /> Posted
          </label>
          <label>
            <input type="radio" name="status" value="not_posted" required defaultChecked={record?.status === "not_posted"} /> Not posted
          </label>
        </div>
      </fieldset>
      <div className="field link-field">
        <label htmlFor={`${id}-url`}>
          Link to your post or reel <span className="hint">required if you posted — e.g. https://www.instagram.com/reel/…</span>
        </label>
        <input id={`${id}-url`} name="postUrl" type="url" inputMode="url" defaultValue={record?.postUrl ?? ""} placeholder="https://www.instagram.com/p/..." />
      </div>
      <div className="field reason-field">
        <label htmlFor={`${id}-reason`}>
          Short reason <span className="hint">required if you didn&apos;t post</span>
        </label>
        <textarea id={`${id}-reason`} name="reason" maxLength={500} defaultValue={record?.reason ?? ""} />
      </div>
      <button type="submit">{record ? "Save correction" : "Submit update"}</button>
    </form>
  );
}

function DayCard({
  title,
  date,
  row,
  canEdit,
  cutoffLabel,
  isLateWindow,
}: {
  title: string;
  date: string;
  row: { record: DailyRecord | null; computed: DayStatusResult } | undefined;
  canEdit: boolean;
  cutoffLabel: string;
  isLateWindow: boolean;
}) {
  const record = row?.record ?? null;
  return (
    <section className="card">
      <div className="page-head" style={{ marginBottom: "0.5rem" }}>
        <div>
          <h2 style={{ marginBottom: 0 }}>{title}</h2>
          <div className="muted small">{formatDate(date)}</div>
        </div>
        {row && <StatusBadge computed={row.computed} followUpText={false} />}
      </div>
      {record ? (
        <>
          <dl className="kv">
            <dt>Status</dt>
            <dd>{record.status === "posted" ? "Posted" : "Not posted"}</dd>
            {record.status === "posted" ? (
              <>
                <dt>Post link</dt>
                <dd>
                  <PostLink url={record.postUrl} />
                </dd>
              </>
            ) : (
              <>
                <dt>Reason</dt>
                <dd>{record.reason}</dd>
              </>
            )}
            <dt>Content date</dt>
            <dd>{formatDate(record.workDate)}</dd>
            <dt>Submitted</dt>
            <dd>
              {formatDateTime(record.submittedAt)}
              {record.submittedLate && " (after the cutoff)"}
            </dd>
            {record.version > 1 && (
              <>
                <dt>Last corrected</dt>
                <dd>{formatDateTime(record.updatedAt)}</dd>
              </>
            )}
          </dl>
          {canEdit && (
            <details style={{ marginTop: "0.75rem" }}>
              <summary>Correct this update</summary>
              <div style={{ marginTop: "0.75rem" }}>
                <UpdateForm date={date} record={record} label="Your previous answer is kept in the history." />
              </div>
            </details>
          )}
        </>
      ) : canEdit ? (
        <>
          {isLateWindow ? (
            <p className="flash warn small">
              No update was received for this day by the {cutoffLabel} cutoff. You can still add it now — it will be marked as{" "}
              <strong>submitted late</strong>.
            </p>
          ) : (
            <p className="muted small">Please update before {cutoffLabel} (Dubai time).</p>
          )}
          <UpdateForm date={date} record={null} label="Did you post today’s content on Instagram?" />
        </>
      ) : (
        <p className="muted">This day can no longer be updated here. Contact the content team if something is wrong.</p>
      )}
    </section>
  );
}

export default async function MyPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser();
  if (!can.submitOwnUpdates(user.role)) redirect("/admin");
  const sp = await searchParams;
  const at = now();
  const db = await getDb();
  const { cal, rows } = await getOwnHistory(db, user, at, 20);
  const today = todayInDubai(at);
  const allowed = allowedSubmissionDates(cal, at, user.trackingStartDate);
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const cutoffLabel = formatTime12(cal.config.cutoffTime);
  const tracked = user.trackingStatus === "tracked";

  return (
    <div className="narrow" style={{ margin: "0 auto" }}>
      <div className="card">
        <h1>Welcome, {user.name.split(" ")[0]}</h1>
        <p style={{ marginBottom: "0.25rem" }}>
          Instagram: <InstagramLink handle={user.instagramHandle} url={user.instagramUrl} />
        </p>
        <p className="muted small" style={{ margin: 0 }}>
          Today is {formatDate(today)} (Dubai). Daily cutoff: {cutoffLabel}.
          {!cal.isWorkingDay(today) && " Today is not a tracked working day."}
        </p>
      </div>
      <Flash sp={sp} />
      {!tracked ? (
        <div className="flash info">Your daily tracking is currently paused{user.trackingNote ? `: ${user.trackingNote}` : "."}</div>
      ) : (
        <>
          {allowed.today && (
            <DayCard title="Today" date={allowed.today} row={byDate.get(allowed.today)} canEdit cutoffLabel={cutoffLabel} isLateWindow={cal.isPastCutoff(allowed.today, at)} />
          )}
          {allowed.previous && (
            <DayCard
              title="Previous working day"
              date={allowed.previous}
              row={byDate.get(allowed.previous)}
              canEdit
              cutoffLabel={cutoffLabel}
              isLateWindow={cal.isPastCutoff(allowed.previous, at)}
            />
          )}
        </>
      )}
      <section className="card">
        <h2>My recent working days</h2>
        {rows.length === 0 ? (
          <p className="muted">No tracked days yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="stack">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Status</th>
                  <th>Post / reason</th>
                  <th>Submitted</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.date}>
                    <td data-label="Date" className="nowrap">{formatDate(r.date)}</td>
                    <td data-label="Status">
                      <StatusBadge computed={r.computed} followUpText={false} />
                    </td>
                    <td data-label="Post / reason">
                      {r.record?.status === "posted" ? <PostLink url={r.record.postUrl} /> : r.record?.reason ?? <span className="muted">—</span>}
                    </td>
                    <td data-label="Submitted" className="small">{formatDateTime(r.record?.submittedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

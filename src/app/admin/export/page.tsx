import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { todayInDubai } from "@/lib/calendar";
import { addDays, now } from "@/lib/time";

export default async function ExportPage() {
  await requireUser(can.exportCsv);
  const today = todayInDubai(now());
  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <h1>Export report (CSV)</h1>
      <p className="muted">
        One row per tracked person per working day, with status, post link, reason, submission time, late flag and internal
        notes. Opens in Excel or Google Sheets. Treat the file as confidential.
      </p>
      <form method="get" action="/api/export" className="card filters">
        <div className="field">
          <label htmlFor="from">From</label>
          <input id="from" name="from" type="date" defaultValue={addDays(today, -6)} max={today} required />
        </div>
        <div className="field">
          <label htmlFor="to">To</label>
          <input id="to" name="to" type="date" defaultValue={today} max={today} required />
        </div>
        <div className="field">
          <label htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue="">
            <option value="">All</option>
            <option value="posted">Posted</option>
            <option value="not_posted">Not posted</option>
            <option value="no_update">No update</option>
            <option value="late">Submitted late</option>
            <option value="resolved">Resolved by admin</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="q">Name / handle contains</label>
          <input id="q" name="q" type="search" />
        </div>
        <div className="row">
          <button type="submit">Download CSV</button>
        </div>
      </form>
    </div>
  );
}

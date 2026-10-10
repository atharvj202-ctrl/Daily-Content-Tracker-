import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { getDb } from "@/lib/db";
import { getCalendar, listHolidays, updateWorkingSettings, addHoliday, removeHoliday } from "@/lib/services/settings";
import { runAction, str } from "@/lib/actions";
import { WEEKDAY_NAMES, formatDate, formatTime12, now } from "@/lib/time";
import { Flash } from "@/components/ui";

async function saveSettings(form: FormData) {
  "use server";
  const actor = await requireUser(can.manageTracking);
  await runAction("/admin/settings", async () => {
    await updateWorkingSettings(
      await getDb(),
      actor,
      { workingDays: form.getAll("workingDays").map(Number), cutoffTime: str(form, "cutoffTime") },
      now(),
    );
    return "Working days saved.";
  });
}

async function addHolidayAction(form: FormData) {
  "use server";
  const actor = await requireUser(can.manageTracking);
  await runAction("/admin/settings", async () => {
    await addHoliday(await getDb(), actor, { date: str(form, "date"), name: str(form, "name") });
    return "Holiday added.";
  });
}

async function removeHolidayAction(form: FormData) {
  "use server";
  const actor = await requireUser(can.manageTracking);
  await runAction("/admin/settings", async () => {
    await removeHoliday(await getDb(), actor, str(form, "date"));
    return "Holiday removed.";
  });
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const actor = await requireUser(can.viewDashboard);
  const sp = await searchParams;
  const db = await getDb();
  const [cal, hols] = await Promise.all([getCalendar(db), listHolidays(db)]);
  const editable = can.manageTracking(actor.role);
  return (
    <div style={{ maxWidth: 820, margin: "0 auto" }}>
      <h1>Tracking settings</h1>
      <p className="muted">All dates and times use the Asia/Dubai time zone.</p>
      <Flash sp={sp} />
      <form action={saveSettings} className="card">
        <h2>Working days and cutoff</h2>
        <fieldset disabled={!editable}>
          <div className="field">
            <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>Tracked working days</span>
            <div className="row" style={{ marginTop: "0.4rem" }}>
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <label key={d} className="checkbox" style={{ marginRight: "0.75rem" }}>
                  <input type="checkbox" name="workingDays" value={d} defaultChecked={cal.config.workingDays.includes(d)} />
                  {WEEKDAY_NAMES[d]}
                </label>
              ))}
            </div>
          </div>
          <div className="field" style={{ maxWidth: 220 }}>
            <label htmlFor="cutoffTime">
              Daily cutoff <span className="hint">currently {formatTime12(cal.config.cutoffTime)}</span>
            </label>
            <input id="cutoffTime" name="cutoffTime" type="time" defaultValue={cal.config.cutoffTime} required />
          </div>
          {editable && <button type="submit">Save</button>}
        </fieldset>
        <p className="muted small" style={{ marginTop: "0.75rem" }}>
          Changes apply to how the dashboard flags days. Updates already submitted keep the cutoff that applied when they were
          submitted.
        </p>
      </form>

      <div className="card">
        <h2>Holidays (not tracked)</h2>
        {hols.length === 0 ? (
          <p className="muted">No holidays configured.</p>
        ) : (
          <ul className="history">
            {hols.map((h) => (
              <li key={h.date} className="row" style={{ justifyContent: "space-between" }}>
                <span>
                  <strong>{formatDate(h.date)}</strong> — {h.name}
                </span>
                {editable && (
                  <form action={removeHolidayAction} className="inline-form">
                    <input type="hidden" name="date" value={h.date} />
                    <button type="submit" className="danger small">
                      Remove
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        {editable && (
          <form action={addHolidayAction} className="filters" style={{ marginTop: "1rem" }}>
            <div className="field">
              <label htmlFor="date">Date</label>
              <input id="date" name="date" type="date" required />
            </div>
            <div className="field">
              <label htmlFor="name">Name</label>
              <input id="name" name="name" type="text" maxLength={100} placeholder="e.g. National Day" />
            </div>
            <div className="row">
              <button type="submit">Add holiday</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

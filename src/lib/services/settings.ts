import { asc, eq } from "drizzle-orm";
import type { DB } from "../db";
import { appSettings, holidays, type User } from "../db/schema";
import { WorkCalendar, DEFAULT_CALENDAR } from "../calendar";
import { can, assert, ValidationError } from "../permissions";
import { isIsoDate, isTimeOfDay } from "../time";
import { cleanText } from "../validation";
import { audit } from "./audit";

export async function getSettingsRow(db: DB) {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.id, 1));
  if (row) return row;
  await db.insert(appSettings).values({ id: 1 }).onConflictDoNothing();
  const [created] = await db.select().from(appSettings).where(eq(appSettings.id, 1));
  return created;
}

export async function listHolidays(db: DB) {
  return db.select().from(holidays).orderBy(asc(holidays.date));
}

export async function getCalendar(db: DB): Promise<WorkCalendar> {
  const [row, hols] = await Promise.all([getSettingsRow(db), listHolidays(db)]);
  const workingDays = row.workingDays
    .split(",")
    .map((d) => Number(d))
    .filter((d) => d >= 1 && d <= 7);
  return new WorkCalendar({
    workingDays: workingDays.length ? workingDays : DEFAULT_CALENDAR.workingDays,
    cutoffTime: isTimeOfDay(row.cutoffTime) ? row.cutoffTime : DEFAULT_CALENDAR.cutoffTime,
    holidays: hols.map((h) => h.date),
  });
}

export async function updateWorkingSettings(
  db: DB,
  actor: User,
  input: { workingDays: number[]; cutoffTime: string },
  at: Date,
) {
  assert(can.manageTracking(actor.role));
  const days = [...new Set(input.workingDays)].filter((d) => Number.isInteger(d) && d >= 1 && d <= 7).sort();
  if (!days.length) throw new ValidationError("Choose at least one working day.");
  if (!isTimeOfDay(input.cutoffTime)) throw new ValidationError("Cutoff time must be HH:MM (24-hour).");
  await getSettingsRow(db);
  await db
    .update(appSettings)
    .set({ workingDays: days.join(","), cutoffTime: input.cutoffTime, updatedAt: at, updatedById: actor.id })
    .where(eq(appSettings.id, 1));
  await audit(db, actor, "settings.update", null, { workingDays: days, cutoffTime: input.cutoffTime });
}

export async function addHoliday(db: DB, actor: User, input: { date: string; name: string }) {
  assert(can.manageTracking(actor.role));
  if (!isIsoDate(input.date)) throw new ValidationError("Enter a valid date.");
  const name = cleanText(input.name, 100) || "Holiday";
  await db
    .insert(holidays)
    .values({ date: input.date, name, createdById: actor.id })
    .onConflictDoUpdate({ target: holidays.date, set: { name } });
  await audit(db, actor, "holiday.add", null, input);
}

export async function removeHoliday(db: DB, actor: User, date: string) {
  assert(can.manageTracking(actor.role));
  if (!isIsoDate(date)) throw new ValidationError("Invalid date.");
  await db.delete(holidays).where(eq(holidays.date, date));
  await audit(db, actor, "holiday.remove", null, { date });
}

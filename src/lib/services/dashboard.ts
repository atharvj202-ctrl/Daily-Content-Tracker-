import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import type { DB } from "../db";
import { dailyRecords, followups, users, type DailyRecord, type Followup, type User } from "../db/schema";
import { can, assert, ValidationError } from "../permissions";
import { computeDayStatus, type DayStatus, type DayStatusResult } from "../status";
import { WorkCalendar, todayInDubai } from "../calendar";
import { getCalendar } from "./settings";
import { addDays, isIsoDate } from "../time";

export interface BoardRow {
  user: User;
  date: string;
  record: DailyRecord | null;
  notes: Followup[];
  resolved: boolean;
  reviewed: boolean;
  computed: DayStatusResult;
}

export interface BoardFilters {
  q?: string;
  position?: string;
  team?: string;
  status?: string;
}

/** Active, tracked Agents/Managers whose tracking had started by `date`. */
async function trackedUsers(db: DB) {
  return db
    .select()
    .from(users)
    .where(and(eq(users.role, "member"), eq(users.status, "active"), eq(users.trackingStatus, "tracked")))
    .orderBy(asc(users.name));
}

function trackedOn(u: User, date: string) {
  return !u.trackingStartDate || u.trackingStartDate <= date;
}

async function loadRange(db: DB, userIds: string[], from: string, to: string) {
  if (!userIds.length) return { records: [] as DailyRecord[], notes: [] as Followup[] };
  const [records, notes] = await Promise.all([
    db
      .select()
      .from(dailyRecords)
      .where(and(inArray(dailyRecords.userId, userIds), gte(dailyRecords.workDate, from), lte(dailyRecords.workDate, to))),
    db
      .select()
      .from(followups)
      .where(and(inArray(followups.userId, userIds), gte(followups.workDate, from), lte(followups.workDate, to)))
      .orderBy(asc(followups.createdAt)),
  ]);
  return { records, notes };
}

function buildRows(people: User[], dates: string[], cal: WorkCalendar, records: DailyRecord[], notes: Followup[], at: Date) {
  const recordMap = new Map(records.map((r) => [`${r.userId}|${r.workDate}`, r]));
  const notesMap = new Map<string, Followup[]>();
  for (const n of notes) {
    const k = `${n.userId}|${n.workDate}`;
    notesMap.set(k, [...(notesMap.get(k) ?? []), n]);
  }
  const rows: BoardRow[] = [];
  for (const date of dates) {
    const cutoffAt = cal.cutoffAt(date);
    for (const user of people) {
      if (!trackedOn(user, date)) continue;
      const k = `${user.id}|${date}`;
      const record = recordMap.get(k) ?? null;
      const n = notesMap.get(k) ?? [];
      const resolved = n.some((x) => x.kind === "resolution");
      rows.push({
        user,
        date,
        record,
        notes: n,
        resolved,
        reviewed: n.some((x) => x.kind === "reviewed"),
        computed: computeDayStatus({ record, resolved, cutoffAt, now: at }),
      });
    }
  }
  return rows;
}

export function matchesFilters(row: BoardRow, f: BoardFilters) {
  if (f.q) {
    const q = f.q.toLowerCase().replace(/^@/, "");
    const hay = [row.user.name, row.user.email, row.user.instagramHandle ?? ""].join(" ").toLowerCase();
    if (!hay.includes(q)) return false;
  }
  if (f.position && (row.user.position ?? "").toLowerCase() !== f.position.toLowerCase()) return false;
  if (f.team && (row.user.team ?? "").toLowerCase() !== f.team.toLowerCase()) return false;
  if (f.status) {
    if (f.status === "late") return row.computed.late;
    if (f.status === "followup") return row.computed.followUpNeeded;
    if (row.computed.status !== (f.status as DayStatus)) return false;
  }
  return true;
}

export function summarize(rows: BoardRow[]) {
  const c = { total: rows.length, posted: 0, not_posted: 0, no_update: 0, awaiting: 0, resolved: 0, late: 0 };
  for (const r of rows) {
    c[r.computed.status]++;
    if (r.computed.late) c.late++;
  }
  return c;
}

export async function getDayBoard(db: DB, actor: User, date: string, filters: BoardFilters, at: Date) {
  assert(can.viewDashboard(actor.role));
  if (!isIsoDate(date)) throw new ValidationError("Invalid date.");
  const cal = await getCalendar(db);
  const people = await trackedUsers(db);
  const { records, notes } = await loadRange(db, people.map((p) => p.id), date, date);
  const all = buildRows(people, [date], cal, records, notes, at);
  const rows = all.filter((r) => matchesFilters(r, filters));
  const positions = [...new Set(people.map((p) => p.position).filter(Boolean))].sort() as string[];
  const teams = [...new Set(people.map((p) => p.team).filter(Boolean))].sort() as string[];
  return {
    date,
    isWorkingDay: cal.isWorkingDay(date),
    isHoliday: cal.isHoliday(date),
    cutoffAt: cal.cutoffAt(date),
    pastCutoff: cal.isPastCutoff(date, at),
    previousWorkingDay: cal.previousWorkingDay(date),
    rows,
    summary: summarize(all),
    filteredSummary: summarize(rows),
    positions,
    teams,
  };
}

/**
 * Missing updates (past the cutoff, not backfilled, not resolved) over the last
 * `lookback` working days, excluding today. Shown on the dashboard until handled.
 */
export async function getOutstanding(db: DB, actor: User, at: Date, lookback = 10) {
  assert(can.viewDashboard(actor.role));
  const cal = await getCalendar(db);
  const today = todayInDubai(at);
  const dates = cal.recentWorkingDays(addDays(today, -1), lookback).reverse();
  if (!dates.length) return [];
  const people = await trackedUsers(db);
  const { records, notes } = await loadRange(db, people.map((p) => p.id), dates[0], dates[dates.length - 1]);
  return buildRows(people, dates, cal, records, notes, at)
    .filter((r) => r.computed.followUpNeeded)
    .sort((a, b) => (a.date === b.date ? a.user.name.localeCompare(b.user.name) : b.date.localeCompare(a.date)));
}

export const MAX_EXPORT_DAYS = 370;

export async function getRangeRows(db: DB, actor: User, from: string, to: string, filters: BoardFilters, at: Date) {
  assert(can.exportCsv(actor.role));
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) throw new ValidationError("Choose a valid date range.");
  if (addDays(from, MAX_EXPORT_DAYS) < to) throw new ValidationError("Export at most about one year at a time.");
  const cal = await getCalendar(db);
  const dates = cal.workingDaysBetween(from, to);
  const people = await trackedUsers(db);
  const { records, notes } = await loadRange(db, people.map((p) => p.id), from, to);
  // Include records on non-working days too (e.g. a holiday someone still posted on).
  const extraDates = [...new Set(records.map((r) => r.workDate))].filter((d) => !dates.includes(d));
  const rows = buildRows(people, [...dates, ...extraDates].sort(), cal, records, notes, at);
  return rows.filter((r) => matchesFilters(r, filters) && (cal.isWorkingDay(r.date) || r.record));
}

/** A member's own history for the agent page. */
export async function getOwnHistory(db: DB, actor: User, at: Date, days = 20) {
  const cal = await getCalendar(db);
  const today = todayInDubai(at);
  const dates = cal.recentWorkingDays(today, days).filter((d) => trackedOn(actor, d));
  if (!dates.length) return { cal, rows: [] as { date: string; record: DailyRecord | null; computed: DayStatusResult }[] };
  const records = await db
    .select()
    .from(dailyRecords)
    .where(and(eq(dailyRecords.userId, actor.id), gte(dailyRecords.workDate, dates[dates.length - 1]), lte(dailyRecords.workDate, today)));
  const resolvedRows = await db
    .select({ workDate: followups.workDate })
    .from(followups)
    .where(
      and(
        eq(followups.userId, actor.id),
        eq(followups.kind, "resolution"),
        gte(followups.workDate, dates[dates.length - 1]),
        lte(followups.workDate, today),
      ),
    );
  const resolved = new Set(resolvedRows.map((r) => r.workDate));
  const map = new Map(records.map((r) => [r.workDate, r]));
  return {
    cal,
    rows: dates.map((date) => {
      const record = map.get(date) ?? null;
      return {
        date,
        record,
        computed: computeDayStatus({ record, resolved: resolved.has(date), cutoffAt: cal.cutoffAt(date), now: at }),
      };
    }),
  };
}

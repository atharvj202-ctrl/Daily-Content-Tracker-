import { addDays, dateInZone, isoWeekday, zonedTimeToUtc, TIME_ZONE } from "./time";

export interface CalendarConfig {
  /** ISO weekdays that are tracked (1 = Mon ... 7 = Sun). */
  workingDays: number[];
  /** Holiday dates (YYYY-MM-DD) that are never tracked. */
  holidays: string[];
  /** Daily cutoff, "HH:MM" in Asia/Dubai. */
  cutoffTime: string;
}

export const DEFAULT_CALENDAR: CalendarConfig = {
  workingDays: [1, 2, 3, 4, 5],
  holidays: [],
  cutoffTime: "19:00",
};

// Upper bound when walking backwards, so a misconfigured calendar
// (e.g. no working days) can never loop forever.
const MAX_LOOKBACK_DAYS = 60;

export class WorkCalendar {
  private readonly days: Set<number>;
  private readonly holidaySet: Set<string>;

  constructor(readonly config: CalendarConfig) {
    this.days = new Set(config.workingDays);
    this.holidaySet = new Set(config.holidays);
  }

  isWorkingDay(date: string): boolean {
    return this.days.has(isoWeekday(date)) && !this.holidaySet.has(date);
  }

  isHoliday(date: string): boolean {
    return this.holidaySet.has(date);
  }

  /** The instant of the cutoff (default 7:00 PM Dubai) for a date. */
  cutoffAt(date: string): Date {
    return zonedTimeToUtc(date, this.config.cutoffTime, TIME_ZONE);
  }

  isPastCutoff(date: string, instant: Date): boolean {
    return instant.getTime() >= this.cutoffAt(date).getTime();
  }

  /** Most recent working day strictly before `date`, or null. */
  previousWorkingDay(date: string): string | null {
    for (let i = 1; i <= MAX_LOOKBACK_DAYS; i++) {
      const d = addDays(date, -i);
      if (this.isWorkingDay(d)) return d;
    }
    return null;
  }

  /** Working days in [from, to], inclusive, ascending. */
  workingDaysBetween(from: string, to: string): string[] {
    const out: string[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      if (this.isWorkingDay(d)) out.push(d);
    }
    return out;
  }

  /** The last `count` working days ending at (and including) `end`, newest first. */
  recentWorkingDays(end: string, count: number): string[] {
    const out: string[] = [];
    let d = end;
    for (let i = 0; i < count * 3 + MAX_LOOKBACK_DAYS && out.length < count; i++) {
      if (this.isWorkingDay(d)) out.push(d);
      d = addDays(d, -1);
    }
    return out;
  }
}

export function todayInDubai(instant: Date): string {
  return dateInZone(instant, TIME_ZONE);
}

/**
 * Dates an Agent/Manager may submit or correct, as of `instant`:
 *  - today, if today is a tracked working day;
 *  - the previous working day (a late update / backfill).
 * Dates before the person's tracking start date are excluded.
 */
export function allowedSubmissionDates(
  cal: WorkCalendar,
  instant: Date,
  trackingStartDate: string | null,
): { today: string | null; previous: string | null } {
  const today = todayInDubai(instant);
  const started = (d: string | null) => (d && (!trackingStartDate || d >= trackingStartDate) ? d : null);
  return {
    today: started(cal.isWorkingDay(today) ? today : null),
    previous: started(cal.previousWorkingDay(today)),
  };
}

import type { PostStatus } from "./db/schema";

/**
 * Display status for one person on one tracked date.
 *  - posted / not_posted: what the person submitted (never inferred).
 *  - no_update: nothing submitted and the cutoff has passed -> follow-up needed.
 *  - resolved: nothing submitted, but an Admin recorded a resolution.
 *  - awaiting: nothing submitted yet and the cutoff has not passed.
 */
export type DayStatus = "posted" | "not_posted" | "no_update" | "resolved" | "awaiting";

export interface DayStatusInput {
  record: { status: PostStatus; submittedLate: boolean } | null;
  resolved: boolean;
  cutoffAt: Date;
  now: Date;
}

export interface DayStatusResult {
  status: DayStatus;
  /** The person submitted after the cutoff (record exists, flagged late). */
  late: boolean;
  /** At the cutoff there was no update (true for late submissions too). */
  missedCutoff: boolean;
  /** Shows on the Admin follow-up list. */
  followUpNeeded: boolean;
}

export function computeDayStatus({ record, resolved, cutoffAt, now }: DayStatusInput): DayStatusResult {
  const pastCutoff = now.getTime() >= cutoffAt.getTime();
  if (record) {
    return {
      status: record.status,
      late: record.submittedLate,
      missedCutoff: record.submittedLate,
      followUpNeeded: false,
    };
  }
  if (!pastCutoff) {
    return { status: "awaiting", late: false, missedCutoff: false, followUpNeeded: false };
  }
  if (resolved) {
    return { status: "resolved", late: false, missedCutoff: true, followUpNeeded: false };
  }
  return { status: "no_update", late: false, missedCutoff: true, followUpNeeded: true };
}

export const STATUS_LABELS: Record<DayStatus, string> = {
  posted: "Posted",
  not_posted: "Not posted",
  no_update: "No update",
  resolved: "Resolved by admin",
  awaiting: "Awaiting update",
};

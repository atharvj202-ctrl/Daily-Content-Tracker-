import { and, asc, eq } from "drizzle-orm";
import type { DB } from "../db";
import { dailyRecords, recordHistory, followups, users, type User, type PostStatus } from "../db/schema";
import { can, assert, ValidationError, PermissionError } from "../permissions";
import { allowedSubmissionDates } from "../calendar";
import { getCalendar } from "./settings";
import { normalizePostUrl, cleanText, REASON_MIN, REASON_MAX } from "../validation";
import { isIsoDate } from "../time";

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

export interface SubmitInput {
  workDate: string;
  status: PostStatus;
  postUrl?: string | null;
  reason?: string | null;
  /** 0 when creating; the record's current version when correcting. */
  expectedVersion: number;
}

export function validateSubmission(input: Pick<SubmitInput, "status" | "postUrl" | "reason">) {
  if (input.status === "posted") {
    const postUrl = normalizePostUrl(input.postUrl);
    if (!postUrl) throw new ValidationError("Paste the direct link to your Instagram post or reel (instagram.com/p/… or /reel/…).");
    return { status: "posted" as const, postUrl, reason: null };
  }
  if (input.status === "not_posted") {
    const reason = cleanText(input.reason, REASON_MAX);
    if (reason.length < REASON_MIN) throw new ValidationError("Please give a short reason.");
    return { status: "not_posted" as const, postUrl: null, reason };
  }
  throw new ValidationError("Choose Posted or Not posted.");
}

/**
 * An Agent/Manager submits or corrects their own update for today or the
 * previous working day. Duplicate submissions never silently overwrite:
 * a correction must carry the version the person was looking at.
 */
export async function submitOwnUpdate(db: DB, actor: User, input: SubmitInput, at: Date) {
  if (!can.submitOwnUpdates(actor.role) || actor.status !== "active") throw new PermissionError();
  if (actor.trackingStatus !== "tracked") throw new ValidationError("Your account is not currently tracked. Contact the content team.");
  if (!isIsoDate(input.workDate)) throw new ValidationError("Invalid date.");
  const cal = await getCalendar(db);
  const allowed = allowedSubmissionDates(cal, at, actor.trackingStartDate);
  if (input.workDate !== allowed.today && input.workDate !== allowed.previous) {
    throw new ValidationError("You can only update today or the previous working day. Contact the content team for older dates.");
  }
  const clean = validateSubmission(input);
  const cutoffAt = cal.cutoffAt(input.workDate);
  const afterCutoff = at.getTime() >= cutoffAt.getTime();

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(dailyRecords)
      .where(and(eq(dailyRecords.userId, actor.id), eq(dailyRecords.workDate, input.workDate)))
      .for("update");

    if (!existing) {
      if (input.expectedVersion !== 0) throw new ConflictError("This update was removed or changed. Please reload and try again.");
      const inserted = await tx
        .insert(dailyRecords)
        .values({
          userId: actor.id,
          workDate: input.workDate,
          ...clean,
          submittedAt: at,
          cutoffAt,
          submittedLate: afterCutoff,
          updatedAt: at,
          lastEditedById: actor.id,
          version: 1,
        })
        .onConflictDoNothing()
        .returning();
      if (!inserted.length) {
        throw new ConflictError("An update for this date was already submitted. Reload to review it before making a correction.");
      }
      await tx.insert(recordHistory).values({
        recordId: inserted[0].id,
        userId: actor.id,
        workDate: input.workDate,
        action: "created",
        changedAt: at,
        changedById: actor.id,
        afterCutoff,
        newStatus: clean.status,
        newPostUrl: clean.postUrl,
        newReason: clean.reason,
      });
      return inserted[0];
    }

    if (input.expectedVersion !== existing.version) {
      throw new ConflictError(
        input.expectedVersion === 0
          ? "You already submitted an update for this date. Reload to review it, then use “Correct this update” to change it."
          : "This update changed since you opened it. Reload to see the latest version before correcting it.",
      );
    }
    if (existing.status === clean.status && existing.postUrl === clean.postUrl && existing.reason === clean.reason) {
      return existing;
    }
    const [updated] = await tx
      .update(dailyRecords)
      .set({ ...clean, updatedAt: at, lastEditedById: actor.id, version: existing.version + 1 })
      .where(and(eq(dailyRecords.id, existing.id), eq(dailyRecords.version, existing.version)))
      .returning();
    if (!updated) throw new ConflictError("This update changed since you opened it. Reload and try again.");
    await tx.insert(recordHistory).values({
      recordId: existing.id,
      userId: actor.id,
      workDate: input.workDate,
      action: "updated",
      changedAt: at,
      changedById: actor.id,
      afterCutoff,
      previousStatus: existing.status,
      previousPostUrl: existing.postUrl,
      previousReason: existing.reason,
      newStatus: clean.status,
      newPostUrl: clean.postUrl,
      newReason: clean.reason,
    });
    return updated;
  });
}

export interface FollowupInput {
  userId: string;
  workDate: string;
  kind: "note" | "resolution" | "reviewed";
  body: string;
}

/** Admin: internal note, "post link reviewed", or resolution of a missing update. */
export async function addFollowup(db: DB, actor: User, input: FollowupInput, at: Date) {
  assert(can.manageTracking(actor.role));
  if (!isIsoDate(input.workDate)) throw new ValidationError("Invalid date.");
  if (!["note", "resolution", "reviewed"].includes(input.kind)) throw new ValidationError("Invalid note type.");
  const body = cleanText(input.body, 1000) || (input.kind === "reviewed" ? "Post link reviewed." : "");
  if (!body) throw new ValidationError("Write a short note.");
  const [target] = await db.select().from(users).where(eq(users.id, input.userId));
  if (!target || target.role !== "member") throw new ValidationError("User not found.");
  const [row] = await db
    .insert(followups)
    .values({ userId: input.userId, workDate: input.workDate, kind: input.kind, body, authorId: actor.id, createdAt: at })
    .returning();
  return row;
}

/** Full history for one person + date (admin detail page). */
export async function getDayDetail(db: DB, actor: User, userId: string, workDate: string) {
  assert(can.viewDashboard(actor.role));
  const [record] = await db
    .select()
    .from(dailyRecords)
    .where(and(eq(dailyRecords.userId, userId), eq(dailyRecords.workDate, workDate)));
  const history = await db
    .select()
    .from(recordHistory)
    .where(and(eq(recordHistory.userId, userId), eq(recordHistory.workDate, workDate)))
    .orderBy(asc(recordHistory.changedAt));
  const notes = await db
    .select()
    .from(followups)
    .where(and(eq(followups.userId, userId), eq(followups.workDate, workDate)))
    .orderBy(asc(followups.createdAt));
  return { record: record ?? null, history, notes };
}

import {
  pgTable,
  pgEnum,
  text,
  uuid,
  timestamp,
  date,
  integer,
  boolean,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["super_admin", "admin", "viewer", "member"]);
export const userStatusEnum = pgEnum("user_status", ["pending", "active", "inactive"]);
export const trackingStatusEnum = pgEnum("tracking_status", ["tracked", "exempt"]);
export const postStatusEnum = pgEnum("post_status", ["posted", "not_posted"]);
export const followupKindEnum = pgEnum("followup_kind", ["note", "resolution", "reviewed"]);

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    // Always stored lower-case; this is the account identifier.
    email: text("email").notNull(),
    instagramHandle: text("instagram_handle"),
    instagramUrl: text("instagram_url"),
    role: roleEnum("role").notNull().default("member"),
    status: userStatusEnum("status").notNull().default("pending"),
    // "Agent" / "Manager" etc. Free text, optional.
    position: text("position"),
    team: text("team"),
    trackingStatus: trackingStatusEnum("tracking_status").notNull().default("tracked"),
    trackingNote: text("tracking_note"),
    // First date this person is tracked (defaults to approval date).
    trackingStartDate: date("tracking_start_date", { mode: "string" }),
    approvedAt: ts("approved_at"),
    approvedById: uuid("approved_by_id"),
    deactivatedAt: ts("deactivated_at"),
    deactivatedById: uuid("deactivated_by_id"),
    // bcrypt hash, only set if the person completed a setup link. Never plain text.
    passwordHash: text("password_hash"),
    failedLogins: integer("failed_logins").notNull().default(0),
    lockedUntil: ts("locked_until"),
    lastLoginAt: ts("last_login_at"),
    source: text("source").notNull().default("manual"),
    formSubmittedAt: text("form_submitted_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_unique").on(t.email), index("users_status_idx").on(t.status)],
);

export const sessions = pgTable(
  "sessions",
  {
    // SHA-256 of the cookie token; the raw token is never stored.
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: ts("expires_at").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const setupTokens = pgTable("setup_tokens", {
  // SHA-256 of the token in the link.
  id: text("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdById: uuid("created_by_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const dailyRecords = pgTable(
  "daily_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workDate: date("work_date", { mode: "string" }).notNull(),
    status: postStatusEnum("status").notNull(),
    postUrl: text("post_url"),
    reason: text("reason"),
    // Time of the FIRST submission for this date (never changes).
    submittedAt: ts("submitted_at").notNull(),
    // The 7 PM cutoff that applied to this date, frozen at submission time.
    cutoffAt: ts("cutoff_at").notNull(),
    // True if the first submission arrived after the cutoff (i.e. the person
    // was flagged "No update" at the cutoff). Never cleared.
    submittedLate: boolean("submitted_late").notNull().default(false),
    updatedAt: ts("updated_at").notNull(),
    lastEditedById: uuid("last_edited_by_id"),
    // Optimistic-concurrency counter so corrections never silently overwrite.
    version: integer("version").notNull().default(1),
  },
  (t) => [
    uniqueIndex("daily_records_user_date_unique").on(t.userId, t.workDate),
    index("daily_records_date_idx").on(t.workDate),
  ],
);

export const recordHistory = pgTable(
  "record_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recordId: uuid("record_id")
      .notNull()
      .references(() => dailyRecords.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    workDate: date("work_date", { mode: "string" }).notNull(),
    action: text("action").notNull(), // created | updated
    changedAt: ts("changed_at").notNull(),
    changedById: uuid("changed_by_id"),
    afterCutoff: boolean("after_cutoff").notNull(),
    previousStatus: postStatusEnum("previous_status"),
    previousPostUrl: text("previous_post_url"),
    previousReason: text("previous_reason"),
    newStatus: postStatusEnum("new_status").notNull(),
    newPostUrl: text("new_post_url"),
    newReason: text("new_reason"),
  },
  (t) => [index("record_history_user_date_idx").on(t.userId, t.workDate)],
);

// Internal admin notes / resolutions. Keyed by user + date so a "No update"
// day (which has no daily_record) can still be resolved. Never shown to agents.
export const followups = pgTable(
  "followups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workDate: date("work_date", { mode: "string" }).notNull(),
    kind: followupKindEnum("kind").notNull(),
    body: text("body").notNull(),
    authorId: uuid("author_id").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("followups_user_date_idx").on(t.userId, t.workDate), index("followups_date_idx").on(t.workDate)],
);

export const appSettings = pgTable("app_settings", {
  id: integer("id").primaryKey().default(1),
  // ISO weekday numbers 1 (Mon) .. 7 (Sun), comma separated.
  workingDays: text("working_days").notNull().default("1,2,3,4,5"),
  cutoffTime: text("cutoff_time").notNull().default("19:00"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  updatedById: uuid("updated_by_id"),
});

export const holidays = pgTable("holidays", {
  date: date("date", { mode: "string" }).primaryKey(),
  name: text("name").notNull(),
  createdById: uuid("created_by_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id"),
    action: text("action").notNull(),
    targetUserId: uuid("target_user_id"),
    details: jsonb("details"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("audit_log_created_idx").on(t.createdAt)],
);

export type User = typeof users.$inferSelect;
export type DailyRecord = typeof dailyRecords.$inferSelect;
export type Followup = typeof followups.$inferSelect;
export type Role = (typeof roleEnum.enumValues)[number];
export type PostStatus = (typeof postStatusEnum.enumValues)[number];

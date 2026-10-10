// End-to-end business flows against an in-memory Postgres (PGlite).
import { beforeEach, describe, expect, it } from "vitest";
import { createDb, type DB } from "@/lib/db";
import { users, sessions, type User } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { submitOwnUpdate, addFollowup, getDayDetail, ConflictError } from "@/lib/services/records";
import { getDayBoard, getOutstanding, getRangeRows } from "@/lib/services/dashboard";
import { createUser, updateUser, setUserActive, approveUsers, listRoster } from "@/lib/services/users";
import { previewCsvImport, commitCsvImport } from "@/lib/services/csv-import";
import {
  createSetupLink,
  completeSetup,
  passwordLogin,
  createSession,
  validateSession,
  resolveGoogleUser,
} from "@/lib/services/auth";
import { PermissionError, ValidationError } from "@/lib/permissions";
import { addHoliday, updateWorkingSettings } from "@/lib/services/settings";

// Monday 12 Oct 2026 and Friday 9 Oct 2026 (Asia/Dubai, UTC+4).
const MON = "2026-10-12";
const FRI = "2026-10-09";
const monAt = (hhmm: string) => new Date(`${MON}T${hhmm}:00+04:00`);
const friAt = (hhmm: string) => new Date(`${FRI}T${hhmm}:00+04:00`);
const POST = "https://www.instagram.com/reel/ABC123/";

let db: DB;
let superAdmin: User, admin: User, viewer: User, agent: User, agent2: User;

async function mk(role: User["role"], name: string, handle?: string): Promise<User> {
  const [u] = await db
    .insert(users)
    .values({
      name,
      email: `${name.toLowerCase().replace(/\s+/g, ".")}@example.com`,
      role,
      status: "active",
      instagramHandle: handle ?? null,
      instagramUrl: handle ? `https://www.instagram.com/${handle}/` : null,
      trackingStartDate: "2026-10-01",
    })
    .returning();
  return u;
}

beforeEach(async () => {
  db = await createDb("memory://");
  superAdmin = await mk("super_admin", "Sam Super");
  admin = await mk("admin", "Ada Admin");
  viewer = await mk("viewer", "Vic Founder");
  agent = await mk("member", "Alex Agent", "demo.alex");
  agent2 = await mk("member", "Bea Agent", "demo.bea");
});

describe("daily submissions", () => {
  it("records an on-time Posted update with a post link", async () => {
    const r = await submitOwnUpdate(db, agent, { workDate: MON, status: "posted", postUrl: POST, expectedVersion: 0 }, monAt("12:00"));
    expect(r.submittedLate).toBe(false);
    expect(r.postUrl).toBe(POST);
  });

  it("requires a link for Posted and a reason for Not posted", async () => {
    await expect(submitOwnUpdate(db, agent, { workDate: MON, status: "posted", postUrl: "", expectedVersion: 0 }, monAt("12:00"))).rejects.toThrow(
      ValidationError,
    );
    await expect(submitOwnUpdate(db, agent, { workDate: MON, status: "not_posted", reason: "", expectedVersion: 0 }, monAt("12:00"))).rejects.toThrow(
      ValidationError,
    );
  });

  it("does not let a duplicate submission silently overwrite", async () => {
    await submitOwnUpdate(db, agent, { workDate: MON, status: "posted", postUrl: POST, expectedVersion: 0 }, monAt("12:00"));
    await expect(
      submitOwnUpdate(db, agent, { workDate: MON, status: "not_posted", reason: "oops", expectedVersion: 0 }, monAt("12:05")),
    ).rejects.toThrow(ConflictError);
  });

  it("keeps an audit history when an entry is corrected, and rejects stale corrections", async () => {
    await submitOwnUpdate(db, agent, { workDate: MON, status: "not_posted", reason: "Viewings all day", expectedVersion: 0 }, monAt("12:00"));
    const v2 = await submitOwnUpdate(db, agent, { workDate: MON, status: "posted", postUrl: POST, expectedVersion: 1 }, monAt("13:00"));
    expect(v2.version).toBe(2);
    await expect(
      submitOwnUpdate(db, agent, { workDate: MON, status: "not_posted", reason: "again", expectedVersion: 1 }, monAt("13:30")),
    ).rejects.toThrow(ConflictError);
    const detail = await getDayDetail(db, admin, agent.id, MON);
    expect(detail.history.map((h) => h.action)).toEqual(["created", "updated"]);
    expect(detail.history[1]).toMatchObject({ previousStatus: "not_posted", previousReason: "Viewings all day", newStatus: "posted" });
  });

  it("only allows today and the previous working day", async () => {
    await expect(
      submitOwnUpdate(db, agent, { workDate: "2026-10-08", status: "posted", postUrl: POST, expectedVersion: 0 }, monAt("12:00")),
    ).rejects.toThrow(/previous working day/);
    await expect(
      submitOwnUpdate(db, agent, { workDate: "2026-10-13", status: "posted", postUrl: POST, expectedVersion: 0 }, monAt("12:00")),
    ).rejects.toThrow(ValidationError);
  });
});

describe("7 PM cutoff, late updates and backfill", () => {
  it("flags missing updates only after 7 PM and never as Not posted", async () => {
    await submitOwnUpdate(db, agent, { workDate: MON, status: "posted", postUrl: POST, expectedVersion: 0 }, monAt("10:00"));
    const before = await getDayBoard(db, admin, MON, {}, monAt("18:59"));
    expect(before.summary).toMatchObject({ posted: 1, awaiting: 1, no_update: 0, not_posted: 0 });
    const after = await getDayBoard(db, admin, MON, {}, monAt("19:00"));
    expect(after.summary).toMatchObject({ posted: 1, no_update: 1, not_posted: 0 });
    const bea = after.rows.find((r) => r.user.id === agent2.id)!;
    expect(bea.computed).toMatchObject({ status: "no_update", followUpNeeded: true });
  });

  it("a same-day update after 7 PM is marked late", async () => {
    const r = await submitOwnUpdate(db, agent, { workDate: MON, status: "posted", postUrl: POST, expectedVersion: 0 }, monAt("19:30"));
    expect(r.submittedLate).toBe(true);
  });

  it("shows the previous working day's missing update until backfilled (marked late)", async () => {
    // Nobody updated on Friday. On Monday morning the dashboard lists both as outstanding.
    let out = await getOutstanding(db, admin, monAt("09:00"));
    expect(out.filter((r) => r.date === FRI).map((r) => r.user.name).sort()).toEqual(["Alex Agent", "Bea Agent"]);

    const late = await submitOwnUpdate(db, agent, { workDate: FRI, status: "posted", postUrl: POST, expectedVersion: 0 }, monAt("09:30"));
    expect(late.submittedLate).toBe(true);
    expect(late.cutoffAt.toISOString()).toBe(friAt("19:00").toISOString());

    out = await getOutstanding(db, admin, monAt("09:31"));
    expect(out.filter((r) => r.date === FRI).map((r) => r.user.name)).toEqual(["Bea Agent"]);

    const board = await getDayBoard(db, admin, FRI, {}, monAt("09:31"));
    const alex = board.rows.find((r) => r.user.id === agent.id)!;
    expect(alex.computed).toMatchObject({ status: "posted", late: true, missedCutoff: true });
  });

  it("an Admin resolution removes the follow-up flag and is kept in history", async () => {
    await addFollowup(db, admin, { userId: agent2.id, workDate: FRI, kind: "resolution", body: "Called — posted a story." }, monAt("10:00"));
    const out = await getOutstanding(db, admin, monAt("10:01"));
    expect(out.find((r) => r.user.id === agent2.id && r.date === FRI)).toBeUndefined();
    const board = await getDayBoard(db, admin, FRI, { status: "resolved" }, monAt("10:01"));
    expect(board.rows.map((r) => r.user.id)).toEqual([agent2.id]);
  });

  it("respects holidays and configurable working days", async () => {
    await addHoliday(db, admin, { date: FRI, name: "Test holiday" });
    const out = await getOutstanding(db, admin, monAt("09:00"));
    expect(out.some((r) => r.date === FRI)).toBe(false);
    await updateWorkingSettings(db, admin, { workingDays: [1, 2, 3, 4, 5, 6], cutoffTime: "18:00" }, monAt("09:00"));
    const board = await getDayBoard(db, admin, MON, {}, monAt("18:30"));
    expect(board.summary.no_update).toBe(2);
  });
});

describe("permissions (enforced server-side)", () => {
  it("agents cannot open admin data", async () => {
    await expect(getDayBoard(db, agent, MON, {}, monAt("12:00"))).rejects.toThrow(PermissionError);
    await expect(listRoster(db, agent, {})).rejects.toThrow(PermissionError);
    await expect(getDayDetail(db, agent, agent2.id, MON)).rejects.toThrow(PermissionError);
    await expect(getRangeRows(db, agent, FRI, MON, {}, monAt("12:00"))).rejects.toThrow(PermissionError);
  });

  it("admins and viewers cannot submit updates for someone", async () => {
    await expect(submitOwnUpdate(db, admin, { workDate: MON, status: "posted", postUrl: POST, expectedVersion: 0 }, monAt("12:00"))).rejects.toThrow(
      PermissionError,
    );
  });

  it("viewers can read dashboards but not change anything or export", async () => {
    await expect(getDayBoard(db, viewer, MON, {}, monAt("12:00"))).resolves.toBeTruthy();
    await expect(addFollowup(db, viewer, { userId: agent.id, workDate: MON, kind: "note", body: "x" }, monAt("12:00"))).rejects.toThrow(
      PermissionError,
    );
    await expect(createUser(db, viewer, { name: "X", email: "x@example.com", instagramHandle: "x" }, monAt("12:00"))).rejects.toThrow(PermissionError);
    await expect(getRangeRows(db, viewer, FRI, MON, {}, monAt("12:00"))).rejects.toThrow(PermissionError);
  });

  it("only Super Admins manage staff and roles", async () => {
    await expect(createUser(db, admin, { name: "New Admin", email: "na@example.com", role: "admin" }, monAt("12:00"))).rejects.toThrow(
      PermissionError,
    );
    await expect(updateUser(db, admin, agent.id, { name: agent.name, email: agent.email, instagramHandle: "demo.alex", role: "admin" }, monAt("12:00"))).rejects.toThrow(
      PermissionError,
    );
    await expect(setUserActive(db, admin, viewer.id, false, monAt("12:00"))).rejects.toThrow(PermissionError);
    const founder = await createUser(db, superAdmin, { name: "Board Member", email: "board@example.com", role: "viewer", approve: true }, monAt("12:00"));
    expect(founder.role).toBe("viewer");
  });

  it("the last Super Admin cannot be removed", async () => {
    await expect(
      updateUser(db, superAdmin, superAdmin.id, { name: superAdmin.name, email: superAdmin.email, role: "admin" }, monAt("12:00")),
    ).rejects.toThrow(/last active Super Admin/);
  });
});

describe("roster import and approval", () => {
  const csv = [
    "Timestamp,Email Address,Full Name,Instagram handle,Instagram profile link",
    "1/1/2026,new.one@example.com,New One,@demo.new_one,",
    "1/1/2026,NEW.ONE@example.com,New One,@demo.new_one,",
    "1/1/2026,bad-email,Bad Email,@demo.bad,",
    "1/1/2026,alex.agent@example.com,Alex Agent,@demo.alex,",
    "1/1/2026,no.handle@example.com,No Handle,,",
  ].join("\n");

  it("validates rows and flags duplicates", async () => {
    const p = await previewCsvImport(db, admin, csv);
    expect(p.counts).toMatchObject({ total: 5, importable: 1 });
    expect(p.rows[1].duplicate).toBe("in_file");
    expect(p.rows[2].errors.length).toBeGreaterThan(0);
    expect(p.rows[3].duplicate).toBe("existing_active");
    expect(p.rows[4].errors[0]).toMatch(/Instagram/);
  });

  it("imports as pending; pending people cannot sign in until approved", async () => {
    await commitCsvImport(db, admin, csv, monAt("12:00"));
    const [pending] = await db.select().from(users).where(eq(users.email, "new.one@example.com"));
    expect(pending.status).toBe("pending");
    const g = await resolveGoogleUser(db, { email: "new.one@example.com", email_verified: true }, monAt("12:00"));
    expect(g).toEqual({ error: expect.stringMatching(/waiting for approval/) });
    await expect(createSetupLink(db, admin, pending.id, monAt("12:00"))).rejects.toThrow(/Approve/);

    await approveUsers(db, admin, [pending.id], monAt("12:00"));
    const [approved] = await db.select().from(users).where(eq(users.id, pending.id));
    expect(approved).toMatchObject({ status: "active", approvedById: admin.id, trackingStartDate: MON });
  });
});

describe("sign-in and account security", () => {
  it("setup links are single-use and passwords are hashed", async () => {
    const token = await createSetupLink(db, admin, agent.id, monAt("12:00"));
    await expect(completeSetup(db, token, "alexagent2026!", monAt("12:01"))).rejects.toThrow(/name, email or Instagram/);
    await completeSetup(db, token, "correct horse battery", monAt("12:01"));
    const [u] = await db.select().from(users).where(eq(users.id, agent.id));
    expect(u.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(u.passwordHash).not.toContain("correct horse");
    await expect(completeSetup(db, token, "another long password", monAt("12:02"))).rejects.toThrow(/expired|used/);
    await expect(passwordLogin(db, agent.email, "correct horse battery", monAt("12:03"))).resolves.toMatchObject({ id: agent.id });
    await expect(passwordLogin(db, agent.email, "wrong password!!", monAt("12:03"))).rejects.toThrow(ValidationError);
  });

  it("locks the account after repeated failures", async () => {
    const token = await createSetupLink(db, admin, agent.id, monAt("12:00"));
    await completeSetup(db, token, "correct horse battery", monAt("12:00"));
    for (let i = 0; i < 5; i++) await expect(passwordLogin(db, agent.email, "nope nope nope", monAt("12:01"))).rejects.toThrow();
    await expect(passwordLogin(db, agent.email, "correct horse battery", monAt("12:02"))).rejects.toThrow(/Too many/);
  });

  it("deactivation ends sessions immediately", async () => {
    const { token } = await createSession(db, agent.id, monAt("12:00"));
    expect((await validateSession(db, token, monAt("12:01")))?.id).toBe(agent.id);
    await setUserActive(db, admin, agent.id, false, monAt("12:02"));
    expect(await validateSession(db, token, monAt("12:03"))).toBeNull();
    expect(await db.select().from(sessions).where(eq(sessions.userId, agent.id))).toHaveLength(0);
  });

  it("Google sign-in only admits approved, active emails (and optional domain)", async () => {
    expect(await resolveGoogleUser(db, { email: "stranger@example.com", email_verified: true }, monAt("12:00"))).toHaveProperty("error");
    expect(await resolveGoogleUser(db, { email: agent.email, email_verified: false }, monAt("12:00"))).toHaveProperty("error");
    expect(await resolveGoogleUser(db, { email: agent.email.toUpperCase(), email_verified: true }, monAt("12:00"))).toHaveProperty("user");
    process.env.ALLOWED_GOOGLE_DOMAINS = "indglobalrealty.com";
    try {
      expect(await resolveGoogleUser(db, { email: agent.email, email_verified: true }, monAt("12:00"))).toHaveProperty("error");
    } finally {
      delete process.env.ALLOWED_GOOGLE_DOMAINS;
    }
  });
});

import { and, asc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { DB } from "../db";
import { users, sessions, setupTokens, type Role, type User } from "../db/schema";
import { can, canAssignRole, canManageUser, assert, ValidationError, PermissionError } from "../permissions";
import {
  cleanText,
  isValidEmail,
  normalizeEmail,
  normalizeHandle,
  normalizeProfileUrl,
  profileUrlForHandle,
} from "../validation";
import { todayInDubai } from "../calendar";
import { audit } from "./audit";

export interface UserInput {
  name: string;
  email: string;
  instagramHandle?: string | null;
  instagramUrl?: string | null;
  role?: Role;
  position?: string | null;
  team?: string | null;
  trackingStatus?: "tracked" | "exempt";
  trackingNote?: string | null;
  trackingStartDate?: string | null;
}

export interface CleanUser {
  name: string;
  email: string;
  instagramHandle: string | null;
  instagramUrl: string | null;
  position: string | null;
  team: string | null;
}

/** Validates name/email/Instagram fields. Instagram is required for Agents & Managers. */
export function cleanUserFields(input: UserInput, role: Role): CleanUser {
  const name = cleanText(input.name, 120);
  const email = normalizeEmail(input.email);
  if (!name) throw new ValidationError("Name is required.");
  if (!email || !isValidEmail(email)) throw new ValidationError("A valid work email is required.");
  const rawHandle = cleanText(input.instagramHandle, 200);
  const rawUrl = cleanText(input.instagramUrl, 300);
  let handle = rawHandle ? normalizeHandle(rawHandle) : null;
  if (rawHandle && !handle) throw new ValidationError("Instagram handle is not valid (letters, numbers, . and _ only).");
  let url = rawUrl ? normalizeProfileUrl(rawUrl) : null;
  if (rawUrl && !url) throw new ValidationError("Instagram profile link must be an instagram.com profile URL.");
  if (!handle && url) handle = normalizeHandle(url);
  if (handle && !url) url = profileUrlForHandle(handle);
  if (role === "member" && !handle) throw new ValidationError("Instagram handle or profile link is required.");
  return {
    name,
    email,
    instagramHandle: handle,
    instagramUrl: url,
    position: cleanText(input.position, 60) || null,
    team: cleanText(input.team, 80) || null,
  };
}

export async function findUserByEmail(db: DB, email: string) {
  const [u] = await db.select().from(users).where(eq(users.email, normalizeEmail(email)));
  return u ?? null;
}

export async function getUser(db: DB, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [u] = await db.select().from(users).where(eq(users.id, id));
  return u ?? null;
}

async function countActiveSuperAdmins(db: DB) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.role, "super_admin"), eq(users.status, "active")));
  return row.n;
}

/**
 * Add a person manually. `approve: true` makes the account active straight away
 * (recording approver + date); otherwise it waits in the Pending list.
 */
export async function createUser(db: DB, actor: User, input: UserInput & { approve?: boolean }, at: Date) {
  assert(can.manageTracking(actor.role));
  // Founders / board members etc. default to Viewer when a Super Admin adds staff.
  const role: Role = input.role ?? "member";
  if (!canAssignRole(actor, role)) throw new PermissionError("Only a Super Admin can add Admins, Viewers or Super Admins.");
  const fields = cleanUserFields(input, role);
  if (await findUserByEmail(db, fields.email)) throw new ValidationError(`${fields.email} is already on the roster.`);
  const approve = Boolean(input.approve);
  const [created] = await db
    .insert(users)
    .values({
      ...fields,
      role,
      status: approve ? "active" : "pending",
      approvedAt: approve ? at : null,
      approvedById: approve ? actor.id : null,
      trackingStatus: input.trackingStatus ?? "tracked",
      trackingNote: cleanText(input.trackingNote, 200) || null,
      trackingStartDate: approve ? (input.trackingStartDate ?? todayInDubai(at)) : null,
      source: "manual",
      createdAt: at,
      updatedAt: at,
    })
    .returning();
  await audit(db, actor, approve ? "user.create_approved" : "user.create_pending", created.id, { email: created.email, role });
  return created;
}

export async function updateUser(db: DB, actor: User, id: string, input: UserInput, at: Date) {
  assert(can.manageTracking(actor.role));
  const target = await getUser(db, id);
  if (!target) throw new ValidationError("User not found.");
  if (!canManageUser(actor, target)) throw new PermissionError("Only a Super Admin can edit staff accounts.");
  const role: Role = input.role ?? target.role;
  if (role !== target.role) {
    if (!can.manageRoles(actor.role) || !canAssignRole(actor, role)) throw new PermissionError("Only a Super Admin can change roles.");
    if (target.role === "super_admin" && target.status === "active" && (await countActiveSuperAdmins(db)) <= 1) {
      throw new ValidationError("You can't remove the last active Super Admin.");
    }
  }
  const fields = cleanUserFields(input, role);
  if (fields.email !== target.email) {
    const clash = await findUserByEmail(db, fields.email);
    if (clash && clash.id !== target.id) throw new ValidationError(`${fields.email} is already on the roster.`);
  }
  const trackingStartDate = input.trackingStartDate === undefined ? target.trackingStartDate : input.trackingStartDate;
  const [updated] = await db
    .update(users)
    .set({
      ...fields,
      role,
      trackingStatus: input.trackingStatus ?? target.trackingStatus,
      trackingNote: input.trackingNote === undefined ? target.trackingNote : cleanText(input.trackingNote, 200) || null,
      trackingStartDate,
      updatedAt: at,
    })
    .where(eq(users.id, id))
    .returning();
  // Email or role changes end existing sessions so the change takes effect immediately.
  if (fields.email !== target.email || role !== target.role) {
    await db.delete(sessions).where(eq(sessions.userId, id));
  }
  const changed = Object.fromEntries(
    Object.entries({ ...fields, role, trackingStatus: updated.trackingStatus, trackingNote: updated.trackingNote, trackingStartDate })
      .filter(([k, v]) => (target as Record<string, unknown>)[k] !== v),
  );
  await audit(db, actor, "user.update", id, { changed: Object.keys(changed), role });
  return updated;
}

/** Approve pending applicants (or reactivate inactive people). */
export async function approveUsers(db: DB, actor: User, ids: string[], at: Date) {
  assert(can.manageTracking(actor.role));
  if (!ids.length) return 0;
  const targets = await db.select().from(users).where(inArray(users.id, ids));
  let n = 0;
  for (const t of targets) {
    if (t.status !== "pending") continue;
    if (!canManageUser(actor, t)) throw new PermissionError("Only a Super Admin can approve staff accounts.");
    await db
      .update(users)
      .set({
        status: "active",
        approvedAt: at,
        approvedById: actor.id,
        trackingStartDate: t.trackingStartDate ?? todayInDubai(at),
        updatedAt: at,
      })
      .where(and(eq(users.id, t.id), eq(users.status, "pending")));
    await audit(db, actor, "user.approve", t.id, { email: t.email });
    n++;
  }
  return n;
}

export async function setUserActive(db: DB, actor: User, id: string, active: boolean, at: Date) {
  assert(can.manageTracking(actor.role));
  const target = await getUser(db, id);
  if (!target) throw new ValidationError("User not found.");
  if (!canManageUser(actor, target)) throw new PermissionError("Only a Super Admin can change staff accounts.");
  if (!active) {
    if (target.id === actor.id) throw new ValidationError("You can't deactivate your own account.");
    if (target.role === "super_admin" && (await countActiveSuperAdmins(db)) <= 1) {
      throw new ValidationError("You can't deactivate the last active Super Admin.");
    }
    await db
      .update(users)
      .set({ status: "inactive", deactivatedAt: at, deactivatedById: actor.id, updatedAt: at })
      .where(eq(users.id, id));
    // Sign them out everywhere and invalidate any outstanding setup links.
    await db.delete(sessions).where(eq(sessions.userId, id));
    await db.delete(setupTokens).where(eq(setupTokens.userId, id));
    await audit(db, actor, "user.deactivate", id, { email: target.email });
  } else {
    if (target.status === "active") return;
    await db
      .update(users)
      .set({
        status: "active",
        deactivatedAt: null,
        deactivatedById: null,
        approvedAt: target.approvedAt ?? at,
        approvedById: target.approvedById ?? actor.id,
        trackingStartDate: target.trackingStartDate ?? todayInDubai(at),
        updatedAt: at,
      })
      .where(eq(users.id, id));
    await audit(db, actor, target.status === "pending" ? "user.approve" : "user.reactivate", id, { email: target.email });
  }
}

/** Remove a pending applicant who should not be approved (never-active accounts only). */
export async function rejectPending(db: DB, actor: User, id: string) {
  assert(can.manageTracking(actor.role));
  const target = await getUser(db, id);
  if (!target || target.status !== "pending") throw new ValidationError("Only pending applicants can be rejected.");
  if (!canManageUser(actor, target)) throw new PermissionError();
  await db.delete(users).where(eq(users.id, id));
  await audit(db, actor, "user.reject_pending", null, { email: target.email });
}

export interface RosterFilters {
  q?: string;
  status?: string;
  role?: string;
}

export async function listRoster(db: DB, actor: User, f: RosterFilters) {
  assert(can.viewDashboard(actor.role));
  const conds = [];
  if (f.q) {
    const like = `%${f.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    conds.push(or(ilike(users.name, like), ilike(users.email, like), ilike(users.instagramHandle, like), ilike(users.team, like)));
  }
  if (f.status && ["pending", "active", "inactive"].includes(f.status)) conds.push(eq(users.status, f.status as User["status"]));
  if (f.role && ["super_admin", "admin", "viewer", "member"].includes(f.role)) conds.push(eq(users.role, f.role as Role));
  return db
    .select()
    .from(users)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(users.name));
}

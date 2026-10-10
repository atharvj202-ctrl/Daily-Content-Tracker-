import type { Role, User } from "./db/schema";

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  viewer: "Viewer",
  member: "Agent / Manager",
};

export const STAFF_ROLES: Role[] = ["super_admin", "admin", "viewer"];

/** Every permission check in the app goes through these functions, server-side. */
export const can = {
  /** Admin dashboard, reports, roster (read-only for viewers). */
  viewDashboard: (r: Role) => r === "super_admin" || r === "admin" || r === "viewer",
  /** Add / edit / import / approve / deactivate Agents & Managers, notes, resolutions, settings. */
  manageTracking: (r: Role) => r === "super_admin" || r === "admin",
  exportCsv: (r: Role) => r === "super_admin" || r === "admin",
  /** Invite / approve Admins and Viewers, change roles. */
  manageRoles: (r: Role) => r === "super_admin",
  viewAuditLog: (r: Role) => r === "super_admin",
  /** Submit daily updates for yourself. */
  submitOwnUpdates: (r: Role) => r === "member",
};

/** May `actor` edit / deactivate / issue a setup link for `target`? */
export function canManageUser(actor: Pick<User, "role" | "id">, target: Pick<User, "role" | "id">): boolean {
  if (actor.role === "super_admin") return true;
  if (actor.role === "admin") return target.role === "member";
  return false;
}

/** May `actor` give someone the role `role`? */
export function canAssignRole(actor: Pick<User, "role">, role: Role): boolean {
  if (actor.role === "super_admin") return true;
  if (actor.role === "admin") return role === "member";
  return false;
}

export class PermissionError extends Error {
  constructor(message = "You don't have permission to do that.") {
    super(message);
    this.name = "PermissionError";
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new PermissionError(message);
}

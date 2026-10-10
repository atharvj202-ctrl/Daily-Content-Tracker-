import Link from "next/link";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import type { Role } from "@/lib/db/schema";
import { Flash, first } from "@/components/ui";
import { UserForm } from "../UserForm";
import { createUserAction } from "../actions";

type SP = Record<string, string | string[] | undefined>;

export default async function NewUserPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireUser(can.manageTracking);
  const sp = await searchParams;
  const staff = first(sp, "staff") === "1" && can.manageRoles(actor.role);
  const roles: Role[] = can.manageRoles(actor.role) ? ["member", "viewer", "admin", "super_admin"] : ["member"];
  return (
    <div style={{ maxWidth: 820, margin: "0 auto" }}>
      <p>
        <Link href="/admin/users">← Roster</Link>
      </p>
      <div className="card">
        <h1>{staff ? "Invite staff" : "Add agent / manager"}</h1>
        {staff ? (
          <p className="muted small">
            Founders and board members should normally be <strong>Viewers</strong> (read-only dashboards). Only give Admin or Super
            Admin to people who run the program. Staff don&apos;t need an Instagram handle and aren&apos;t tracked.
          </p>
        ) : (
          <p className="muted small">Use this for one-off additions. For the Google Form list, use Import CSV.</p>
        )}
        <Flash sp={sp} />
        <UserForm action={createUserAction} roles={roles} defaultRole={staff ? "viewer" : "member"} isNew readOnly={false} />
      </div>
    </div>
  );
}

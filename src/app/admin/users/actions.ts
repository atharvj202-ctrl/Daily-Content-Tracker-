"use server";

import { redirect } from "next/navigation";
import { requireUser, appUrl } from "@/lib/session";
import { can } from "@/lib/permissions";
import { getDb } from "@/lib/db";
import type { Role } from "@/lib/db/schema";
import { createUser, updateUser, approveUsers, setUserActive, rejectPending, type UserInput } from "@/lib/services/users";
import { createSetupLink } from "@/lib/services/auth";
import { runAction, safePath, str, userMessage, withParam } from "@/lib/actions";
import { isIsoDate, now } from "@/lib/time";

function readUserForm(form: FormData): UserInput {
  const start = str(form, "trackingStartDate");
  return {
    name: str(form, "name"),
    email: str(form, "email"),
    instagramHandle: str(form, "instagramHandle"),
    instagramUrl: str(form, "instagramUrl"),
    role: (str(form, "role") || undefined) as Role | undefined,
    position: str(form, "position"),
    team: str(form, "team"),
    trackingStatus: str(form, "trackingStatus") === "exempt" ? "exempt" : "tracked",
    trackingNote: str(form, "trackingNote"),
    trackingStartDate: isIsoDate(start) ? start : null,
  };
}

export async function createUserAction(form: FormData) {
  const actor = await requireUser(can.manageTracking);
  let id: string | null = null;
  let error: string | null = null;
  try {
    const u = await createUser(await getDb(), actor, { ...readUserForm(form), approve: form.get("approve") === "on" }, now());
    id = u.id;
  } catch (e) {
    error = userMessage(e);
    if (!error) {
      console.error(e);
      error = "Something went wrong.";
    }
  }
  if (error) redirect(withParam(safePath(form.get("back"), "/admin/users/new"), "error", error));
  redirect(withParam(`/admin/users/${id}`, "ok", "Person added."));
}

export async function updateUserAction(form: FormData) {
  const actor = await requireUser(can.manageTracking);
  const id = str(form, "id");
  await runAction(`/admin/users/${id}`, async () => {
    await updateUser(await getDb(), actor, id, readUserForm(form), now());
    return "Changes saved.";
  });
}

export async function approveSelectedAction(form: FormData) {
  const actor = await requireUser(can.manageTracking);
  const ids = form.getAll("ids").filter((v): v is string => typeof v === "string");
  await runAction(safePath(form.get("back"), "/admin/users?status=pending"), async () => {
    if (!ids.length) return "Select at least one person to approve.";
    const n = await approveUsers(await getDb(), actor, ids, now());
    return `${n} ${n === 1 ? "person" : "people"} approved. Send each a setup link (or ask them to use Google sign-in).`;
  });
}

export async function setActiveAction(form: FormData) {
  const actor = await requireUser(can.manageTracking);
  const id = str(form, "id");
  const active = str(form, "active") === "true";
  await runAction(safePath(form.get("back"), `/admin/users/${id}`), async () => {
    await setUserActive(await getDb(), actor, id, active, now());
    return active ? "Account is active." : "Account deactivated and signed out everywhere.";
  });
}

export async function rejectPendingAction(form: FormData) {
  const actor = await requireUser(can.manageTracking);
  let error: string | null = null;
  try {
    await rejectPending(await getDb(), actor, str(form, "id"));
  } catch (e) {
    error = userMessage(e) ?? "Something went wrong.";
  }
  if (error) redirect(withParam(`/admin/users/${str(form, "id")}`, "error", error));
  redirect(withParam("/admin/users?status=pending", "ok", "Applicant removed."));
}

export type SetupLinkState = { link?: string; error?: string };

export async function setupLinkAction(_prev: SetupLinkState, form: FormData): Promise<SetupLinkState> {
  const actor = await requireUser(can.manageTracking);
  try {
    const token = await createSetupLink(await getDb(), actor, str(form, "id"), now());
    return { link: `${appUrl()}/setup/${token}` };
  } catch (e) {
    const msg = userMessage(e);
    if (!msg) console.error(e);
    return { error: msg ?? "Something went wrong." };
  }
}

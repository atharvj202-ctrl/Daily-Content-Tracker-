"use server";

import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { getDb } from "@/lib/db";
import { addFollowup } from "@/lib/services/records";
import { runAction, safePath, str } from "@/lib/actions";
import { now } from "@/lib/time";

export async function addFollowupAction(form: FormData) {
  const user = await requireUser(can.manageTracking);
  const back = safePath(form.get("back"), "/admin");
  await runAction(back, async () => {
    const kind = str(form, "kind") as "note" | "resolution" | "reviewed";
    await addFollowup(
      await getDb(),
      user,
      { userId: str(form, "userId"), workDate: str(form, "workDate"), kind, body: str(form, "body") },
      now(),
    );
    return kind === "resolution" ? "Marked as resolved." : kind === "reviewed" ? "Marked as reviewed." : "Note added.";
  });
}

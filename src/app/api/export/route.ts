import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { getDb } from "@/lib/db";
import { getRangeRows } from "@/lib/services/dashboard";
import { userMessage } from "@/lib/actions";
import { toCsv } from "@/lib/csv";
import { STATUS_LABELS } from "@/lib/status";
import { formatDateTime, now } from "@/lib/time";
import { audit } from "@/lib/services/audit";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!can.exportCsv(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const p = req.nextUrl.searchParams;
  const from = p.get("from") ?? "";
  const to = p.get("to") ?? "";
  const db = await getDb();
  try {
    const rows = await getRangeRows(
      db,
      user,
      from,
      to,
      { q: p.get("q") ?? "", position: p.get("position") ?? "", team: p.get("team") ?? "", status: p.get("status") ?? "" },
      now(),
    );
    const csv = toCsv([
      [
        "Date",
        "Name",
        "Email",
        "Instagram handle",
        "Instagram profile",
        "Position",
        "Team",
        "Status",
        "Submitted late",
        "No update at cutoff",
        "Post link",
        "Reason",
        "Submitted at (Dubai)",
        "Last edited (Dubai)",
        "Admin notes",
      ],
      ...rows.map((r) => [
        r.date,
        r.user.name,
        r.user.email,
        r.user.instagramHandle ? `@${r.user.instagramHandle}` : "",
        r.user.instagramUrl ?? "",
        r.user.position ?? "",
        r.user.team ?? "",
        STATUS_LABELS[r.computed.status],
        r.computed.late ? "Yes" : "No",
        r.computed.missedCutoff ? "Yes" : "No",
        r.record?.postUrl ?? "",
        r.record?.reason ?? "",
        r.record ? formatDateTime(r.record.submittedAt) : "",
        r.record && r.record.version > 1 ? formatDateTime(r.record.updatedAt) : "",
        r.notes.map((n) => `[${n.kind}] ${n.body}`).join(" | "),
      ]),
    ]);
    await audit(db, user, "report.export", null, { from, to, rows: rows.length });
    return new NextResponse("﻿" + csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="content-tracker_${from}_to_${to}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const msg = userMessage(e);
    if (!msg) console.error(e);
    return NextResponse.json({ error: msg ?? "Export failed" }, { status: msg ? 400 : 500 });
  }
}

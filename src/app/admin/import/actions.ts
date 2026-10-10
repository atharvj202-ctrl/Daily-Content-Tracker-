"use server";

import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { getDb } from "@/lib/db";
import { previewCsvImport, commitCsvImport, MAX_CSV_BYTES, type ImportPreview } from "@/lib/services/csv-import";
import { userMessage } from "@/lib/actions";
import { now } from "@/lib/time";

export type ImportState = {
  csv?: string;
  preview?: ImportPreview;
  result?: { imported: number; skipped: number };
  error?: string;
};

export async function importAction(prev: ImportState, form: FormData): Promise<ImportState> {
  const actor = await requireUser(can.manageTracking);
  const db = await getDb();
  try {
    if (form.get("step") === "commit") {
      const csv = String(form.get("csv") ?? "");
      const result = await commitCsvImport(db, actor, csv, now());
      return { result };
    }
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV file exported from Google Forms." };
    if (file.size > MAX_CSV_BYTES) return { error: "The CSV file is larger than 1 MB." };
    const csv = await file.text();
    const preview = await previewCsvImport(db, actor, csv);
    return { csv, preview };
  } catch (e) {
    const msg = userMessage(e);
    if (!msg) console.error(e);
    return { ...prev, error: msg ?? "Could not read that file." };
  }
}

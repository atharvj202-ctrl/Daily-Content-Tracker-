import Papa from "papaparse";
import { inArray } from "drizzle-orm";
import type { DB } from "../db";
import { users, type User } from "../db/schema";
import { can, assert, ValidationError } from "../permissions";
import { normalizeEmail } from "../validation";
import { cleanUserFields } from "./users";
import { audit } from "./audit";

export const MAX_CSV_BYTES = 1_000_000;
export const MAX_CSV_ROWS = 2000;

type Field = "name" | "email" | "handle" | "url" | "position" | "team" | "timestamp";

/** Map Google Forms column titles to our fields (case-insensitive, flexible wording). */
export function detectColumns(headers: string[]): Partial<Record<Field, number>> {
  const map: Partial<Record<Field, number>> = {};
  headers.forEach((raw, i) => {
    const h = raw.toLowerCase().trim();
    let field: Field | null = null;
    if (/timestamp/.test(h)) field = "timestamp";
    else if (/e-?mail/.test(h)) field = "email";
    else if (/(link|url|profile)/.test(h)) field = "url";
    else if (/(handle|username|user name|instagram|\binsta\b|\big\b)/.test(h)) field = "handle";
    else if (/(position|designation|role|title)/.test(h)) field = "position";
    else if (/(team|manager)/.test(h)) field = "team";
    else if (/name/.test(h)) field = "name";
    if (field && map[field] === undefined) map[field] = i;
  });
  return map;
}

export type DuplicateKind = "in_file" | "existing_active" | "existing_pending" | "existing_inactive";

export interface ImportRow {
  rowNumber: number;
  name: string;
  email: string;
  instagramHandle: string | null;
  instagramUrl: string | null;
  position: string | null;
  team: string | null;
  formSubmittedAt: string | null;
  errors: string[];
  duplicate: DuplicateKind | null;
  importable: boolean;
}

export interface ImportPreview {
  rows: ImportRow[];
  missingColumns: string[];
  counts: { total: number; importable: number; errors: number; duplicates: number };
}

export async function previewCsvImport(db: DB, actor: User, csvText: string): Promise<ImportPreview> {
  assert(can.manageTracking(actor.role));
  if (csvText.length > MAX_CSV_BYTES) throw new ValidationError("The CSV file is larger than 1 MB.");
  const parsed = Papa.parse<string[]>(csvText.replace(/^﻿/, ""), { skipEmptyLines: "greedy" });
  const [headers, ...data] = parsed.data;
  if (!headers || !data.length) throw new ValidationError("The CSV file has no data rows.");
  if (data.length > MAX_CSV_ROWS) throw new ValidationError(`The CSV file has more than ${MAX_CSV_ROWS} rows.`);
  const cols = detectColumns(headers);
  const missingColumns: string[] = [];
  if (cols.name === undefined) missingColumns.push("Name");
  if (cols.email === undefined) missingColumns.push("Email address");
  if (cols.handle === undefined && cols.url === undefined) missingColumns.push("Instagram handle or profile link");

  const get = (row: string[], f: Field) => (cols[f] === undefined ? "" : (row[cols[f]!] ?? "").trim());
  const seen = new Map<string, number>();
  const rows: ImportRow[] = data.map((r, idx) => {
    const rowNumber = idx + 2; // +1 for header, +1 for 1-based numbering like a spreadsheet
    const errors: string[] = [];
    let clean = {
      name: get(r, "name"),
      email: normalizeEmail(get(r, "email")),
      instagramHandle: get(r, "handle") || null,
      instagramUrl: get(r, "url") || null,
      position: get(r, "position") || null,
      team: get(r, "team") || null,
    };
    try {
      clean = cleanUserFields(clean, "member");
    } catch (e) {
      errors.push((e as Error).message);
    }
    let duplicate: DuplicateKind | null = null;
    if (clean.email) {
      if (seen.has(clean.email)) duplicate = "in_file";
      else seen.set(clean.email, rowNumber);
    }
    return {
      rowNumber,
      ...clean,
      formSubmittedAt: get(r, "timestamp") || null,
      errors,
      duplicate,
      importable: false,
    };
  });

  const emails = [...seen.keys()];
  const existing = emails.length
    ? await db.select({ email: users.email, status: users.status }).from(users).where(inArray(users.email, emails))
    : [];
  const existingByEmail = new Map(existing.map((e) => [e.email, e.status]));
  for (const row of rows) {
    const st = existingByEmail.get(row.email);
    if (!row.duplicate && st) row.duplicate = `existing_${st}` as DuplicateKind;
    row.importable = !missingColumns.length && row.errors.length === 0 && row.duplicate === null;
  }
  return {
    rows,
    missingColumns,
    counts: {
      total: rows.length,
      importable: rows.filter((r) => r.importable).length,
      errors: rows.filter((r) => r.errors.length).length,
      duplicates: rows.filter((r) => r.duplicate).length,
    },
  };
}

/** Imports valid, non-duplicate rows as PENDING applicants. Nobody becomes active here. */
export async function commitCsvImport(db: DB, actor: User, csvText: string, at: Date) {
  const preview = await previewCsvImport(db, actor, csvText);
  if (preview.missingColumns.length) throw new ValidationError(`Missing columns: ${preview.missingColumns.join(", ")}`);
  const toInsert = preview.rows.filter((r) => r.importable);
  if (toInsert.length) {
    await db
      .insert(users)
      .values(
        toInsert.map((r) => ({
          name: r.name,
          email: r.email,
          instagramHandle: r.instagramHandle,
          instagramUrl: r.instagramUrl,
          position: r.position,
          team: r.team,
          role: "member" as const,
          status: "pending" as const,
          source: "csv",
          formSubmittedAt: r.formSubmittedAt,
          createdAt: at,
          updatedAt: at,
        })),
      )
      .onConflictDoNothing({ target: users.email });
  }
  await audit(db, actor, "roster.csv_import", null, {
    imported: toInsert.length,
    skipped: preview.counts.total - toInsert.length,
  });
  return { imported: toInsert.length, skipped: preview.counts.total - toInsert.length };
}

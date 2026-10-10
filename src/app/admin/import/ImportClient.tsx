"use client";

import Link from "next/link";
import { useActionState } from "react";
import { importAction, type ImportState } from "./actions";

const DUP_LABEL: Record<string, string> = {
  in_file: "Duplicate email in this file",
  existing_active: "Already on roster (active)",
  existing_pending: "Already waiting for approval",
  existing_inactive: "Already on roster (inactive)",
};

export function ImportClient() {
  const [state, action, pending] = useActionState<ImportState, FormData>(importAction, {});

  if (state.result) {
    return (
      <div className="card">
        <h2>Import finished</h2>
        <p>
          {state.result.imported} applicant(s) added as <strong>Pending approval</strong>. {state.result.skipped} row(s) skipped.
        </p>
        <p className="row">
          <Link className="btn" href="/admin/users?status=pending">
            Review and approve applicants
          </Link>
          <a className="btn btn-secondary" href="/admin/import">
            Import another file
          </a>
        </p>
      </div>
    );
  }

  return (
    <>
      {state.error && <div className="flash error">{state.error}</div>}
      <form action={action} className="card">
        <input type="hidden" name="step" value="preview" />
        <div className="field">
          <label htmlFor="file">Google Forms CSV file</label>
          <input id="file" name="file" type="file" accept=".csv,text/csv" required />
        </div>
        <button type="submit" disabled={pending}>
          {pending ? "Checking…" : "Check file"}
        </button>
      </form>

      {state.preview && (
        <div className="card">
          <h2>Preview</h2>
          {state.preview.missingColumns.length > 0 && (
            <div className="flash error">
              Missing column(s): {state.preview.missingColumns.join(", ")}. Check the column titles and try again.
            </div>
          )}
          <p>
            {state.preview.counts.total} rows · <strong>{state.preview.counts.importable} ready to import</strong> ·{" "}
            {state.preview.counts.errors} with errors · {state.preview.counts.duplicates} duplicates
          </p>
          <div className="table-wrap">
            <table className="stack">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Instagram</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {state.preview.rows.map((r) => (
                  <tr key={r.rowNumber} className={r.importable ? undefined : "flagged"}>
                    <td data-label="Row">{r.rowNumber}</td>
                    <td data-label="Name">{r.name || <span className="muted">—</span>}</td>
                    <td data-label="Email" className="break">{r.email || <span className="muted">—</span>}</td>
                    <td data-label="Instagram">{r.instagramHandle ? `@${r.instagramHandle}` : <span className="muted">—</span>}</td>
                    <td data-label="Result">
                      {r.importable ? (
                        <span className="badge posted">Will import as pending</span>
                      ) : (
                        <>
                          {r.errors.map((e) => (
                            <div key={e} className="badge no_update" style={{ whiteSpace: "normal" }}>
                              {e}
                            </div>
                          ))}
                          {r.duplicate && <div className="badge not_posted">{DUP_LABEL[r.duplicate]}</div>}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {state.preview.counts.importable > 0 && state.preview.missingColumns.length === 0 && (
            <form action={action} style={{ marginTop: "1rem" }}>
              <input type="hidden" name="step" value="commit" />
              <input type="hidden" name="csv" value={state.csv} />
              <button type="submit" disabled={pending}>
                Import {state.preview.counts.importable} applicant(s) as pending
              </button>
              <p className="muted small" style={{ marginTop: "0.5rem" }}>
                Nobody can sign in until an Admin approves them on the Roster page.
              </p>
            </form>
          )}
        </div>
      )}
    </>
  );
}

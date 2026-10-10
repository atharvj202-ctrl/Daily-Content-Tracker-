import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { ImportClient } from "./ImportClient";

export default async function ImportPage() {
  await requireUser(can.manageTracking);
  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <h1>Import applicants from Google Forms</h1>
      <p className="muted">
        In Google Forms open <em>Responses → Link to Sheets</em>, then in the sheet use <em>File → Download → CSV</em>. The file
        needs columns for name, email address and Instagram handle and/or profile link (column titles are matched flexibly).
        Optional columns: Position / Role, Team / Manager.
      </p>
      <ImportClient />
    </div>
  );
}

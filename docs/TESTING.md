# Testing the cutoff, late submissions, permissions and backfill

## Automated tests

```bash
npm test
```

Runs against an in-memory Postgres (no setup). Covers, among others:

- 7:00 PM Dubai = 15:00 UTC; the cutoff is inclusive at exactly 7:00 PM; dates use the Dubai calendar day.
- Missing updates are “Awaiting” before 7 PM and “No update — follow-up needed” after — never “Not posted”.
- Same-day updates after 7 PM and backfills are marked late and keep the missed-cutoff flag.
- The previous working day's missing update stays on the outstanding list until backfilled or resolved.
- Duplicate submissions are rejected; corrections need the current version and are recorded in history.
- Agents cannot reach admin data or other people's records; viewers cannot change anything or export; only
  Super Admins manage staff/roles; the last Super Admin can't be removed.
- CSV validation and duplicate detection; imported people stay pending and cannot sign in until approved.
- Setup links are single-use, passwords are hashed and can't contain personal details, lockout after 5 failures,
  deactivation ends sessions, Google sign-in only admits active roster emails (and the configured domain).

## Manual testing with a simulated clock

Locally (never in production) you can pretend it's a particular time with `APP_FAKE_NOW`.

```bash
npm run db:reset-local                     # fictional data; today is left empty
ENABLE_DEV_LOGIN=true APP_FAKE_NOW="2026-10-12T18:55:00+04:00" npm run dev
```

Note: the sample data is generated relative to the real current date; set `APP_FAKE_NOW` to the next working day
(or today, if it's a working day) for the scenarios below to line up.

1. **Before the cutoff** — sign in as Admin *Omar Siddiqui*: today's missing people show **Awaiting update**.
2. **After the cutoff** — restart with `APP_FAKE_NOW=…T19:05:00+04:00`: the same people show
   **No update — follow-up needed** and the summary counts them under “No update (follow-up)”. Nobody is
   labelled “Not posted”.
3. **Late same-day update** — sign in as an agent (e.g. *Sara Mendes*), submit *Posted* with a link such as
   `https://www.instagram.com/reel/TEST123/`. On the dashboard the row shows **Posted** + **Submitted late**; the
   details page shows “Flagged ‘No update’ at cutoff”.
4. **Backfill** — set `APP_FAKE_NOW` to the next working day morning. The admin dashboard lists the people still
   missing yesterday under **Still missing from previous working days**. Sign in as one of them: the
   **Previous working day** card offers a late update. Submit it; the entry leaves the outstanding list and shows
   **Submitted late**. Try to submit for two working days ago: refused.
5. **Admin resolution** — as Admin open *Follow up / resolve*, choose *Resolve missing update*, add a note. The
   entry leaves the list and shows **Resolved by admin**; the note is in the history.
6. **Corrections and duplicates** — as an agent, use *Correct this update*; the details page shows before/after
   values, time and editor. Open the page in two tabs and submit in both: the second is refused instead of
   overwriting.
7. **Permissions** — as an agent visit `/admin`, `/admin/users`, `/api/export?from=2026-10-01&to=2026-10-12`:
   redirected / 403. As Viewer *Rania Farouk*: dashboards visible, no edit buttons, `/admin/import` and export
   refused. As Admin: “Invite staff” isn't available and staff accounts are read-only.
8. **Import / approval** — as Admin import `sample-data/google-form-responses-sample.csv`: 3 rows import as pending,
   5 are flagged (duplicates, invalid email, missing name, missing Instagram, already on roster). Approve one,
   create a setup link, open it in a private window and set a password.

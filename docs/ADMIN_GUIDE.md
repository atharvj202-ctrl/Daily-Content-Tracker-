# Admin guide

## Importing applicants from the Google Form

1. In Google Forms: **Responses → Link to Sheets**. In the sheet: **File → Download → Comma-separated values (.csv)**.
2. In the tracker: **Import CSV** → choose the file → **Check file**.
3. Review the preview. Each row shows one of:
   - **Will import as pending** — valid and new.
   - **Errors** — e.g. missing name, invalid email, missing/invalid Instagram handle. Fix in the sheet and re-import,
     or add the person manually.
   - **Duplicate** — the email appears twice in the file, or is already on the roster (active, pending or inactive).
     Duplicates are never imported or overwritten.
4. Click **Import N applicant(s) as pending**. Nobody can sign in yet.

Columns are matched by title, so the form's wording can vary: it needs a name, an email address, and an Instagram
handle and/or profile link. Position/Role and Team/Manager columns are optional. Try it with
`sample-data/google-form-responses-sample.csv` (fictional).

## Approving applicants

**Roster → Pending approval**. Check each person (name, work email, Instagram), tick them and click
**Approve selected**, or open a person to approve or **reject** them individually. Approval records the date and
the approving Admin, and daily tracking starts that day (editable via “Tracking starts on”).

Then tell them how to sign in:
- **Google sign-in enabled:** “Open the tracker and click *Sign in with company Google account*.”
- **Otherwise:** open the person → **Create account setup link** → send the link to them personally. It works once
  and expires in 72 hours.

## Adding, editing, deactivating

- **Add agent / manager** for one-off additions (tick *Approve now* to activate immediately).
- Open a person to edit details, pause tracking (*Exception — not tracked*, with a note such as “Annual leave
  until 20 Oct”), deactivate or reactivate. Deactivation signs them out immediately and keeps their history.
- Super Admins: **Invite staff (Admin / Viewer)**. Founders and board members default to **Viewer**.

## Daily follow-up

**Dashboard** shows one row per active, tracked agent/manager for the selected date:

| Status | Meaning |
| --- | --- |
| Posted | They submitted Posted with a post/reel link. |
| Not posted | They explicitly said they didn't post (with a reason). |
| Awaiting update | No update yet and it's before the 7:00 PM cutoff. |
| No update — follow-up needed | No update by 7:00 PM. **This is not the same as “Not posted”** — they may have posted and not reported it. |
| Submitted late | Their update arrived after the cutoff (or was a backfill). The flag is permanent. |
| Resolved by admin | No update, but an Admin recorded a resolution. |

- Summary tiles at the top are clickable filters. Search by name/email/@handle; filter by status, role (position)
  and team; pick any date or step back through previous working days.
- **Still missing from previous working days** lists every unhandled “No update” from the last 10 working days.
  An entry disappears when the person backfills (previous working day only) or an Admin resolves it.
- **Mark reviewed** records that you checked a post link.
- **Details / note** shows the full history (original submission, corrections, cutoff flag) and lets you add an
  internal note or a **resolution** (e.g. “Called — posted a story, OK”). Notes are never shown to agents.

There are no automatic reminders: contact people personally.

## Settings

Working days (default Monday–Friday), the daily cutoff (default 7:00 PM) and holidays. All times are Asia/Dubai.
Holidays and non-working days are never flagged.

## Export

**Export** downloads a CSV for a date range: one row per person per working day with status, link, reason,
submission time, late flag and notes. The file contains personal data — store it in a restricted location.

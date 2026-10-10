# Deployment, security and operations

This covers setting up the production environment, access control, where data lives, backups, deactivating
people and recovering accounts.

## 1. Environment variables

Set these in **Vercel → Project `daily-content-tracker` → Settings → Environment Variables** (never in code).
`.env.example` lists them all.

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Postgres connection string. With Neon from the Vercel Marketplace this is added automatically. Use the **pooled** connection string. |
| `APP_URL` | Yes | The public URL, e.g. `https://daily-content-tracker.vercel.app` or your custom domain. Used for the Google redirect URL and setup links. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Recommended | Enables “Sign in with company Google account”. Mark the secret as *Sensitive*. |
| `ALLOWED_GOOGLE_DOMAINS` | Recommended | e.g. `indglobalrealty.com`. Extra check: only Google accounts on these domains may sign in (on top of the roster allowlist). |
| `ENABLE_PASSWORD_LOGIN` | Optional | `true` (default) allows sign-in with a password set via a one-time setup link. Set `false` once everyone uses Google. |
| `BOOTSTRAP_SUPER_ADMIN_EMAIL` | First run | While no Super Admin exists, this email becomes Super Admin on first Google sign-in. Remove it afterwards. |

`ENABLE_DEV_LOGIN` and `APP_FAKE_NOW` are development-only and are ignored in production builds.

## 2. Database (Neon on Vercel)

1. In Vercel open the project → **Storage → Create Database → Neon (Postgres)** → Free plan, region close to
   Dubai/your users (e.g. Frankfurt `eu-central-1`) → connect it to the `daily-content-tracker` project only.
   This adds `DATABASE_URL` to the project.
2. Redeploy. The build command (`npm run vercel-build`) applies database migrations automatically before building.
3. Do **not** run `npm run db:seed` against production — it refuses unless forced, and only loads fictional data.

Any Postgres 14+ provider works; just set `DATABASE_URL`.

Until `DATABASE_URL` is set the deployment shows a “Setup required” page and nobody can sign in.

## 3. Sign-in

### Option A (preferred): company Google sign-in

1. Google Cloud Console → create a project (e.g. “IND Content Tracker”).
2. **APIs & Services → OAuth consent screen**: User type **Internal** (only available with Google Workspace — this
   limits sign-in to your company's Google accounts). App name “Daily Content Tracker”. Scopes: `openid`, `email`,
   `profile` only.
3. **Credentials → Create credentials → OAuth client ID → Web application**.
   Authorised redirect URI: `${APP_URL}/api/auth/google/callback`
   (and `http://localhost:3000/api/auth/google/callback` for local testing if wanted).
4. Put the client ID/secret into Vercel env vars, set `ALLOWED_GOOGLE_DOMAINS`, redeploy.

Even with Google sign-in, **only people on the roster with status Active can get in**. A Google account whose email
isn't on the roster, is pending approval, or is deactivated is refused.

Cost: free. Requirement: a Google Cloud project; Google Workspace on the company domain is needed for
“Internal” consent and domain restriction. If agents use personal Gmail addresses in the Google Form, leave
`ALLOWED_GOOGLE_DOMAINS` empty (the roster allowlist still applies) and choose “External” consent with test users or
publish the app, or use Option B.

### Option B: one-time setup links (no Google Workspace needed)

An Admin opens a person on the Roster and clicks **Create account setup link**. The link:

- is shown once to the Admin, who sends it personally (WhatsApp/email);
- works once and expires after 72 hours; creating a new link cancels older ones;
- lets the person choose their own password (min. 10 characters, may not contain their name, email or handle).

Passwords are stored only as bcrypt hashes. Nobody — including admins — can see a password. The system never
generates passwords. After 5 wrong attempts an account is locked for 15 minutes.

### First Super Admin

Either set `BOOTSTRAP_SUPER_ADMIN_EMAIL` and sign in with Google, or run locally against the production database:

```bash
DATABASE_URL="postgres://…" APP_URL="https://…" npm run bootstrap-admin -- you@indglobalrealty.com "Your Name"
```

This prints a one-time setup link.

## 4. Access control

| Role | Can do |
| --- | --- |
| Super Admin | Everything: roles, staff invitations/approvals, all records, settings, audit log. Cannot remove the last Super Admin. |
| Admin | Roster of agents/managers (add, import, approve, edit, deactivate, setup links), notes/resolutions, working days & holidays, CSV export. Cannot create or edit Admins, Viewers or Super Admins. |
| Viewer | Read-only dashboard, roster and settings. No exports, no notes, no changes. Default for founders/board members (“Invite staff” defaults to Viewer). |
| Agent / Manager | Own profile and own daily records only: today and the previous working day. Cannot see other people, the roster or admin notes. |

Every page, form action and API route checks the role on the server (`src/lib/permissions.ts`, enforced inside
`src/lib/services/*`). Hiding buttons is only cosmetic. Sessions are random tokens in an HttpOnly, Secure, SameSite
cookie; only a SHA-256 hash is stored. Role or email changes and deactivation sign the person out immediately.

**Vercel Deployment Protection:** the project is created with Vercel Authentication enabled, so previews require a
Vercel login. Before go-live check *Settings → Deployment Protection* and decide whether the production URL should
be reachable by staff without a Vercel account (it must be, for agents to use it).

## 5. Where data is stored and who can see it

- All data is in the Postgres database (Neon) in the region you chose. Nothing is stored in the browser except the
  session cookie.
- Stored per person: name, work email, Instagram handle and profile link, role, active/pending/inactive status,
  position, optional team, tracking start date or exception, approval date and approving admin, password hash
  (only if using setup links), last sign-in.
- Stored per day: Posted/Not posted, post link or reason, submission time, the cutoff that applied, the late flag,
  correction history (previous value, time, editor), and internal admin notes.
- Not collected: Instagram passwords, Instagram content, follower data or anything scraped. The app never calls
  Instagram; links simply open Instagram in a new tab.
- Who can access: Super Admins/Admins/Viewers through the app (as in the table above); people with access to the
  Vercel project or Neon console. Keep those accounts limited and protected with 2FA.

## 6. Backups

- **Neon** keeps point-in-time restore history (the free plan keeps a short window — check your plan's
  “history retention” setting; paid plans keep longer). Restoring creates a branch you can point `DATABASE_URL` to.
- **Weekly export (recommended):** download a full CSV from **Export** for the past weeks and store it in a
  restricted company Drive folder; or, for a complete database copy:

  ```bash
  pg_dump "$DATABASE_URL" --no-owner --format=custom -f content-tracker-$(date +%F).dump
  # restore: pg_restore --no-owner -d "$NEW_DATABASE_URL" content-tracker-YYYY-MM-DD.dump
  ```

  Treat dumps and exports as confidential.

## 7. Deactivating someone

Roster → person → **Deactivate**. Effect is immediate: they are signed out on every device, cannot sign in (Google or
password), outstanding setup links are cancelled, and they disappear from daily tracking. Their history stays for
reporting and audit. **Reactivate** restores access. Pending applicants who should never get access can be
**rejected** (removed).

To pause tracking without removing access (leave, etc.), edit the person → *Daily tracking: Exception*.

## 8. Account recovery

- Forgotten password: an Admin (or Super Admin for staff) creates a new setup link from the person's page — it
  doubles as a password reset and signs out other sessions.
- Google account problems: fix the email on the roster if it changed.
- Every Super Admin locked out: someone with the database URL runs
  `DATABASE_URL=… APP_URL=… npm run setup-link -- superadmin@company.com`.

## 9. Updating the app

Push to the GitHub repository → Vercel builds, migrates and deploys automatically. Schema changes: edit
`src/lib/db/schema.ts`, run `npm run db:generate`, commit the generated SQL in `drizzle/`.

## 10. Go-live checklist (needs your approval)

- [ ] Neon database created and connected; `DATABASE_URL`, `APP_URL` set.
- [ ] Google OAuth client created (Internal), `GOOGLE_*`, `ALLOWED_GOOGLE_DOMAINS` set — or decision to use setup links.
- [ ] First Super Admin created; `BOOTSTRAP_SUPER_ADMIN_EMAIL` removed afterwards.
- [ ] Working days, cutoff (7:00 PM) and holidays checked in Settings.
- [ ] Staff roles reviewed (founders/board as Viewer).
- [ ] Deployment Protection reviewed for production.
- [ ] Vercel plan confirmed for company use.
- [ ] Only then: import the real Google Forms CSV and approve applicants.

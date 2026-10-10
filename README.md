# Daily Content Tracker — IND Global Realty

A small, secure internal web app for tracking daily Instagram content from agents and managers who opt in
through the Google Form.

- **Agents / Managers** sign in, see their profile and daily status, and record *Posted* (with the post/reel link)
  or *Not posted* (with a short reason) for today, or as a late update for the previous working day.
- **Admins** import approved applicants from the Google Forms CSV, manage the roster, and follow up on missing
  updates from a dashboard that flags everyone without an update at **7:00 PM Dubai time**.
- **Viewers** (e.g. founders, board members) see dashboards and the roster read-only.
- **Super Admins** also manage roles, staff invitations and the audit log.

> Status: first version. It uses fictional sample data only. **Do not import real employee data or make the
> deployment public until the setup and access controls are approved** (see `docs/DEPLOYMENT.md` → Go-live checklist).

## Proposed stack (summary)

| Area | Choice | Why |
| --- | --- | --- |
| App | Next.js 16 (App Router, React Server Components, server actions), TypeScript | One codebase for UI + server; every permission check runs on the server. Works on phones and desktop. |
| Database | PostgreSQL via Drizzle ORM. **Neon** (Vercel Marketplace) in production; embedded **PGlite** locally and in tests | Zero-install local development; managed backups in production. |
| Hosting | Vercel (new project `daily-content-tracker`, separate from the other projects) | Git-push deploys, HTTPS, Deployment Protection. |
| Sign-in | **Company Google sign-in** (OAuth/OpenID Connect) restricted to approved roster emails and optionally your Workspace domain; fallback: **one-time setup links** that let a person choose their own password (bcrypt-hashed) | No generated passwords, no plain-text passwords, no Instagram access needed. |
| 7 PM flags | Computed from the configured cutoff each time the dashboard loads | No scheduled job to fail or misconfigure; late submissions keep a permanent “submitted late / missed cutoff” flag. |

**Expected costs:** the app fits within the free tiers of Vercel Hobby and Neon Free for ~70 users
(small database, light traffic). Vercel Hobby is intended for non-commercial use; for a company tool Vercel's
Pro plan (currently around $20 per member/month) is the compliant option — confirm with whoever owns the Vercel
account. Google sign-in is free; it requires a Google Cloud project and, ideally, Google Workspace on your
company domain so you can restrict sign-in to `@yourdomain` accounts. No paid services were purchased.

## Quick start (local, fictional data)

Requires Node.js 20+.

```bash
npm install
cp .env.example .env.local            # then set ENABLE_DEV_LOGIN=true for local testing
npm run db:reset-local                # creates ./.data/pglite and loads fictional sample people
npm run dev                           # http://localhost:3000
```

With `ENABLE_DEV_LOGIN=true` the sign-in page shows a picker to sign in as any sample user
(Super Admin *Layla Haddad*, Admin *Omar Siddiqui*, Viewer *Rania Farouk*, agents such as *Sara Mendes*).
This picker never appears in a production build.

Useful commands:

| Command | What it does |
| --- | --- |
| `npm test` | Unit + end-to-end business-rule tests (in-memory Postgres) |
| `npm run typecheck` | TypeScript check |
| `npm run db:reset-local` | Wipe local DB and reload fictional sample data |
| `npm run db:generate` | Create a new SQL migration after editing `src/lib/db/schema.ts` |
| `npm run db:migrate` | Apply migrations to `DATABASE_URL` (runs automatically on Vercel builds) |
| `npm run bootstrap-admin -- you@company.com "Your Name"` | Create the first Super Admin and print a one-time setup link |
| `npm run setup-link -- someone@company.com` | Account recovery: print a fresh one-time setup / reset link |

## Documentation

- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — environment variables, Vercel + Neon, Google sign-in, access control,
  where data lives, backups, deactivation and account recovery, go-live checklist.
- [`docs/ADMIN_GUIDE.md`](docs/ADMIN_GUIDE.md) — importing and approving applicants, daily follow-up, exports.
- [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md) — for agents and managers: signing in and daily updates.
- [`docs/TESTING.md`](docs/TESTING.md) — how to test the cutoff, late submissions, permissions and backfill.
- [`sample-data/google-form-responses-sample.csv`](sample-data/google-form-responses-sample.csv) — fictional Google
  Forms export (includes deliberate duplicates and errors to show validation).

## Project layout

```
src/app/                 pages (agent: /me, admin: /admin/*), sign-in, API routes (Google OAuth, CSV export)
src/lib/db/schema.ts     database tables
src/lib/services/        all business rules + permission checks (users, records, dashboard, CSV import, auth)
src/lib/calendar.ts      working days, holidays, 7 PM cutoff (Asia/Dubai)
src/lib/status.ts        Posted / Not posted / No update / Submitted late rules
src/lib/permissions.ts   role definitions
drizzle/                 SQL migrations
scripts/                 migrate, seed (fictional), bootstrap-admin, setup-link
tests/                   automated tests
```

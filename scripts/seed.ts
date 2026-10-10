// Loads FICTIONAL sample data for local development and demos.
// Refuses to run against a hosted database unless --allow-hosted-demo is passed.
import { and, eq } from "drizzle-orm";
import { createDb } from "../src/lib/db";
import { users, dailyRecords, recordHistory, followups, appSettings, holidays } from "../src/lib/db/schema";
import { WorkCalendar, DEFAULT_CALENDAR, todayInDubai } from "../src/lib/calendar";
import { addDays } from "../src/lib/time";

const url = process.env.DATABASE_URL;
if (url && !url.startsWith("pglite:") && !process.argv.includes("--allow-hosted-demo")) {
  console.error("Refusing to seed a hosted database with sample data. Pass --allow-hosted-demo for a demo/staging DB only.");
  process.exit(1);
}

const staff = [
  { name: "Layla Haddad", email: "layla.haddad@example.com", role: "super_admin" as const, position: "Content Lead" },
  { name: "Omar Siddiqui", email: "omar.siddiqui@example.com", role: "admin" as const, position: "Content Coordinator" },
  { name: "Rania Farouk", email: "rania.farouk@example.com", role: "viewer" as const, position: "Founder" },
];

const members = [
  ["Sara Mendes", "Agent", "Team Marina"],
  ["Daniel Okafor", "Agent", "Team Marina"],
  ["Priya Raman", "Manager", "Team Marina"],
  ["Yusuf Karim", "Agent", "Team Downtown"],
  ["Elena Petrova", "Agent", "Team Downtown"],
  ["Hassan Nouri", "Manager", "Team Downtown"],
  ["Mei Lin Tan", "Agent", "Team JVC"],
  ["Lucas Ferreira", "Agent", "Team JVC"],
  ["Aisha Rahman", "Agent", "Team JVC"],
  ["Tom Becker", "Manager", "Team JVC"],
  ["Fatima Zahra", "Agent", "Team Marina"],
  ["Arjun Mehta", "Agent", "Team Downtown"],
] as const;

const pending = [
  ["Noura Salem", "Agent"],
  ["Kevin O'Brien", "Agent"],
  ["Zara Qureshi", "Manager"],
] as const;

const slug = (name: string) => name.toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "");

// Deterministic pseudo-random so every reset looks the same.
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

async function main() {
  const db = await createDb(url || undefined, { migrate: true });
  const at = new Date();
  const today = todayInDubai(at);
  const cal = new WorkCalendar(DEFAULT_CALENDAR);
  // History for the last 10 working days before today (today is left empty so you can test submitting).
  const days = cal.recentWorkingDays(addDays(today, -1), 10);
  const start = days[days.length - 1];

  await db.delete(followups);
  await db.delete(recordHistory);
  await db.delete(dailyRecords);
  await db.delete(users);
  await db.delete(holidays);
  await db.insert(appSettings).values({ id: 1 }).onConflictDoUpdate({ target: appSettings.id, set: { workingDays: "1,2,3,4,5", cutoffTime: "19:00" } });

  const [lead] = await db
    .insert(users)
    .values(staff.map((s) => ({ ...s, status: "active" as const, approvedAt: at, trackingStartDate: start, source: "seed" })))
    .returning();

  const memberRows = await db
    .insert(users)
    .values(
      members.map(([name, position, team]) => ({
        name,
        email: `${slug(name)}@example.com`,
        instagramHandle: `demo.${slug(name).replace(/\./g, "_")}`,
        instagramUrl: `https://www.instagram.com/demo.${slug(name).replace(/\./g, "_")}/`,
        role: "member" as const,
        status: "active" as const,
        position,
        team,
        approvedAt: at,
        approvedById: lead.id,
        trackingStartDate: start,
        source: "seed",
      })),
    )
    .returning();

  await db.insert(users).values([
    ...pending.map(([name, position]) => ({
      name,
      email: `${slug(name)}@example.com`,
      instagramHandle: `demo.${slug(name).replace(/\./g, "_")}`,
      instagramUrl: `https://www.instagram.com/demo.${slug(name).replace(/\./g, "_")}/`,
      role: "member" as const,
      status: "pending" as const,
      position,
      source: "csv",
    })),
    {
      name: "Former Agent",
      email: "former.agent@example.com",
      instagramHandle: "demo.former_agent",
      instagramUrl: "https://www.instagram.com/demo.former_agent/",
      role: "member" as const,
      status: "inactive" as const,
      position: "Agent",
      approvedAt: at,
      approvedById: lead.id,
      deactivatedAt: at,
      deactivatedById: lead.id,
      trackingStartDate: start,
      source: "seed",
    },
  ]);

  let n = 0;
  for (const date of days) {
    const cutoffAt = cal.cutoffAt(date);
    for (const m of memberRows) {
      const r = rand();
      // Leave the most recent day partly missing so the follow-up list has entries.
      if (r < (date === days[0] ? 0.3 : 0.08)) continue;
      const posted = r > 0.25;
      const late = r > 0.9;
      const submittedAt = new Date(cutoffAt.getTime() + (late ? 3 : -5) * 3_600_000 + Math.floor(rand() * 3_600_000));
      const code = `DEMO${(n++).toString(36).toUpperCase()}x${Math.floor(rand() * 1e6).toString(36)}`;
      const values = {
        userId: m.id,
        workDate: date,
        status: posted ? ("posted" as const) : ("not_posted" as const),
        postUrl: posted ? `https://www.instagram.com/${rand() > 0.5 ? "reel" : "p"}/${code}/` : null,
        reason: posted ? null : ["Client viewings all day", "Filming tomorrow, editing today", "Unwell"][Math.floor(rand() * 3)],
        submittedAt,
        cutoffAt,
        submittedLate: late,
        updatedAt: submittedAt,
        lastEditedById: m.id,
      };
      const [rec] = await db.insert(dailyRecords).values(values).returning();
      await db.insert(recordHistory).values({
        recordId: rec.id,
        userId: m.id,
        workDate: date,
        action: "created",
        changedAt: submittedAt,
        changedById: m.id,
        afterCutoff: late,
        newStatus: values.status,
        newPostUrl: values.postUrl,
        newReason: values.reason,
      });
    }
  }
  // One resolved missing update on an older day, as an example.
  const older = days[days.length - 1];
  const [missing] = memberRows;
  await db.delete(dailyRecords).where(and(eq(dailyRecords.userId, missing.id), eq(dailyRecords.workDate, older)));
  await db.insert(followups).values({
    userId: missing.id,
    workDate: older,
    kind: "resolution",
    body: "Called — was at a client event; posted a story only. OK for this day.",
    authorId: lead.id,
    createdAt: at,
  });

  console.log(`Seeded ${staff.length} staff, ${members.length} active agents/managers, ${pending.length} pending, 1 inactive (all fictional).`);
  console.log("Start the app with ENABLE_DEV_LOGIN=true to sign in as any sample user.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

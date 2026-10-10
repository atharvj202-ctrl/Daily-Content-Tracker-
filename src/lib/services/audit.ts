import { desc } from "drizzle-orm";
import type { DB } from "../db";
import { auditLog, type User } from "../db/schema";

export async function audit(
  db: DB,
  actor: Pick<User, "id"> | null,
  action: string,
  targetUserId: string | null,
  details?: Record<string, unknown>,
) {
  await db.insert(auditLog).values({ actorId: actor?.id ?? null, action, targetUserId, details: details ?? null });
}

export async function recentAudit(db: DB, limit = 200) {
  return db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(limit);
}

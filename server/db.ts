import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, researchRuns, users } from "../drizzle/schema";
import { ENV } from './_core/env';
import type { ResearchRunSnapshot } from "@shared/agent";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function hydrateResearchRun(row: typeof researchRuns.$inferSelect): ResearchRunSnapshot {
  return {
    id: row.id,
    originalRequest: row.originalRequest,
    status: row.status,
    phase: row.phase,
    currentAction: row.currentAction,
    interpretation: parseJson(row.interpretation, null),
    plan: parseJson(row.plan, []),
    sources: parseJson(row.sources, []),
    evidence: parseJson(row.evidence, []),
    activities: parseJson(row.activities, []),
    visitedUrls: parseJson(row.visitedUrls, []),
    errors: parseJson(row.errors, []),
    retries: row.retries,
    finalAnswer: row.finalAnswer,
    finalFindings: parseJson(row.finalFindings, []),
    confirmation: parseJson(row.confirmation, null),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeResearchRun(snapshot: ResearchRunSnapshot) {
  return {
    status: snapshot.status,
    phase: snapshot.phase,
    currentAction: snapshot.currentAction,
    interpretation: snapshot.interpretation ? JSON.stringify(snapshot.interpretation) : null,
    plan: JSON.stringify(snapshot.plan),
    sources: JSON.stringify(snapshot.sources),
    evidence: JSON.stringify(snapshot.evidence),
    activities: JSON.stringify(snapshot.activities),
    visitedUrls: JSON.stringify(snapshot.visitedUrls),
    errors: JSON.stringify(snapshot.errors),
    retries: snapshot.retries,
    finalAnswer: snapshot.finalAnswer,
    finalFindings: JSON.stringify(snapshot.finalFindings),
    confirmation: snapshot.confirmation ? JSON.stringify(snapshot.confirmation) : null,
  };
}

export async function createResearchRun(snapshot: ResearchRunSnapshot, userId?: number) {
  const db = await getDb();
  if (!db) return snapshot;
  await db.insert(researchRuns).values({
    id: snapshot.id,
    userId: userId ?? null,
    originalRequest: snapshot.originalRequest,
    ...serializeResearchRun(snapshot),
  });
  return snapshot;
}

export async function updateResearchRun(snapshot: ResearchRunSnapshot) {
  const db = await getDb();
  if (!db) return snapshot;
  await db.update(researchRuns).set(serializeResearchRun(snapshot)).where(eq(researchRuns.id, snapshot.id));
  return snapshot;
}

export async function getResearchRun(id: string): Promise<ResearchRunSnapshot | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(researchRuns).where(eq(researchRuns.id, id)).limit(1);
  return result[0] ? hydrateResearchRun(result[0]) : null;
}

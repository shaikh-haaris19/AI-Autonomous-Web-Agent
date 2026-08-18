import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/** Durable execution snapshots for research requests. JSON columns are stored as text to keep the schema portable. */
export const researchRuns = mysqlTable("researchRuns", {
  id: varchar("id", { length: 40 }).primaryKey(),
  userId: int("userId"),
  originalRequest: text("originalRequest").notNull(),
  status: mysqlEnum("status", ["queued", "running", "completed", "needs_confirmation", "failed"]).notNull(),
  phase: mysqlEnum("phase", ["planning", "searching", "browsing", "collecting", "verifying", "comparing", "completing", "needs_confirmation", "failed"]).notNull(),
  currentAction: varchar("currentAction", { length: 512 }).notNull(),
  interpretation: text("interpretation"),
  plan: text("plan").notNull(),
  sources: text("sources").notNull(),
  evidence: text("evidence").notNull(),
  activities: text("activities").notNull(),
  visitedUrls: text("visitedUrls").notNull(),
  errors: text("errors").notNull(),
  retries: int("retries").notNull().default(0),
  finalAnswer: text("finalAnswer"),
  finalFindings: text("finalFindings").notNull(),
  confirmation: text("confirmation"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ResearchRun = typeof researchRuns.$inferSelect;

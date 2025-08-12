import { pgSchema, pgTable, uuid, text, timestamp, integer } from "drizzle-orm/pg-core";

export const stores = pgTable("stores", {
  storeId: uuid("store_id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("Asia/Tokyo"),
});

export const members = pgTable("members", {
  memberId: uuid("member_id").defaultRandom().primaryKey(),
  storeId: uuid("store_id").references(() => stores.storeId).notNull(),
  lineUserId: text("line_user_id").notNull(),
  displayName: text("display_name"),
});

export const menus = pgTable("menus", {
  menuId: uuid("menu_id").defaultRandom().primaryKey(),
  storeId: uuid("store_id").references(() => stores.storeId).notNull(),
  name: text("name").notNull(),
  durationMin: integer("duration_min").notNull(),
});

export const reservations = pgTable("reservations", {
  reservationId: uuid("reservation_id").defaultRandom().primaryKey(),
  storeId: uuid("store_id").references(() => stores.storeId).notNull(),
  memberId: uuid("member_id").references(() => members.memberId).notNull(),
  menuId: uuid("menu_id").references(() => menus.menuId).notNull(),
  staffId: uuid("staff_id"),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  endAt:   timestamp("end_at",   { withTimezone: true }).notNull(),
  status:  text("status").notNull(), // confirmed/arrived/done/cancelled/no_show
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const notificationJobs = pgTable("notification_jobs", {
  jobId: uuid("job_id").defaultRandom().primaryKey(),
  reservationId: uuid("reservation_id").references(() => reservations.reservationId).notNull(),
  storeId: uuid("store_id").references(() => stores.storeId).notNull(),
  type: text("type").notNull(), // reminder_24h, reminder_2h
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("scheduled"), // scheduled/sent/failed
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
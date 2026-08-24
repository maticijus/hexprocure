import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", [
  "REQUESTER",
  "MANAGER",
  "FINANCE",
  "ADMIN",
]);

export const requisitionStatus = pgEnum("requisition_status", [
  "DRAFT",
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
]);

export const poStatus = pgEnum("po_status", ["OPEN", "CLOSED", "CANCELLED"]);

export const poLineKind = pgEnum("po_line_kind", ["GOODS", "SERVICE"]);

export const invoiceStatus = pgEnum("invoice_status", [
  "PENDING",
  "MATCHED",
  "EXCEPTION",
  "APPROVED",
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: userRole("role").notNull().default("REQUESTER"),
  passwordHash: text("password_hash"),
});

export const suppliers = pgTable("suppliers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email"),
});

export const costCenters = pgTable("cost_centers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
});

export const approvalRules = pgTable("approval_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  sequence: integer("sequence").notNull(),
  minMinor: integer("min_minor").notNull(),
  maxMinor: integer("max_minor"),
  approverRole: text("approver_role").notNull(),
  currency: text("currency").notNull().default("EUR"),
});

export const budgets = pgTable(
  "budgets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    costCenterId: uuid("cost_center_id")
      .notNull()
      .references(() => costCenters.id),
    yearMonth: text("year_month").notNull(),
    budgetedMinor: integer("budgeted_minor").notNull(),
    currency: text("currency").notNull().default("EUR"),
  },
  (t) => [uniqueIndex("budget_cc_month_uq").on(t.costCenterId, t.yearMonth)],
);

export const budgetReservations = pgTable("budget_reservations", {
  id: uuid("id").primaryKey().defaultRandom(),
  budgetId: uuid("budget_id")
    .notNull()
    .references(() => budgets.id),
  purchaseOrderId: uuid("purchase_order_id"),
  amountMinor: integer("amount_minor").notNull(),
});

export const requisitions = pgTable("requisitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  requesterId: uuid("requester_id")
    .notNull()
    .references(() => users.id),
  supplierId: uuid("supplier_id")
    .notNull()
    .references(() => suppliers.id),
  costCenterId: uuid("cost_center_id")
    .notNull()
    .references(() => costCenters.id),
  status: requisitionStatus("status").notNull().default("DRAFT"),
  currency: text("currency").notNull().default("EUR"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const requisitionLines = pgTable("requisition_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  requisitionId: uuid("requisition_id")
    .notNull()
    .references(() => requisitions.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull(),
  unitPriceMinor: integer("unit_price_minor").notNull(),
  kind: poLineKind("kind").notNull().default("GOODS"),
});

export const approvals = pgTable("approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  requisitionId: uuid("requisition_id")
    .notNull()
    .references(() => requisitions.id, { onDelete: "cascade" }),
  ruleId: uuid("rule_id").references(() => approvalRules.id),
  approverRole: text("approver_role").notNull(),
  sequence: integer("sequence").notNull(),
  decidedByUserId: uuid("decided_by_user_id").references(() => users.id),
  decision: text("decision"),
  comment: text("comment"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});

export const purchaseOrders = pgTable("purchase_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  requisitionId: uuid("requisition_id").references(() => requisitions.id),
  supplierId: uuid("supplier_id")
    .notNull()
    .references(() => suppliers.id),
  costCenterId: uuid("cost_center_id")
    .notNull()
    .references(() => costCenters.id),
  status: poStatus("status").notNull().default("OPEN"),
  currency: text("currency").notNull().default("EUR"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const poLines = pgTable("po_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  purchaseOrderId: uuid("purchase_order_id")
    .notNull()
    .references(() => purchaseOrders.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  quantityOrdered: integer("quantity_ordered").notNull(),
  unitPriceMinor: integer("unit_price_minor").notNull(),
  kind: poLineKind("kind").notNull().default("GOODS"),
});

export const receipts = pgTable("receipts", {
  id: uuid("id").primaryKey().defaultRandom(),
  purchaseOrderId: uuid("purchase_order_id")
    .notNull()
    .references(() => purchaseOrders.id, { onDelete: "cascade" }),
  receivedByUserId: uuid("received_by_user_id").references(() => users.id),
  receivedAt: timestamp("received_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const receiptLines = pgTable("receipt_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  receiptId: uuid("receipt_id")
    .notNull()
    .references(() => receipts.id, { onDelete: "cascade" }),
  poLineId: uuid("po_line_id")
    .notNull()
    .references(() => poLines.id),
  quantityReceived: integer("quantity_received").notNull(),
});

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    purchaseOrderId: uuid("purchase_order_id")
      .notNull()
      .references(() => purchaseOrders.id),
    number: text("number").notNull(),
    status: invoiceStatus("status").notNull().default("PENDING"),
    exceptions: jsonb("exceptions").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("invoice_supplier_number_uq").on(t.supplierId, t.number)],
);

export const invoiceLines = pgTable("invoice_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => invoices.id, { onDelete: "cascade" }),
  poLineId: uuid("po_line_id").references(() => poLines.id),
  quantity: integer("quantity").notNull(),
  unitPriceMinor: integer("unit_price_minor").notNull(),
  /** Authoritative billed amount for SERVICE lines. */
  amountMinor: integer("amount_minor"),
});

export const apiTokens = pgTable("api_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const orderCadence = pgEnum("order_cadence", [
  "MONTHLY",
  "QUARTERLY",
  "YEARLY",
]);

export const orderTemplates = pgTable("order_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  requesterId: uuid("requester_id")
    .notNull()
    .references(() => users.id),
  supplierId: uuid("supplier_id")
    .notNull()
    .references(() => suppliers.id),
  costCenterId: uuid("cost_center_id")
    .notNull()
    .references(() => costCenters.id),
  cadence: orderCadence("cadence").notNull().default("MONTHLY"),
  nextRunDate: text("next_run_date").notNull(),
  active: boolean("active").notNull().default(true),
});

export const orderTemplateLines = pgTable("order_template_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  templateId: uuid("template_id")
    .notNull()
    .references(() => orderTemplates.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull(),
  unitPriceMinor: integer("unit_price_minor").notNull(),
  kind: poLineKind("kind").notNull().default("GOODS"),
});

export const integrationConnectionStatus = pgEnum("integration_connection_status", [
  "ACTIVE",
  "EXPIRED",
  "REVOKED",
  "ERROR",
]);

export const integrationsConnections = pgTable("integrations_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull(),
  realmId: text("realm_id").notNull(),
  accessTokenEnc: text("access_token_enc").notNull(),
  refreshTokenEnc: text("refresh_token_enc").notNull(),
  accessExpiresAt: timestamp("access_expires_at", { withTimezone: true }).notNull(),
  refreshExpiresAt: timestamp("refresh_expires_at", { withTimezone: true }).notNull(),
  status: integrationConnectionStatus("status").notNull().default("ACTIVE"),
  lastError: text("last_error"),
  connectedByUserId: uuid("connected_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const qboSyncMap = pgTable("qbo_sync_map", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => integrationEvents.id),
  entityType: text("entity_type").notNull(),
  localEntityId: uuid("local_entity_id").notNull(),
  qboEntityId: text("qbo_entity_id").notNull(),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
});

export const attachmentEntityType = pgEnum("attachment_entity_type", [
  "requisition",
  "purchase_order",
  "invoice",
]);

export const attachments = pgTable("attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  entityType: attachmentEntityType("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  storageKey: text("storage_key").notNull(),
  uploadedByUserId: uuid("uploaded_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  action: text("action").notNull(),
  actorUserId: uuid("actor_user_id").references(() => users.id),
  payload: jsonb("payload").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const integrationEventStatus = pgEnum("integration_event_status", [
  "PENDING",
  "DELIVERED",
  "FAILED",
]);

export const integrationEvents = pgTable("integration_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  status: integrationEventStatus("status").notNull().default("PENDING"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
});

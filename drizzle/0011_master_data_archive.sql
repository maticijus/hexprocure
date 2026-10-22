ALTER TABLE "suppliers" ADD COLUMN "archived_at" timestamptz;--> statement-breakpoint
ALTER TABLE "cost_centers" ADD COLUMN "archived_at" timestamptz;--> statement-breakpoint
ALTER TABLE "budgets" ADD COLUMN "archived_at" timestamptz;--> statement-breakpoint
ALTER TABLE "approval_rules" ADD COLUMN "archived_at" timestamptz;

CREATE TYPE "public"."order_cadence" AS ENUM('MONTHLY', 'QUARTERLY', 'YEARLY');--> statement-breakpoint
CREATE TABLE "order_template_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"description" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_minor" integer NOT NULL,
	"kind" "po_line_kind" DEFAULT 'GOODS' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"requester_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"cost_center_id" uuid NOT NULL,
	"cadence" "order_cadence" DEFAULT 'MONTHLY' NOT NULL,
	"next_run_date" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_template_lines" ADD CONSTRAINT "order_template_lines_template_id_order_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."order_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_templates" ADD CONSTRAINT "order_templates_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_templates" ADD CONSTRAINT "order_templates_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_templates" ADD CONSTRAINT "order_templates_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;
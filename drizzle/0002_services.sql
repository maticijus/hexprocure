CREATE TYPE "public"."po_line_kind" AS ENUM('GOODS', 'SERVICE');--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "amount_minor" integer;--> statement-breakpoint
ALTER TABLE "po_lines" ADD COLUMN "kind" "po_line_kind" DEFAULT 'GOODS' NOT NULL;--> statement-breakpoint
ALTER TABLE "requisition_lines" ADD COLUMN "kind" "po_line_kind" DEFAULT 'GOODS' NOT NULL;
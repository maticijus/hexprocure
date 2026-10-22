DROP INDEX "purchase_order_requisition_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_order_requisition_uq" ON "purchase_orders" USING btree ("requisition_id") WHERE "purchase_orders"."requisition_id" IS NOT NULL AND "purchase_orders"."status" <> 'CANCELLED';--> statement-breakpoint
UPDATE "requisitions" SET "status" = 'ORDERED' WHERE "status" = 'APPROVED' AND "id" IN (SELECT "requisition_id" FROM "purchase_orders" WHERE "requisition_id" IS NOT NULL AND "status" <> 'CANCELLED');

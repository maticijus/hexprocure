CREATE UNIQUE INDEX "suppliers_active_name_uq" ON "suppliers" USING btree (lower("name")) WHERE "suppliers"."archived_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "cost_centers_active_name_uq" ON "cost_centers" USING btree (lower("name")) WHERE "cost_centers"."archived_at" IS NULL;

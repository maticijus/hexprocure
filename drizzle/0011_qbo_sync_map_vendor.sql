ALTER TABLE "qbo_sync_map" ALTER COLUMN "event_id" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "qbo_sync_map_vendor_uq" ON "qbo_sync_map" ("local_entity_id") WHERE "entity_type" = 'VENDOR';

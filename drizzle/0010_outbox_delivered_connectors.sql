ALTER TABLE "integration_events" ADD COLUMN "delivered_connectors" jsonb DEFAULT '[]'::jsonb NOT NULL;

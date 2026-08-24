CREATE TYPE "public"."integration_connection_status" AS ENUM('ACTIVE', 'EXPIRED', 'REVOKED', 'ERROR');--> statement-breakpoint
CREATE TABLE "integrations_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"realm_id" text NOT NULL,
	"access_token_enc" text NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"access_expires_at" timestamp with time zone NOT NULL,
	"refresh_expires_at" timestamp with time zone NOT NULL,
	"status" "integration_connection_status" DEFAULT 'ACTIVE' NOT NULL,
	"last_error" text,
	"connected_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qbo_sync_map" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"local_entity_id" uuid NOT NULL,
	"qbo_entity_id" text NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integrations_connections" ADD CONSTRAINT "integrations_connections_connected_by_user_id_users_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qbo_sync_map" ADD CONSTRAINT "qbo_sync_map_event_id_integration_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."integration_events"("id") ON DELETE no action ON UPDATE no action;
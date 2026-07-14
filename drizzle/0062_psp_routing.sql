-- Multi-PSP plumbing (plan Phase 0a): capability -> provider routing table.
-- Hand-authored per the 0050+ convention. Idempotent. Seeded to 'snippe' for
-- every capability = exactly today's behavior (zero behavior change).

CREATE TABLE IF NOT EXISTS "psp_routing" (
	"capability" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"rules" jsonb,
	"note" text,
	"updated_by_user_id" uuid REFERENCES "users"("id"),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

INSERT INTO "psp_routing" ("capability", "provider", "note") VALUES
	('collections_mobile', 'snippe', 'seeded: current behavior'),
	('collections_card', 'snippe', 'seeded: current behavior (snippe_card deposits)'),
	('payouts_mobile', 'snippe', 'seeded: current behavior'),
	('payouts_bank', 'snippe', 'seeded: current behavior')
ON CONFLICT ("capability") DO NOTHING;

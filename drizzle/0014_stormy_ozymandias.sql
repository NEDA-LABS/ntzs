CREATE TABLE "lp_fx_config" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"mid_rate_tzs" integer DEFAULT 3750 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

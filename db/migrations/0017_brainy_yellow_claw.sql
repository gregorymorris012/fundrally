CREATE TYPE "public"."payout_status" AS ENUM('pending', 'in_transit', 'paid', 'failed', 'canceled');--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"stripe_payout_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"status" "payout_status" NOT NULL,
	"arrival_date" timestamp with time zone,
	"failure_code" text,
	"failure_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payouts_stripe_payout_id_unique" UNIQUE("stripe_payout_id")
);
--> statement-breakpoint
ALTER TABLE "payouts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
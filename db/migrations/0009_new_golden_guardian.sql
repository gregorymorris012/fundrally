CREATE TYPE "public"."transaction_method" AS ENUM('stripe', 'cash', 'check', 'in_kind', 'other');--> statement-breakpoint
ALTER TYPE "public"."transaction_kind" ADD VALUE 'adjustment';--> statement-breakpoint
ALTER TYPE "public"."module_status" ADD VALUE 'paused';--> statement-breakpoint
CREATE TABLE "module_availability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"module_type" "module_type" NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "module_availability_org_type_unique" UNIQUE("org_id","module_type")
);
--> statement-breakpoint
ALTER TABLE "module_availability" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "method" "transaction_method" DEFAULT 'stripe' NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "entered_by" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "entered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "reference" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "adjusts_transaction_id" uuid;--> statement-breakpoint
ALTER TABLE "module_availability" ADD CONSTRAINT "module_availability_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_entered_by_users_id_fk" FOREIGN KEY ("entered_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_adjusts_transaction_id_transactions_id_fk" FOREIGN KEY ("adjusts_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;
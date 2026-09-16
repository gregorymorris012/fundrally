CREATE TYPE "public"."draw_segment" AS ENUM('q1', 'q2', 'q3', 'half', 'final');--> statement-breakpoint
ALTER TABLE "module_entries" ADD COLUMN "price_cents" integer;--> statement-breakpoint
ALTER TABLE "module_entries" ADD COLUMN "transaction_id" uuid;--> statement-breakpoint
ALTER TABLE "draws" ADD COLUMN "segment" "draw_segment" DEFAULT 'final' NOT NULL;--> statement-breakpoint
ALTER TABLE "module_entries" ADD CONSTRAINT "module_entries_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;
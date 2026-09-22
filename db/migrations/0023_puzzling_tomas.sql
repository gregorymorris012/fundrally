ALTER TYPE "public"."module_type" ADD VALUE 'queen_of_hearts';--> statement-breakpoint
ALTER TYPE "public"."draw_segment" ADD VALUE 'board_shuffle';--> statement-breakpoint
ALTER TYPE "public"."draw_segment" ADD VALUE 'weekly_draw';--> statement-breakpoint
ALTER TABLE "module_entries" ADD COLUMN "cycle_number" integer;--> statement-breakpoint
ALTER TABLE "module_entries" ADD COLUMN "card_number" integer;--> statement-breakpoint
ALTER TABLE "module_entries" ADD COLUMN "quantity" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "draws" ADD COLUMN "cycle_number" integer;
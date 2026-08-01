CREATE TYPE "public"."inventory_ledger_reason" AS ENUM('purchase', 'drop', 'use', 'refund', 'gift', 'admin');--> statement-breakpoint
CREATE TYPE "public"."purchase_status" AS ENUM('pending', 'paid', 'refunded');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "daily_stats" (
	"user_id" bigint NOT NULL,
	"day" date NOT NULL,
	"runs" integer DEFAULT 0 NOT NULL,
	"best_score" integer DEFAULT 0 NOT NULL,
	"streak" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "daily_stats_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory_balance" (
	"user_id" bigint NOT NULL,
	"item" text NOT NULL,
	"qty" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "inventory_balance_user_id_item_pk" PRIMARY KEY("user_id","item"),
	CONSTRAINT "inventory_balance_qty_check" CHECK ("inventory_balance"."qty" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory_ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"item" text NOT NULL,
	"delta" integer NOT NULL,
	"reason" "inventory_ledger_reason" NOT NULL,
	"ref" text,
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" bigint NOT NULL,
	"telegram_payment_charge_id" text NOT NULL,
	"sku" text NOT NULL,
	"stars_amount" integer NOT NULL,
	"payload" text NOT NULL,
	"status" "purchase_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" bigint NOT NULL,
	"seed" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"score" integer DEFAULT 0 NOT NULL,
	"units_cleared" integer DEFAULT 0 NOT NULL,
	"max_combo" integer DEFAULT 0 NOT NULL,
	"pieces_placed" integer DEFAULT 0 NOT NULL,
	"perfect_clears" integer DEFAULT 0 NOT NULL,
	"used_powerups" boolean DEFAULT false NOT NULL,
	"revived" boolean DEFAULT false NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" bigint PRIMARY KEY NOT NULL,
	"username" text,
	"first_name" text,
	"photo_url" text,
	"language_code" text,
	"is_premium" boolean DEFAULT false NOT NULL,
	"referred_by" bigint,
	"ton_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fraud_score" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "daily_stats" ADD CONSTRAINT "daily_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventory_balance" ADD CONSTRAINT "inventory_balance_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventory_ledger" ADD CONSTRAINT "inventory_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventory_ledger" ADD CONSTRAINT "inventory_ledger_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchases" ADD CONSTRAINT "purchases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "runs" ADD CONSTRAINT "runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "purchases_charge_id_unique" ON "purchases" USING btree ("telegram_payment_charge_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runs_leaderboard_idx" ON "runs" USING btree ("verified","used_powerups","ended_at" DESC NULLS LAST,"score" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runs_daily_leaderboard_idx" ON "runs" USING btree ("verified","ended_at" DESC NULLS LAST,"score" DESC NULLS LAST) WHERE "runs"."ended_at" is not null;
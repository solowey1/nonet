CREATE TABLE IF NOT EXISTS "shop_skus" (
	"sku" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"stars_amount" integer NOT NULL,
	"contents" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "purchases" ALTER COLUMN "telegram_payment_charge_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "run_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchases" ADD CONSTRAINT "purchases_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_ledger_run_ref_unique" ON "inventory_ledger" USING btree ("run_id","ref") WHERE "inventory_ledger"."ref" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "purchases_payload_unique" ON "purchases" USING btree ("payload");
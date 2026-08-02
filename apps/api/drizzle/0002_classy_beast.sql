CREATE TABLE IF NOT EXISTS "user_achievements" (
	"user_id" bigint NOT NULL,
	"achievement_id" text NOT NULL,
	"times_completed" integer DEFAULT 0 NOT NULL,
	"last_completed_at" timestamp with time zone,
	"progress" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "user_achievements_user_id_achievement_id_pk" PRIMARY KEY("user_id","achievement_id")
);
--> statement-breakpoint
ALTER TABLE "daily_stats" ADD COLUMN "total_score" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_stats" ADD COLUMN "perfect_clears" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

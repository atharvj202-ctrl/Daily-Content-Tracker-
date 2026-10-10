CREATE TYPE "public"."followup_kind" AS ENUM('note', 'resolution', 'reviewed');--> statement-breakpoint
CREATE TYPE "public"."post_status" AS ENUM('posted', 'not_posted');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('super_admin', 'admin', 'viewer', 'member');--> statement-breakpoint
CREATE TYPE "public"."tracking_status" AS ENUM('tracked', 'exempt');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('pending', 'active', 'inactive');--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"working_days" text DEFAULT '1,2,3,4,5' NOT NULL,
	"cutoff_time" text DEFAULT '19:00' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" uuid
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target_user_id" uuid,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"status" "post_status" NOT NULL,
	"post_url" text,
	"reason" text,
	"submitted_at" timestamp with time zone NOT NULL,
	"cutoff_at" timestamp with time zone NOT NULL,
	"submitted_late" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"last_edited_by_id" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "followups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"kind" "followup_kind" NOT NULL,
	"body" text NOT NULL,
	"author_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"date" date PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "record_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"action" text NOT NULL,
	"changed_at" timestamp with time zone NOT NULL,
	"changed_by_id" uuid,
	"after_cutoff" boolean NOT NULL,
	"previous_status" "post_status",
	"previous_post_url" text,
	"previous_reason" text,
	"new_status" "post_status" NOT NULL,
	"new_post_url" text,
	"new_reason" text
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "setup_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"instagram_handle" text,
	"instagram_url" text,
	"role" "role" DEFAULT 'member' NOT NULL,
	"status" "user_status" DEFAULT 'pending' NOT NULL,
	"position" text,
	"team" text,
	"tracking_status" "tracking_status" DEFAULT 'tracked' NOT NULL,
	"tracking_note" text,
	"tracking_start_date" date,
	"approved_at" timestamp with time zone,
	"approved_by_id" uuid,
	"deactivated_at" timestamp with time zone,
	"deactivated_by_id" uuid,
	"password_hash" text,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"source" text DEFAULT 'manual' NOT NULL,
	"form_submitted_at" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daily_records" ADD CONSTRAINT "daily_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followups" ADD CONSTRAINT "followups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_history" ADD CONSTRAINT "record_history_record_id_daily_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."daily_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setup_tokens" ADD CONSTRAINT "setup_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_records_user_date_unique" ON "daily_records" USING btree ("user_id","work_date");--> statement-breakpoint
CREATE INDEX "daily_records_date_idx" ON "daily_records" USING btree ("work_date");--> statement-breakpoint
CREATE INDEX "followups_user_date_idx" ON "followups" USING btree ("user_id","work_date");--> statement-breakpoint
CREATE INDEX "followups_date_idx" ON "followups" USING btree ("work_date");--> statement-breakpoint
CREATE INDEX "record_history_user_date_idx" ON "record_history" USING btree ("user_id","work_date");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status");
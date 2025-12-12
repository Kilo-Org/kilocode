DROP INDEX "tasks_language_exercise_idx";--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "iteration" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_language_exercise_iteration_idx" ON "tasks" USING btree ("run_id","language","exercise","iteration");
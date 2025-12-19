ALTER TABLE "tasks" DROP CONSTRAINT "tasks_run_id_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_task_metrics_id_taskMetrics_id_fk";
--> statement-breakpoint
ALTER TABLE "toolErrors" DROP CONSTRAINT "toolErrors_run_id_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "toolErrors" DROP CONSTRAINT "toolErrors_task_id_tasks_id_fk";
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_task_metrics_id_taskMetrics_id_fk" FOREIGN KEY ("task_metrics_id") REFERENCES "public"."taskMetrics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "toolErrors" ADD CONSTRAINT "toolErrors_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "toolErrors" ADD CONSTRAINT "toolErrors_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
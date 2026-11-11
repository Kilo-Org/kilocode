// The scheduling tools: the tool names, inputs and result text agent prompts already use. The action-time reminder in
// each successful result carries the rules that matter at the call, so the always-on prompt stays short. Each tool acts
// only on the calling session's own tasks.
import type { Agent } from "@opencode/schema/agent"
import type { SessionID } from "@opencode/schema/session-id"
import type { SessionMessage } from "@opencode/schema/session-message"
import type { Tool } from "@opencode/schema/tool"
import { Effect, Schema } from "effect"
import CANCEL from "./cancel-wakeup.txt"
import CRON_CREATE from "./cron-create.txt"
import CRON_DELETE from "./cron-delete.txt"
import CRON_LIST from "./cron-list.txt"
import SCHEDULE from "./schedule-wakeup.txt"
import { excerpt, relative } from "./schema"
import type { WakeupService } from "./service"

type ContextInput = {
  readonly sessionID: SessionID
  readonly agent: Agent.ID
  readonly messageID: SessionMessage.ID
  readonly id: Tool.CallID
}

const ScheduleParams = Schema.Struct({
  prompt: Schema.String.annotate({
    description: "Text to resume this session with when the wakeup fires. No user is present, so make it self-contained.",
  }),
  delay: Schema.optional(Schema.String).annotate({
    description: "Relative span from now: 30s, 5m, 2h, 1d. A bare number is seconds. Under 10s is raised to 10s.",
  }),
  when: Schema.optional(Schema.String).annotate({
    description: "Absolute ISO-8601 date-time, e.g. 2026-09-13T14:30:00Z, in the future. Offset optional.",
  }),
  reason: Schema.optional(Schema.String).annotate({
    description: "Short label shown in the sidebar and in cancel_wakeup's list.",
  }),
})

const CancelParams = Schema.Struct({
  action: Schema.Literals(["list", "cancel"]).annotate({ description: "Operation to perform" }),
  id: Schema.optional(Schema.String).annotate({
    description: "Required for cancel. Id of the pending wakeup to cancel.",
  }),
}).check(
  Schema.makeFilter((params: { action: "list" | "cancel"; id?: string }) =>
    params.action === "cancel" && !params.id?.trim() ? "id is required when action is cancel" : undefined,
  ),
)

const CronCreateParams = Schema.Struct({
  prompt: Schema.String.annotate({
    description: "Text to resume this session with each time the task fires. No user is present, so make it self-contained.",
  }),
  cron: Schema.optional(Schema.String).annotate({
    description: "Recurring 5-field cron expression, e.g. */5 * * * *. The smallest interval is one minute.",
  }),
  when: Schema.optional(Schema.String).annotate({
    description: "Absolute ISO-8601 date-time for a one-shot task, e.g. 2026-09-13T14:30:00Z. Offset optional.",
  }),
  delay: Schema.optional(Schema.String).annotate({
    description: "Relative span from now for a one-shot task: 30s, 5m, 2h, 1d. A bare number is seconds.",
  }),
}).check(
  Schema.makeFilter((params: { cron?: string; when?: string; delay?: string }) =>
    [params.cron, params.when, params.delay].filter((value) => value != null && value !== "").length === 1
      ? undefined
      : "Provide exactly one of cron, when or delay",
  ),
)

const CronListParams = Schema.Struct({})

const CronDeleteParams = Schema.Struct({
  id: Schema.String.annotate({
    description: "Id of the scheduled task to delete, as reported by cron_create or cron_list.",
  }),
})

export function makeTools(wake: WakeupService) {
  const text = (content: string, metadata?: Tool.Result["metadata"]) => ({ output: content, content, metadata })

  const wakeup: Tool.Info<typeof ScheduleParams, typeof Schema.String> = {
    name: "schedule_wakeup",
    description: SCHEDULE,
    input: ScheduleParams,
    output: Schema.String,
    options: { codemode: false },
    execute: (params, context: ContextInput) =>
      Effect.gen(function* () {
        const now = Date.now()
        const result = yield* wake.scheduleWakeup({ ...params, sessionID: context.sessionID })
        if (!result.ok) return text(result.error)
        const dueAt = result.wakeup.dueAt ?? now
        const content = [
          `Scheduled wakeup ${result.wakeup.id}, due ${new Date(dueAt).toISOString()} (${relative(dueAt, now)}).${result.notice ? ` ${result.notice}` : ""}`,
          `When it fires this session resumes with: ${params.prompt}`,
          `To keep watching, schedule the next check before you finish; to stop, cancel_wakeup ${result.wakeup.id}. At the fire, the scheduled prompt is the only context, so keep it self-contained.`,
        ].join("\n")
        return text(content, { id: result.wakeup.id, dueAt, prompt: params.prompt })
      }),
  }

  const cancel: Tool.Info<typeof CancelParams, typeof Schema.String> = {
    name: "cancel_wakeup",
    description: CANCEL,
    input: CancelParams,
    output: Schema.String,
    options: { codemode: false },
    execute: (params, context: ContextInput) =>
      Effect.gen(function* () {
        const now = Date.now()
        if (params.action === "list") {
          const list = (yield* wake.list(context.sessionID)).filter((item) => item.kind === "wakeup")
          if (list.length === 0) return text("No pending wakeups for this session.", { count: 0 })
          return text(
            list
              .map((item) => {
                const dueAt = item.dueAt ?? now
                return `${item.id}  due ${new Date(dueAt).toISOString()} (${relative(dueAt, now)})  ${excerpt(item.reason ?? item.prompt)}`
              })
              .join("\n"),
            { count: list.length },
          )
        }
        const id = params.id?.trim()
        if (!id) return text("id is required when action is cancel")
        const removed = yield* wake.cancel(context.sessionID, id, "wakeup")
        if (removed === undefined) return text(`No pending wakeup with id ${id}.`, { id })
        return text(`Cancelled wakeup ${removed.id} (${new Date(removed.dueAt).toISOString()}).`, {
          id: removed.id,
          cancelled: true,
        })
      }),
  }

  const cronCreate: Tool.Info<typeof CronCreateParams, typeof Schema.String> = {
    name: "cron_create",
    description: CRON_CREATE,
    input: CronCreateParams,
    output: Schema.String,
    options: { codemode: false },
    execute: (params, context: ContextInput) =>
      Effect.gen(function* () {
        const now = Date.now()
        const result = yield* wake.scheduleCron({ ...params, sessionID: context.sessionID })
        if (!result.ok) return text(result.error)
        const dueAt = result.wakeup.dueAt ?? now
        const content = [
          `Scheduled cron task ${result.wakeup.id}, schedule ${result.wakeup.schedule ?? "one-shot"}, next fire ${new Date(dueAt).toISOString()} (${relative(dueAt, now)}).${result.notice ? ` ${result.notice}` : ""}`,
          `When it fires this session resumes with: ${result.wakeup.prompt}`,
          `Cancel with cron_delete ${result.wakeup.id} when the task is no longer needed. At each fire, the scheduled prompt is the only context, so keep it self-contained.`,
        ].join("\n")
        return text(content, {
          id: result.wakeup.id,
          dueAt,
          prompt: result.wakeup.prompt,
          recurring: result.wakeup.recurring,
        })
      }),
  }

  const cronList: Tool.Info<typeof CronListParams, typeof Schema.String> = {
    name: "cron_list",
    description: CRON_LIST,
    input: CronListParams,
    output: Schema.String,
    options: { codemode: false },
    execute: (_params, context: ContextInput) =>
      Effect.gen(function* () {
        const now = Date.now()
        const list = (yield* wake.list(context.sessionID)).filter((item) => item.kind === "cron")
        if (list.length === 0) return text("No scheduled cron tasks for this session.", { count: 0 })
        const content = list
          .map((item) => {
            const dueAt = item.dueAt ?? now
            return `${item.id}  ${item.schedule ?? "one-shot"}  next ${new Date(dueAt).toISOString()} (${relative(dueAt, now)})  ${excerpt(item.prompt)}`
          })
          .join("\n")
        return text(content, { count: list.length })
      }),
  }

  const cronDelete: Tool.Info<typeof CronDeleteParams, typeof Schema.String> = {
    name: "cron_delete",
    description: CRON_DELETE,
    input: CronDeleteParams,
    output: Schema.String,
    options: { codemode: false },
    execute: (params, context: ContextInput) =>
      Effect.gen(function* () {
        const id = params.id.trim()
        // Delete is idempotent: an already-fired, already-deleted, or unknown id is reported, never thrown.
        const removed = yield* wake.cancel(context.sessionID, id, "cron")
        if (removed === undefined) return text(`No cron task with id ${id}.`, { id })
        return text(`Deleted cron task ${removed.id} (next ${new Date(removed.dueAt).toISOString()}).`, {
          id: removed.id,
          deleted: true,
        })
      }),
  }

  return { wakeup, cancel, cronCreate, cronList, cronDelete }
}

import { Wakeup } from "@/kilocode/wakeup"
import { InstanceState } from "@/effect/instance-state"
import { Tool } from "@/tool/tool"
import { Effect, Schema } from "effect"
import CREATE from "./cron-create.txt"
import LIST from "./cron-list.txt"
import DELETE from "./cron-delete.txt"
import { excerpt, relative } from "./wakeup-format"

export const CronCreateParams = Schema.Struct({
  prompt: Schema.String.annotate({
    description: "Text to resume this session with each time the task fires.",
  }),
  cron: Schema.optional(Schema.String).annotate({
    description: "Recurring 5-field cron expression, e.g. */5 * * * *. The smallest interval is one minute.",
  }),
  when: Schema.optional(Schema.String).annotate({
    description: "Absolute ISO-8601 date-time for a one-shot task, e.g. 2026-09-13T14:30:00Z. An offset makes it absolute; without one the host timezone applies.",
  }),
  delay: Schema.optional(Schema.String).annotate({
    description: "Relative span from now for a one-shot task, e.g. 30s, 5m, 2h, 1d. A bare number is seconds.",
  }),
}).check(
  Schema.makeFilter((params: { prompt: string; cron?: string; when?: string; delay?: string }) => {
    const forms = [params.cron, params.when, params.delay].filter((value) => value != null && value !== "").length
    return forms === 1 ? undefined : "Provide exactly one of cron, when or delay"
  }),
)
export type CronCreateParams = Schema.Schema.Type<typeof CronCreateParams>

export type CronCreateMeta = {
  id?: Wakeup.ID
  dueAt?: number
  prompt?: string
  recurring?: boolean
}

export const CronListParams = Schema.Struct({})
export type CronListParams = Schema.Schema.Type<typeof CronListParams>

export type CronListMeta = {
  count?: number
}

export const CronDeleteParams = Schema.Struct({
  id: Schema.String.annotate({
    description: "Id of the scheduled task to delete, as reported by cron_create or cron_list.",
  }),
})
export type CronDeleteParams = Schema.Schema.Type<typeof CronDeleteParams>

export type CronDeleteMeta = {
  id?: Wakeup.ID
  deleted?: boolean
}

function invalid(message: string) {
  return {
    title: "Invalid cron input",
    output: message,
    metadata: {},
  }
}

function invalidSchedule(message: string) {
  return {
    title: "Invalid cron schedule",
    output: message,
    metadata: {},
  }
}

function tooMany() {
  return {
    title: "Too many cron tasks",
    output: `Too many cron tasks: this session already holds the maximum of ${Wakeup.MAX_CRON_PER_SESSION} scheduled tasks. Cancel one with cron_delete before scheduling another.`,
    metadata: {},
  }
}

function created(info: Wakeup.CronInfo, now: number) {
  const due = new Date(info.dueAt).toISOString()
  return {
    title: `Scheduled cron task ${info.id}`,
    output: [
      `Scheduled cron task ${info.id}, schedule ${info.schedule}, next fire ${due} (${relative(info.dueAt, now)}).`,
      `When it fires this session resumes with: ${info.prompt}`,
    ].join("\n"),
    metadata: { id: info.id, dueAt: info.dueAt, prompt: info.prompt, recurring: info.recurring },
  }
}

function line(info: Wakeup.CronInfo, now: number) {
  const due = new Date(info.dueAt).toISOString()
  return `${info.id}  ${info.schedule}  next ${due} (${relative(info.dueAt, now)})  ${excerpt(info.prompt)}`
}

export const CronCreateTool = Tool.define<typeof CronCreateParams, CronCreateMeta, Wakeup.Service, "cron_create">(
  "cron_create",
  Effect.gen(function* () {
    const wake = yield* Wakeup.Service
    return {
      description: CREATE,
      parameters: CronCreateParams,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          const inst = yield* InstanceState.context
          return yield* wake
            .cronCreate({
              sessionID: ctx.sessionID,
              directory: inst.directory,
              prompt: params.prompt,
              cron: params.cron,
              when: params.when,
              delay: params.delay,
            })
            .pipe(
              Effect.map((info) => created(info, Date.now())),
              Effect.catchTags({
                "Wakeup.InvalidSchedule": (err) => Effect.succeed(invalidSchedule(err.message)),
                "Wakeup.InvalidTime": (err) => Effect.succeed(invalid(err.message)),
                "Wakeup.PastTime": (err) => Effect.succeed(invalid(err.message)),
                "Wakeup.TooManyCron": () => Effect.succeed(tooMany()),
              }),
            )
        }),
    }
  }),
)

export const CronListTool = Tool.define<typeof CronListParams, CronListMeta, Wakeup.Service, "cron_list">(
  "cron_list",
  Effect.gen(function* () {
    const wake = yield* Wakeup.Service
    return {
      description: LIST,
      parameters: CronListParams,
      execute: (_params, ctx) =>
        Effect.gen(function* () {
          const list = yield* wake.cronList({ sessionID: ctx.sessionID })
          return {
            title: "Scheduled cron tasks",
            output: list.length
              ? list.map((info) => line(info, Date.now())).join("\n")
              : "No scheduled cron tasks for this session.",
            metadata: { count: list.length },
          }
        }),
    }
  }),
)

export const CronDeleteTool = Tool.define<typeof CronDeleteParams, CronDeleteMeta, Wakeup.Service, "cron_delete">(
  "cron_delete",
  Effect.gen(function* () {
    const wake = yield* Wakeup.Service
    return {
      description: DELETE,
      parameters: CronDeleteParams,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          const id = params.id.trim()
          // Delete is idempotent: an already-fired, already-deleted, or
          // unknown id is reported, never thrown.
          const removed = yield* wake.cronCancel(id as Wakeup.ID, ctx.sessionID)
          if (!removed) {
            return {
              title: "No cron task",
              output: `No cron task with id ${id}.`,
              metadata: { id: id as Wakeup.ID },
            }
          }
          return {
            title: "Deleted cron task",
            output: `Deleted cron task ${removed.id} (next ${new Date(removed.dueAt).toISOString()}).`,
            metadata: { id: removed.id, deleted: true },
          }
        }),
    }
  }),
)

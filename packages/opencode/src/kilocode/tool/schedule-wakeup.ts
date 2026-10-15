import { Wakeup } from "@/kilocode/wakeup"
import { InstanceState } from "@/effect/instance-state"
import { Tool } from "@/tool/tool"
import { Effect, Schema } from "effect"
import DESCRIPTION from "./schedule-wakeup.txt"
import { relative } from "./wakeup-format"

export const Params = Schema.Struct({
  prompt: Schema.String.annotate({
    description: "Text to resume this session with when the wakeup fires.",
  }),
  delay: Schema.optional(Schema.String).annotate({
    description: "Relative span from now, e.g. 30s, 5m, 2h, 1d. A bare number is seconds.",
  }),
  when: Schema.optional(Schema.String).annotate({
    description: "Absolute ISO-8601 date-time, e.g. 2026-09-13T14:30:00Z. An offset makes it absolute; without one the host timezone applies.",
  }),
  reason: Schema.optional(Schema.String).annotate({
    description: "Short label shown in the sidebar and in cancel_wakeup's list.",
  }),
})
export type Params = Schema.Schema.Type<typeof Params>

export type Meta = {
  id?: Wakeup.ID
  dueAt?: number
  prompt?: string
}

function invalid(message: string) {
  return {
    title: "Invalid wakeup input",
    output: message,
    metadata: {},
  }
}

function tooMany() {
  return {
    title: "Too many scheduled wakeups",
    output: `Too many scheduled wakeups: this session already holds the maximum of ${Wakeup.MAX_PER_SESSION} pending wakeups. Cancel one with cancel_wakeup before scheduling another.`,
    metadata: {},
  }
}

function created(info: Wakeup.Info, now: number, input: Params) {
  const due = new Date(info.dueAt).toISOString()
  // The schedule's own clock is the reference for the clamp check: a fresh
  // Date.now() drifts a few milliseconds off resolve()'s base.
  const clamped = Wakeup.clampNotice(input, info.dueAt, info.created)
  return {
    title: `Scheduled wakeup ${info.id}`,
    output: [
      `Scheduled wakeup ${info.id}, due ${due} (${relative(info.dueAt, now)}).${clamped ? ` ${clamped}` : ""}`,
      `When it fires this session resumes with: ${info.prompt}`,
    ].join("\n"),
    metadata: { id: info.id, dueAt: info.dueAt, prompt: info.prompt },
  }
}

export const ScheduleWakeupTool = Tool.define<typeof Params, Meta, Wakeup.Service, "schedule_wakeup">(
  "schedule_wakeup",
  Effect.gen(function* () {
    const wake = yield* Wakeup.Service
    return {
      description: DESCRIPTION,
      parameters: Params,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          const inst = yield* InstanceState.context
          return yield* wake
            .schedule({
              sessionID: ctx.sessionID,
              directory: inst.directory,
              prompt: params.prompt,
              delay: params.delay,
              when: params.when,
              reason: params.reason,
            })
            .pipe(
              Effect.map((info) => created(info, Date.now(), params)),
              Effect.catchTags({
                "Wakeup.InvalidTime": (err) => Effect.succeed(invalid(err.message)),
                "Wakeup.PastTime": (err) => Effect.succeed(invalid(err.message)),
                "Wakeup.TooMany": () => Effect.succeed(tooMany()),
              }),
            )
        }),
    }
  }),
)

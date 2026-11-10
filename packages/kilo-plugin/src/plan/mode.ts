export * as PlanMode from "./mode"

import { Message, ToolFailure } from "@opencode/ai/effect"
import { Permission } from "@opencode/core/permission"
import type { SessionStore } from "@opencode/core/session/store"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Agent } from "@opencode/schema/agent"
import type { Session } from "@opencode/schema/session"
import type { SessionEvent } from "@opencode/schema/session-event"
import { DateTime, Effect, Stream } from "effect"
import PROMPT from "./prompt.txt"
import { PlanFile } from "./plan-file"

const plan = Agent.ID.make("plan")

export const leave = `<system-reminder>
You are NO LONGER in Plan mode. The previous Plan mode instructions and plan file rules no longer apply. Any Plan mode instructions from earlier in this conversation are no longer active.
</system-reminder>`

/** The Plan mode reminder of one session: the Kilo planning instructions and where the plan file goes. */
export function enter(input: { session: Pick<Session.Info, "time">; target: PlanFile.Target; data: string; document: boolean }) {
  const dir = PlanFile.directory(input.target, input.data)
  const time = DateTime.toEpochMillis(input.session.time.created)
  const body = [
    PROMPT.trim(),
    "",
    "## Plan File",
    `Use any exact plan file path from user or project instructions unchanged. If only a directory is specified, create the plan there; otherwise create it in ${dir}. For generated filenames, use ${time}-<concise-kebab-case-suffix>.md, choosing the suffix from the plan details, for example ${time}-database-cache-plan.md. When you refine a plan you already saved, keep editing that file.`,
    "Use the chosen plan path as the main plan file. Do not write or edit other files unless the user explicitly asks and your permissions allow it.",
    "Project or user instructions about plan location (for example plans/ or .plans/) are authorized when permissions allow them; they do not conflict with this reminder. When finalizing, call plan_exit with the path of the plan file you wrote.",
    "In the visible final response, cite the saved plan path as an inline code span so the client can open it as a document.",
    ...(input.document
      ? ["When the plan is ready for user review, call open_plan with the saved path before calling plan_exit."]
      : []),
    "When the plan is implementation-ready, write the main plan file and call plan_exit. Do not ask the user to choose between finalizing and refining in chat; the client follow-up after plan_exit asks whether to implement the saved plan or keep refining.",
  ].join("\n")
  return `<system-reminder>\n${body}\n</system-reminder>`
}

/**
 * Kilo Plan mode: the planning reminder on entry, the leave reminder on exit, the plan directory, and a clear
 * error for an edit outside the plan scope.
 */
export const install = Effect.fn(function* (input: {
  ctx: Context
  store: SessionStore.Interface
  data: string
  document: boolean
}) {
  const ctx = input.ctx
  const dir = PlanFile.directory(ctx.location, input.data)
  // Session hooks have no failure channel: a read-only checkout must not fail Plan requests or stop the reminders.
  const ensure = Effect.sync(() => PlanFile.ensure(dir)).pipe(
    Effect.catchCause((cause) => Effect.logWarning("failed to create the plan directory", { dir, cause })),
  )
  const reminder = Effect.fn(function* (sessionID: Session.ID) {
    const session = yield* input.store.get(sessionID)
    if (!session) return undefined
    return enter({ session, target: ctx.location, data: input.data, document: input.document })
  })

  yield* ctx.tool.hook("execute.after", (event) => {
    if (event.agent !== plan || event.status !== "error") return Effect.void
    if (event.tool !== "edit" && event.tool !== "write" && event.tool !== "patch") return Effect.void
    if (!(event.error.error instanceof Permission.BlockedError)) return Effect.void
    event.error = new ToolFailure({
      message: `Cannot use ${event.tool} to modify files outside the plan directory: ${dir}`,
    })
    return Effect.void
  })

  // Compaction and committed reverts can strip reminders while the session's agent stays put. Reconcile per
  // request, appending near the tail so the cached prefix stays warm.
  yield* ctx.session.hook("context", (event) =>
    Effect.gen(function* () {
      const entry = event.agent === plan ? yield* reminder(event.sessionID) : undefined
      if (entry) yield* ensure
      const last = lastReminder(event.messages)
      const missing = entry !== undefined && last !== entry
      const stale = event.agent !== plan && last !== undefined && last !== leave
      const text = missing ? entry : stale ? leave : undefined
      if (!text) return
      // Before the user's prompt, matching where agent-switch reminders land.
      const at = event.messages.at(-1)?.role === "user" ? event.messages.length - 1 : event.messages.length
      event.messages.splice(at, 0, Message.user(text))
      yield* ctx.session
        .synthetic({ sessionID: event.sessionID, text, resume: false })
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("failed to persist the Plan mode reminder", { sessionID: event.sessionID, cause }),
          ),
        )
    }),
  )

  yield* ctx.event.subscribe({ types: ["session.created", "session.agent.selected"] }).pipe(
    Stream.runForEach((event) =>
      Effect.gen(function* () {
        const change = switched(event)
        if (!change) return
        const text = change === "enter" ? yield* reminder(event.data.sessionID) : leave
        if (!text) return
        if (change === "enter") yield* ensure
        yield* ctx.session.synthetic({ sessionID: event.data.sessionID, text, resume: false }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("failed to inject the Plan mode reminder", { sessionID: event.data.sessionID, cause }),
          ),
        )
      }),
    ),
    Effect.forkScoped({ startImmediately: true }),
  )
})

function switched(event: SessionEvent.Created | SessionEvent.AgentSelected) {
  if (event.type === "session.created") return event.data.agent === plan ? "enter" : undefined
  if (event.data.agent === event.data.previous) return undefined
  if (event.data.agent === plan) return "enter"
  if (event.data.previous === plan) return "leave"
  return undefined
}

/** The text of the last Plan mode reminder (an entry of any session, or the leave reminder) in the history. */
function lastReminder(messages: ReadonlyArray<Message>) {
  return messages.reduce<string | undefined>((found, message) => {
    const part = message.role === "user" && message.content.length === 1 ? message.content[0] : undefined
    if (part?.type !== "text") return found
    if (part.text === leave || isEntry(part.text)) return part.text
    return found
  }, undefined)
}

const ENTRY = `<system-reminder>\n${PROMPT.trim().split("\n")[0]}`

function isEntry(text: string) {
  return text.startsWith(ENTRY)
}

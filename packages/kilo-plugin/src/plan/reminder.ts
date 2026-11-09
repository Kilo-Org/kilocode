export * as PlanReminder from "./reminder"

// The plan reminder is a synthetic user message, the same mechanism the native Plan plugin uses.
import { Message } from "@opencode/ai/effect"
import type { SessionStore } from "@opencode/core/session/store"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Agent } from "@opencode/schema/agent"
import type { SessionEvent } from "@opencode/schema/session-event"
import { Effect, Stream } from "effect"
import { PlanFile } from "./plan-file"

const plan = Agent.ID.make("plan")

export const enter = (file: string) => `<system-reminder>
Kilo plan storage. Write the plan file to ${file} and then call plan_exit with that exact path. This workspace plan file is the source of truth for the handoff. Do not write the plan in the home plan directory.
</system-reminder>`

/** Tells the Plan agent the workspace plan file, so the plan handoff does not depend on the home plan directory. */
export const install = Effect.fn(function* (ctx: Context, store: SessionStore.Interface) {
  yield* ctx.session.hook("context", (event) =>
    Effect.gen(function* () {
      if (event.agent !== plan) return
      const session = yield* store.get(event.sessionID)
      if (!session) return
      const text = enter(PlanFile.defaultPath(session, ctx.location))
      if (lastReminder(event.messages, text) === text) return
      const at = event.messages.at(-1)?.role === "user" ? event.messages.length - 1 : event.messages.length
      event.messages.splice(at, 0, Message.user(text))
      yield* ctx.session
        .synthetic({ sessionID: event.sessionID, text, resume: false })
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("failed to persist the Kilo plan reminder", { sessionID: event.sessionID, cause }),
          ),
        )
    }),
  )

  yield* ctx.event.subscribe({ types: ["session.created", "session.agent.selected"] }).pipe(
    Stream.runForEach((event) =>
      Effect.gen(function* () {
        if (!switchReminder(event)) return
        const session = yield* store.get(event.data.sessionID)
        if (!session) return
        yield* ctx.session
          .synthetic({
            sessionID: event.data.sessionID,
            text: enter(PlanFile.defaultPath(session, ctx.location)),
            resume: false,
          })
          .pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("failed to inject the Kilo plan reminder", { sessionID: event.data.sessionID, cause }),
            ),
          )
      }),
    ),
    Effect.forkScoped({ startImmediately: true }),
  )
})

function switchReminder(event: SessionEvent.Created | SessionEvent.AgentSelected) {
  if (event.type === "session.created") return event.data.agent === plan
  if (event.data.agent === event.data.previous) return false
  return event.data.agent === plan
}

function lastReminder(messages: ReadonlyArray<Message>, text: string) {
  return messages.reduce<string | undefined>((found, message) => {
    const part = message.role === "user" && message.content.length === 1 ? message.content[0] : undefined
    if (part?.type !== "text") return found
    return part.text === text ? text : found
  }, undefined)
}

export * as KiloPlan from "./index"

import { Bus } from "@opencode/core/bus"
import { SessionStore } from "@opencode/core/session/store"
import { define } from "@opencode/plugin/effect/plugin"
import type { Session } from "@opencode/schema/session"
import type { SessionMessage } from "@opencode/schema/session-message"
import { Global } from "@opencode/util/global"
import { Cause, Effect, Stream, type Scope } from "effect"
import { PlanMode } from "./mode"
import { PlanFollowup } from "./plan-followup"
import { openPlan, planExit } from "./plan"

/** Kilo Plan mode: the planning reminders, the plan tools and the post-plan handoff question. */
export const KiloPlanPlugin = define<Bus.Service | Global.Service | SessionStore.Service | Scope.Scope>({
  id: "kilocode.plan",
  effect: Effect.fn("KiloPlan.Plugin")(function* (ctx) {
    const store = yield* SessionStore.Service
    const bus = yield* Bus.Service
    const global = yield* Global.Service
    // The VS Code client opens a plan as a document and answers the follow-up from its main prompt input.
    const document = process.env.OPENCODE_CLIENT === "vscode"
    // The last handled turn per session. Bounded by the sessions that had a plan turn, not by turns.
    const handled = new Map<Session.ID, SessionMessage.ID>()
    // A nested open_plan call shares the enclosing execute call's ID, so its resolved path can be
    // attached when that execute settles without parsing model-visible output.
    const opened = new Map<string, { sessionID: Session.ID; path: string }>()
    yield* ctx.event.subscribe({ types: ["session.deleted"] }).pipe(
      Stream.runForEach((event) =>
        Effect.sync(() => {
          handled.delete(event.data.sessionID)
          for (const [key, value] of opened) if (value.sessionID === event.data.sessionID) opened.delete(key)
        }),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )

    yield* ctx.tool
      .transform((editor) => {
        editor.add(planExit(ctx, store, global.data))
        if (document) editor.add(openPlan(ctx, store, global.data))
      })
      .pipe(Effect.orDie)

    // Code Mode drops a nested tool's metadata. The nested open_plan call shares the enclosing
    // execute call's ID, so remember its validated path and attach it when execute settles.
    if (document)
      yield* ctx.tool
        .hook("execute.after", (event) => {
          const key = `${event.sessionID}:${event.id}`
          if (event.tool === "open_plan") {
            if (event.status === "completed") {
              const path = event.result.metadata?.path
              if (typeof path === "string" && path) opened.set(key, { sessionID: event.sessionID, path })
            } else {
              opened.delete(key)
            }
            return Effect.void
          }
          if (event.tool !== "execute") return Effect.void
          if (event.status !== "completed") {
            opened.delete(key)
            return Effect.void
          }
          const value = opened.get(key)
          if (!value) return Effect.void
          opened.delete(key)
          event.result = { ...event.result, metadata: { ...event.result.metadata, path: value.path, open: true } }
          return Effect.void
        })
        .pipe(Effect.orDie)

    yield* PlanMode.install({ ctx, store, data: global.data, document })

    yield* ctx.session.hook("experimental.idle", (event) =>
      Effect.gen(function* () {
        for (const [key, value] of opened) if (value.sessionID === event.sessionID) opened.delete(key)
        yield* PlanFollowup.ask({ ctx, store, bus, handled, data: global.data, document, sessionID: event.sessionID }).pipe(
          // A user interruption must reach the runner; only unexpected failures are logged and swallowed.
          Effect.catchCause((cause) =>
            Cause.hasInterrupts(cause)
              ? Effect.interrupt
              : Effect.logWarning("failed to ask the plan follow-up question", { sessionID: event.sessionID, cause }),
          ),
        )
      }),
    )
  }),
})

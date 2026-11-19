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
    // Code Mode gives a nested call its own ID, so the enclosing execute cannot be identified by the call ID.
    // Remember the latest resolved open_plan path per session while its execute runs, and attach it when that
    // execute settles without parsing model-visible output.
    const opened = new Map<Session.ID, string>()
    const executing = new Map<Session.ID, number>()
    yield* ctx.event.subscribe({ types: ["session.deleted"] }).pipe(
      Stream.runForEach((event) =>
        Effect.sync(() => {
          handled.delete(event.data.sessionID)
          opened.delete(event.data.sessionID)
          executing.delete(event.data.sessionID)
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

    // Code Mode drops a nested tool's metadata and now gives that call its own ID, so the enclosing execute is
    // tracked per session: a validated open_plan path is attached when the execute it ran inside settles.
    if (document)
      yield* ctx.tool
        .hook("execute.before", (event) => {
          if (event.tool !== "execute") return Effect.void
          executing.set(event.sessionID, (executing.get(event.sessionID) ?? 0) + 1)
          return Effect.void
        })
        .pipe(Effect.orDie)
    if (document)
      yield* ctx.tool
        .hook("execute.after", (event) => {
          if (event.tool === "open_plan") {
            if (event.status === "completed") {
              const path = event.result.metadata?.path
              // Only a nested call matters; a direct open_plan prepares no execute to attach a path to.
              if (typeof path === "string" && path && (executing.get(event.sessionID) ?? 0) > 0)
                opened.set(event.sessionID, path)
            } else {
              opened.delete(event.sessionID)
            }
            return Effect.void
          }
          if (event.tool !== "execute") return Effect.void
          const active = (executing.get(event.sessionID) ?? 1) - 1
          if (active <= 0) executing.delete(event.sessionID)
          else executing.set(event.sessionID, active)
          if (event.status !== "completed") {
            opened.delete(event.sessionID)
            return Effect.void
          }
          const path = opened.get(event.sessionID)
          if (!path) return Effect.void
          opened.delete(event.sessionID)
          event.result = { ...event.result, metadata: { ...event.result.metadata, path, open: true } }
          return Effect.void
        })
        .pipe(Effect.orDie)

    yield* PlanMode.install({ ctx, store, data: global.data, document })

    yield* ctx.session.hook("experimental.idle", (event) =>
      Effect.gen(function* () {
        opened.delete(event.sessionID)
        executing.delete(event.sessionID)
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

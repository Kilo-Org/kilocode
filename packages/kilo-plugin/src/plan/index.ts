export * as KiloPlan from "./index"

import { Bus } from "@opencode/core/bus"
import { SessionStore } from "@opencode/core/session/store"
import { define } from "@opencode/plugin/effect/plugin"
import type { Session } from "@opencode/schema/session"
import type { SessionMessage } from "@opencode/schema/session-message"
import type { Tool } from "@opencode/schema/tool"
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
    yield* ctx.event.subscribe({ types: ["session.deleted"] }).pipe(
      Stream.runForEach((event) => Effect.sync(() => handled.delete(event.data.sessionID))),
      Effect.forkScoped({ startImmediately: true }),
    )

    yield* ctx.tool
      .transform((editor) => {
        editor.add(planExit(ctx, store, global.data))
        if (document) editor.add(openPlan(ctx, store, global.data))
      })
      .pipe(Effect.orDie)

    // Code Mode drops a nested tool's metadata, so the resolved plan path is only in the execute output.
    // Put it back on the execute result for the client, including when the model omitted `path`.
    if (document)
      yield* ctx.tool
        .hook("execute.after", (event) => {
          if (event.status !== "completed" || event.tool !== "execute") return Effect.void
          const calls = event.result.metadata?.toolCalls
          if (!Array.isArray(calls) || !calls.some(isOpenPlanCall)) return Effect.void
          const path = openedPath(event.result.content)
          if (!path) return Effect.void
          event.result = { ...event.result, metadata: { ...event.result.metadata, path, open: true } }
          return Effect.void
        })
        .pipe(Effect.orDie)

    yield* PlanMode.install({ ctx, store, data: global.data, document })

    yield* ctx.session.hook("experimental.idle", (event) =>
      PlanFollowup.ask({ ctx, store, bus, handled, data: global.data, document, sessionID: event.sessionID }).pipe(
        // A user interruption must reach the runner; only unexpected failures are logged and swallowed.
        Effect.catchCause((cause) =>
          Cause.hasInterrupts(cause)
            ? Effect.interrupt
            : Effect.logWarning("failed to ask the plan follow-up question", { sessionID: event.sessionID, cause }),
        ),
      ),
    )
  }),
})

function isOpenPlanCall(value: unknown) {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "tool" in value &&
    value.tool === "open_plan" &&
    "status" in value &&
    value.status === "completed"
  )
}

/** The resolved plan path from the model-visible output of a completed `open_plan` call. */
function openedPath(content: Tool.Result["content"]) {
  const text =
    typeof content === "string"
      ? content
      : (content ?? [])
          .flatMap((part) => (part.type === "text" ? [part.text] : []))
          .join("\n")
  return [...text.matchAll(/Opened plan at (.+?) for review\./g)].at(-1)?.[1]
}

export * as KiloPlan from "./index"

import { Bus } from "@opencode/core/bus"
import { SessionStore } from "@opencode/core/session/store"
import { define } from "@opencode/plugin/effect/plugin"
import type { Session } from "@opencode/schema/session"
import type { SessionMessage } from "@opencode/schema/session-message"
import { Global } from "@opencode/util/global"
import { Cause, Effect, Stream, type Scope } from "effect"
import path from "node:path"
import { PlanFollowup } from "./plan-followup"
import { planExit } from "./plan"
import { PlanReminder } from "./reminder"

/** The Kilo plan workflow: the plan_exit tool and the post-plan handoff question. */
export const KiloPlanPlugin = define<Bus.Service | Global.Service | SessionStore.Service | Scope.Scope>({
  id: "kilocode.plan",
  effect: Effect.fn("KiloPlan.Plugin")(function* (ctx) {
    const store = yield* SessionStore.Service
    const bus = yield* Bus.Service
    const global = yield* Global.Service
    // The native Plan reminder names this directory, so the Kilo tool accepts plans the model wrote there.
    const roots = [path.join(global.home, ".opencode", "plan")]
    // The last handled turn per session. Bounded by the sessions that had a plan turn, not by turns.
    const handled = new Map<Session.ID, SessionMessage.ID>()
    yield* ctx.event.subscribe({ types: ["session.deleted"] }).pipe(
      Stream.runForEach((event) => Effect.sync(() => handled.delete(event.data.sessionID))),
      Effect.forkScoped({ startImmediately: true }),
    )

    yield* ctx.tool.transform((editor) => editor.add(planExit(ctx, store, roots))).pipe(Effect.orDie)

    // The native reminder names the home directory. Name the workspace plan file too, so the write and
    // plan_exit stay inside the project and need no external-directory approval.
    yield* PlanReminder.install(ctx, store)

    yield* ctx.session.hook("experimental.idle", (event) =>
      PlanFollowup.ask({ ctx, store, bus, handled, roots, sessionID: event.sessionID }).pipe(
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

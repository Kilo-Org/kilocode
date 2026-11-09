export * as KiloPlan from "./index"

import { Bus } from "@opencode/core/bus"
import { SessionStore } from "@opencode/core/session/store"
import { define } from "@opencode/plugin/effect/plugin"
import { Global } from "@opencode/util/global"
import { Cause, Effect, type Scope } from "effect"
import path from "node:path"
import { PlanFollowup } from "./plan-followup"
import { planExit } from "./plan"

/** The Kilo plan workflow: the plan_exit tool and the post-plan handoff question. */
export const KiloPlanPlugin = define<Bus.Service | Global.Service | SessionStore.Service | Scope.Scope>({
  id: "kilocode.plan",
  effect: Effect.fn("KiloPlan.Plugin")(function* (ctx) {
    const store = yield* SessionStore.Service
    const bus = yield* Bus.Service
    const global = yield* Global.Service
    // The native Plan reminder names this directory, so the Kilo tool accepts plans the model wrote there.
    const roots = [path.join(global.home, ".opencode", "plan")]
    // Turns already handled, so a later idle from background work does not scan or ask again.
    const handled = new Set<string>()

    yield* ctx.tool.transform((editor) => editor.add(planExit(ctx, store, roots))).pipe(Effect.orDie)

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

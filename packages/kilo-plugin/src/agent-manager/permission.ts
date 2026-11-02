import { Wildcard } from "@opencode/core/util/wildcard"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { Agent } from "@opencode/schema/agent"
import type { Permission } from "@opencode/schema/permission"
import type { Session } from "@opencode/schema/session"
import { Effect } from "effect"

const SIDE_EFFECTS = new Set(["prompt", "stop", "move", "answer"])

/**
 * Prompting, stopping, moving, or answering a pending question on an existing session has an external side effect.
 * A broad allow for the whole tool must not silently grant it; only a rule that names the exact pattern does.
 */
export function harden(action: string, resource: string, rules: Permission.Ruleset): Permission.Rule {
  const rule = evaluate(action, resource, rules)
  if (action !== "agent_manager" || !SIDE_EFFECTS.has(resource) || rule.effect !== "allow") return rule
  if (rule.action === action && rule.resource === resource) return rule
  return { action, resource, effect: "ask" }
}

export const installPermission = (ctx: Context) =>
  ctx.permission.hook("evaluate", (event) =>
    Effect.gen(function* () {
      if (event.action !== "agent_manager" || event.effect === "deny") return
      const rules = yield* baseRules(ctx, event)
      for (const resource of event.resources) {
        if (harden(event.action, resource, rules).effect !== "ask") continue
        event.effect = "ask"
        return
      }
    }),
  )

function baseRules(
  ctx: Context,
  event: { readonly sessionID: Session.ID; readonly agent?: Agent.ID },
): Effect.Effect<Permission.Ruleset> {
  return Effect.gen(function* () {
    const session = yield* ctx.session
      .get({ sessionID: event.sessionID })
      .pipe(Effect.orElseSucceed(() => undefined))
    const agent = event.agent
      ? yield* ctx.agent
          .get({ agentID: event.agent })
          .pipe(
            Effect.map((result) => result.data.permissions),
            Effect.orElseSucceed(() => []),
          )
      : []
    return [...agent, ...(session?.permissions ?? [])]
  })
}

function evaluate(action: string, resource: string, rules: Permission.Ruleset): Permission.Rule {
  return (
    rules.findLast((rule) => Wildcard.match(action, rule.action) && Wildcard.match(resource, rule.resource)) ?? {
      action,
      resource: "*",
      effect: "ask",
    }
  )
}

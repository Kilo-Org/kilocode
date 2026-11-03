import { Wildcard } from "@opencode/core/util/wildcard"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { Permission } from "@opencode/schema/permission"
import { Effect } from "effect"

const SIDE_EFFECTS = new Set(["prompt", "stop", "move", "answer"])

/**
 * Prompting, stopping, moving, or answering a pending question on an existing session has an external side effect.
 * A broad allow (a wildcard config rule, a global allow, or a saved approval edited into a pattern) must not
 * silently grant it; only an allow rule that names the exact action and pattern does.
 */
export function harden(action: string, resource: string, rules: Permission.Ruleset): Permission.Rule {
  const rule = evaluate(action, resource, rules)
  if (action !== "agent_manager" || !SIDE_EFFECTS.has(resource) || rule.effect !== "allow") return rule
  if (explicit(action, resource, rules)) return rule
  return { action, resource, effect: "ask" }
}

/**
 * The event carries the configured and project saved rules that decided the effect, so an exact "Always allow" stays
 * granted and a wildcard asks again. Nobody can answer an unattended ask, so an unapproved side effect is denied
 * there instead of being settled by the broad unattended rules.
 */
export const installPermission = (ctx: { readonly permission: Pick<Context["permission"], "hook"> }) =>
  ctx.permission.hook("evaluate", (event) =>
    Effect.sync(() => {
      if (event.action !== "agent_manager" || event.effect === "deny") return
      const resource = event.resources.find(
        (item) => SIDE_EFFECTS.has(item) && harden(event.action, item, event.rules ?? []).effect !== "allow",
      )
      if (resource === undefined) return
      if (event.unattended === undefined) {
        event.effect = "ask"
        return
      }
      event.effect = "deny"
      event.message = `Agent Manager ${resource} needs approval, and nobody is present to give it`
    }),
  )

/** An exact allow still decides when no ask or deny rule matches after it. */
function explicit(action: string, resource: string, rules: Permission.Ruleset) {
  const matching = rules.filter((rule) => matches(action, resource, rule))
  const start = matching.findLastIndex((rule) => rule.effect !== "allow") + 1
  return matching.slice(start).some((rule) => rule.action === action && rule.resource === resource)
}

function evaluate(action: string, resource: string, rules: Permission.Ruleset): Permission.Rule {
  return rules.findLast((rule) => matches(action, resource, rule)) ?? { action, resource: "*", effect: "ask" }
}

function matches(action: string, resource: string, rule: Permission.Rule) {
  return Wildcard.match(action, rule.action) && Wildcard.match(resource, rule.resource)
}

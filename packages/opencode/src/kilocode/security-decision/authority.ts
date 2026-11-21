import { Effect } from "effect"
import { Wildcard } from "@opencode-ai/core/util/wildcard"
import type { Config } from "@/config/config"
import { Permission, fromConfig } from "@/permission"
import type { SecurityDecisionTypes } from "./types"

/**
 * Source-aware precedence without touching the config loader.
 *
 * The merged ruleset the permission pipeline evaluates cannot answer "who wrote this rule": a
 * project config leaf can replace an earlier global leaf. So the layer re-reads the raw XDG
 * user-global permission block separately and applies it as a repo-independent *strictness floor*
 * over whatever the existing pipeline resolved. The floor never grants — it only refuses to be
 * weakened by project/session/agent/YOLO rules.
 */
export namespace SecurityAuthority {
  export type Action = Permission.Action

  export type Floor = Readonly<{
    action: Action
    authority: SecurityDecisionTypes.Authority
    /** The XDG floor and the effective rule disagreed. */
    conflict: boolean
  }>

  export type Snapshot = Readonly<{ rules: Permission.Ruleset; failed: boolean }>

  function rank(action: Action) {
    return action === "deny" ? 2 : action === "ask" ? 1 : 0
  }

  /** The last matching XDG rule, mirroring `Permission.evaluate`, or undefined when none matches. */
  function match(permission: string, pattern: string, rules: Permission.Ruleset) {
    return rules.findLast(
      (rule) => Wildcard.match(permission, rule.permission) && Wildcard.match(pattern, rule.pattern),
    )
  }

  export function floor(input: {
    permission: string
    pattern: string
    effective: Action
    xdg: Permission.Ruleset
    /** True when the XDG snapshot could not be read; provenance is then unclassifiable. */
    failed?: boolean
  }): Floor {
    if (input.failed) {
      // Unclassifiable provenance is never trusted: hold at ask unless it was already deny.
      return {
        action: input.effective === "deny" ? "deny" : "ask",
        authority: "unknown",
        conflict: false,
      }
    }

    const rule = match(input.permission, input.pattern, input.xdg)
    if (!rule) return { action: input.effective, authority: "untrusted", conflict: false }

    const strictest = rank(rule.action) >= rank(input.effective) ? rule.action : input.effective
    return {
      action: strictest,
      // The floor only carries authority when it actually holds the line; an XDG allow that
      // merely agrees with the effective allow leaves the decision untrusted and tightenable.
      authority: rank(rule.action) > 0 && rank(rule.action) >= rank(input.effective) ? "xdg_global" : "untrusted",
      conflict: rule.action !== input.effective,
    }
  }

  /** Read the raw XDG permission block. Any failure is reported, never silently treated as empty. */
  export const snapshot = Effect.fn("SecurityAuthority.snapshot")(function* (
    config: Pick<Config.Interface, "getGlobal">,
  ) {
    return yield* config.getGlobal().pipe(
      Effect.map((global): Snapshot => ({ rules: fromConfig(global.permission ?? {}), failed: false })),
      Effect.catchCause(() => Effect.succeed<Snapshot>({ rules: [], failed: true })),
    )
  })
}

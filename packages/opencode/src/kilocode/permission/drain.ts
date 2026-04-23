import { Bus } from "@/bus"
import { Deferred, Effect } from "effect"
import { Permission } from "@/permission"
import { ConfigProtection } from "@/kilocode/permission/config-paths"

interface PendingEntry {
  info: Permission.Request
  ruleset: Permission.Ruleset
  deferred: Deferred.Deferred<void, Permission.RejectedError | Permission.CorrectedError>
}

/**
 * Auto-resolve pending permissions now fully covered by approved or denied rules.
 * When the user approves/denies a rule on subagent A, sibling subagent B's
 * pending permission for the same pattern resolves or rejects automatically.
 */
export function drainCovered(
  pending: Map<string, PendingEntry>,
  approved: Permission.Ruleset,
  _Denied: typeof Permission.DeniedError,
  exclude?: string,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    for (const [id, entry] of pending) {
      if (id === exclude) continue
      // Never auto-resolve config file edit permissions
      if (ConfigProtection.isRequest(entry.info)) continue
      const actions = entry.info.patterns.map((pattern: string) =>
        Permission.evaluate(entry.info.permission, pattern, entry.ruleset, approved),
      )
      const denied = actions.some((r: Permission.Rule) => r.action === "deny")
      const allowed = !denied && actions.every((r: Permission.Rule) => r.action === "allow")
      if (!denied && !allowed) continue
      pending.delete(id)
      if (denied) {
        void Bus.publish(Permission.Event.Replied, {
          sessionID: entry.info.sessionID,
          requestID: entry.info.id,
          reply: "reject",
        })
        yield* Deferred.fail(entry.deferred, new Permission.RejectedError())
      } else {
        void Bus.publish(Permission.Event.Replied, {
          sessionID: entry.info.sessionID,
          requestID: entry.info.id,
          reply: "always",
        })
        yield* Deferred.succeed(entry.deferred, undefined)
      }
    }
  })
}

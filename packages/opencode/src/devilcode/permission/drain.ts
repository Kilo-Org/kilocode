import { Bus } from "@/bus"
import { Wildcard } from "@/util/wildcard"
import type { PermissionNext } from "@/permission/next"
import { ConfigProtection } from "@/kilocode/permission/config-paths"

/**
 * Auto-resolve pending permissions now fully covered by approved or denied rules.
 * When the user approves/denies a rule on subagent A, sibling subagent B's
 * pending permission for the same pattern resolves or rejects automatically.
 */
export async function drainCovered(
  pending: Record<
    string,
    {
      info: PermissionNext.Request
      ruleset: PermissionNext.Ruleset
      resolve: () => void
      reject: (e: any) => void
    }
  >,
  approved: PermissionNext.Ruleset,
  evaluate: typeof PermissionNext.evaluate,
  events: typeof PermissionNext.Event,
  DeniedError: typeof PermissionNext.DeniedError,
  exclude?: string,
) {
  for (const [id, entry] of Object.entries(pending)) {
    if (id === exclude) continue
    // Never auto-resolve config file edit permissions
    if (ConfigProtection.isRequest(entry.info)) continue
    const actions = entry.info.patterns.map((pattern) =>
      evaluate(entry.info.permission, pattern, entry.ruleset, approved),
    )
    const denied = actions.some((r) => r.action === "deny")
    const allowed = !denied && actions.every((r) => r.action === "allow")
    if (!denied && !allowed) continue
    delete pending[id]
    if (denied) {
      Bus.publish(events.Replied, {
        sessionID: entry.info.sessionID,
        requestID: entry.info.id,
        reply: "reject",
      })
      entry.reject(new DeniedError(approved.filter((r) => Wildcard.match(entry.info.permission, r.permission))))
    } else {
      Bus.publish(events.Replied, {
        sessionID: entry.info.sessionID,
        requestID: entry.info.id,
        reply: "always",
      })
      entry.resolve()
    }
  }
}

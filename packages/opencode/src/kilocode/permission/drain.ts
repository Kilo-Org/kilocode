import { Deferred, Effect } from "effect"
import { Permission } from "@/permission"
import { ConfigProtection } from "@/kilocode/permission/config-paths"

interface PendingEntry {
  info: Permission.Request
  ruleset: Permission.Ruleset
  hardRuleset?: Permission.Ruleset
  deferred: Deferred.Deferred<void, Permission.RejectedError | Permission.CorrectedError>
}

// The caller supplies the reply publisher so drain uses the same EventV2Bridge channel as permission/index.ts.
type PublishReply = (data: {
  sessionID: Permission.Request["sessionID"]
  requestID: Permission.Request["id"]
  reply: Permission.Reply
}) => Effect.Effect<void>

/**
 * Auto-resolve pending permissions now fully covered by approved or denied rules.
 * When the user approves/denies a rule on subagent A, sibling subagent B's
 * pending permission for the same pattern resolves or rejects automatically.
 */
export function drainCovered(
  pending: Map<string, PendingEntry>,
  approved: Permission.Ruleset,
  publishReply: PublishReply,
  exclude?: string,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    for (const [id, entry] of pending) {
      if (id === exclude) continue
      // Never auto-resolve config file edit permissions
      const skill = ConfigProtection.globalSkillPattern(entry.info)
      if (ConfigProtection.isRequest(entry.info) && !skill) continue
      const actions = entry.info.patterns.map((pattern: string) => {
        const rule = skill
          ? Permission.evaluate(entry.info.permission, skill, approved)
          : Permission.resolve(entry.info.permission, pattern, entry.ruleset, approved)
        const hard = entry.hardRuleset
          ? Permission.evaluate(entry.info.permission, pattern, entry.hardRuleset)
          : undefined
        if (hard?.action === "deny") return hard
        return rule
      })
      if (skill && actions.some((rule) => rule.pattern !== skill)) continue
      const denied = actions.some((r: Permission.Rule) => r.action === "deny")
      const allowed = !denied && actions.every((r: Permission.Rule) => r.action === "allow")
      if (!denied && !allowed) continue
      pending.delete(id)
      if (denied) {
        yield* publishReply({ sessionID: entry.info.sessionID, requestID: entry.info.id, reply: "reject" })
        yield* Deferred.fail(entry.deferred, new Permission.RejectedError())
      } else {
        yield* publishReply({ sessionID: entry.info.sessionID, requestID: entry.info.id, reply: "always" })
        yield* Deferred.succeed(entry.deferred, undefined)
      }
    }
  })
}

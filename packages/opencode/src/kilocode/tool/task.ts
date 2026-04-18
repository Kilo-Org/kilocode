// kilocode_change - new file
import { Permission } from "@/permission"
import type { Session } from "../../session"
import type { Agent } from "../../agent/agent"
import type { Config } from "../../config/config"

export namespace KiloTask {
  /** Reject primary agents used as subagents */
  export function validate(info: Agent.Info, name: string) {
    if (info.mode === "primary") throw new Error(`Agent "${name}" is a primary agent and cannot be used as a subagent`)
  }

  /**
   * Build inherited permission rules from the calling agent.
   * Merges the static agent definition with the session's accumulated permissions
   * so restrictions survive multi-hop chains (plan → general → explore).
   *
   * The caller must resolve `caller` (Agent.Info) and `session` (Session.Info)
   * before calling — this function is pure/synchronous.
   */
  export function inherited(input: {
    caller: Agent.Info
    session: Session.Info
    mcp: Config.Info["mcp"]
  }): Permission.Ruleset {
    const rules = Permission.merge(input.caller.permission ?? [], input.session.permission ?? [])
    const prefixes = Object.keys(input.mcp ?? {}).map((k) => k.replace(/[^a-zA-Z0-9_-]/g, "_") + "_")
    const isMcp = (p: string) => prefixes.some((prefix) => p.startsWith(prefix))
    return rules.filter(
      (r: Permission.Rule) => r.permission === "edit" || r.permission === "bash" || isMcp(r.permission),
    )
  }

  /** Extra permission rules appended to subagent sessions */
  export function permissions(rules: Permission.Ruleset): Permission.Ruleset {
    return [{ permission: "task", pattern: "*", action: "deny" }, ...rules]
  }
}

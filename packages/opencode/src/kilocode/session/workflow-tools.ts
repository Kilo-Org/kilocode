// kilocode_change - new file
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Wildcard } from "@/util/wildcard"
import { Permission } from "@/permission"

export namespace KiloWorkflowTools {
  /**
   * Applies the session permission ruleset to a GitLab workflow tool call.
   * `preapproved` lists the tools the workflow may run without asking; `refuse`
   * answers a call the session must not run, so a distinct reason keeps the
   * provider from substituting its own implementation.
   */
  export function gate(input: { tools: Record<string, { execute?: unknown }>; ruleset: PermissionV1.Ruleset }) {
    const names = Object.keys(input.tools)
    // Edit aliases (write, apply_patch) share the edit permission, so a catch-all
    // edit rule also covers a tool whose own name matches no rule.
    const denied = Permission.disabled(names, input.ruleset)

    return {
      preapproved: names.filter((name) => {
        if (denied.has(name)) return false
        const rule = input.ruleset.findLast((rule) => Wildcard.match(name, rule.permission))
        return !rule || rule.action === "allow"
      }),
      refuse(name: string): string | undefined {
        if (Permission.disabled([name], input.ruleset).has(name)) return `Permission denied for tool: ${name}`
        if (!input.tools[name]?.execute) return `Tool not available: ${name}`
        return undefined
      },
    }
  }
}

// kilocode_change - new file
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Wildcard } from "@/util/wildcard"
import { Permission } from "@/permission"

// Tools that are gated by another permission's rules. Keep this in step with
// Permission.disabled so the preapproval list and the refusal agree.
const ALIASES: Record<string, string> = {
  edit: "edit",
  write: "edit",
  apply_patch: "edit",
  list_mcp_resources: "read",
  list_mcp_resource_templates: "read",
  read_mcp_resource: "read",
}

export namespace KiloWorkflowTools {
  /**
   * Applies the session permission ruleset to a GitLab workflow tool call.
   * `preapproved` lists the tools the workflow may run without asking; `refuse`
   * answers a call the session must not run, so a distinct reason keeps the
   * provider from substituting its own implementation.
   */
  export function gate(input: { tools: Record<string, { execute?: unknown }>; ruleset: PermissionV1.Ruleset }) {
    const names = Object.keys(input.tools)
    const denied = Permission.disabled(names, input.ruleset)

    return {
      preapproved: names.filter((name) => {
        if (denied.has(name)) return false
        const permission = ALIASES[name] ?? name
        const rule = input.ruleset.findLast((rule) => Wildcard.match(permission, rule.permission))
        // Only a catch-all rule speaks for the whole tool. A path-scoped rule leaves
        // the concrete call to the tool's own per-argument check, so it must not turn
        // off preapproval for the calls that rule allows.
        return !rule || rule.pattern !== "*" || rule.action === "allow"
      }),
      refuse(name: string): string | undefined {
        if (Permission.disabled([name], input.ruleset).has(name)) return `Permission denied for tool: ${name}`
        if (!input.tools[name]?.execute) return `Tool not available: ${name}`
        return undefined
      },
    }
  }
}

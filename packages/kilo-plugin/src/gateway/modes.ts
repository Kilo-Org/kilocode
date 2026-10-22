export * as KiloOrganizationModes from "./modes"

import type { KiloModes } from "@kilocode/gateway-core"
import { Agent } from "@opencode/schema/agent"
import type { Permission } from "@opencode/schema/permission"

// Transient rule positions on native agent drafts, not another agent inventory.
export const permissionSpans = new WeakMap<readonly Permission.Rule[], readonly [number, number]>()

export function convert(mode: KiloModes.OrganizationMode) {
  const system = [mode.config.roleDefinition, mode.config.customInstructions].filter(Boolean).join("\n\n")
  return {
    name: Agent.Name.make(mode.name),
    mode: "primary" as const,
    description: mode.config.description ?? mode.config.whenToUse ?? mode.name,
    ...(system ? { system } : {}),
    permissions: mode.config.groups === undefined ? [] : convertPermissions(mode.config.groups),
  }
}

export function convertPermissions(groups: KiloModes.OrganizationMode["config"]["groups"] = []): Permission.Rule[] {
  const permissions = new Map<string, Permission.Rule[]>()
  for (const group of groups) {
    const [name, config] = typeof group === "string" ? [group, undefined] : group
    const action = name === "browser" || name === "command" || name === "bash" ? "shell" : name
    // fileRegex is a wildcard pattern in v1 too. Last-match-wins requires the fallback first.
    permissions.set(
      action,
      config?.fileRegex
        ? [
            { action, resource: config.fileRegex, effect: "allow" },
            { action, resource: "*", effect: "deny" },
          ]
        : [{ action, resource: "*", effect: "allow" }],
    )
  }
  for (const action of ["read", "edit", "shell", "mcp"]) {
    if (!permissions.has(action)) permissions.set(action, [{ action, resource: "*", effect: "deny" }])
  }
  return [...permissions.values()].flat()
}

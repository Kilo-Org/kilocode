import type { TeamConfig } from "./config"
import type { Agent } from "../../agent/agent"
import type { PermissionNext } from "@/permission/next"

const BUILTIN_AGENT_NAMES = new Set([
  "code", "plan", "debug", "orchestrator", "ask",
  "general", "explore", "title", "summary", "compaction",
])

/**
 * Creates workflow-specific agent definitions based on team config.
 * Returns a record of agent name -> Agent.Info to merge into the agent state.
 */
export function createWorkflowAgents(
  teamConfig: TeamConfig | undefined,
  defaults: PermissionNext.Ruleset,
): Record<string, Agent.Info> | undefined {
  if (!teamConfig?.enabled) return undefined

  const agents: Record<string, Agent.Info> = {}

  for (const [roleName, role] of Object.entries(teamConfig.roles)) {
    if (BUILTIN_AGENT_NAMES.has(roleName)) continue

    agents[roleName] = {
      name: roleName,
      displayName: role.displayName,
      description: `Team role: ${role.displayName} (${role.provider}/${role.model})`,
      mode: role.tier === 1 ? "primary" : "subagent",
      native: false,
      permission: defaults,
      model: {
        providerID: role.provider,
        modelID: role.model,
      },
      options: {
        teamRole: roleName,
        teamTier: role.tier,
      },
    }
  }

  return Object.keys(agents).length > 0 ? agents : undefined
}

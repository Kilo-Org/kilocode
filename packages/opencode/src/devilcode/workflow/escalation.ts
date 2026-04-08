import type { TeamConfig } from "../team/config"
import type { TaskResult } from "./types"
import { Log } from "@/util/log"

const log = Log.create({ service: "workflow.escalation" })

export type EscalationSignal = {
  detected: boolean
  reason?: string
  suggestedRole?: string
  context?: string
}

/**
 * Detects escalation signals from task output
 */
export function detectEscalation(output: string): EscalationSignal {
  const lowerOutput = output.toLowerCase()

  // Pattern: Task explicitly requests escalation
  if (lowerOutput.includes("escalate") || lowerOutput.includes("escalating")) {
    // Try to extract suggested role — anchor to "escalate/escalating" to avoid
    // matching unrelated "to <word>" fragments earlier in the text
    const roleMatch = output.match(/escalat(?:e|ing)\s+(?:this\s+)?(?:to|for)\s+(?:the\s+)?(\w+)(?:\s+role)?/i)
    const reasonMatch = output.match(/(?:reason|because)[:\s]+([^\n]+)/i)

    return {
      detected: true,
      reason: reasonMatch?.[1]?.trim() ?? "Task requested escalation",
      suggestedRole: roleMatch?.[1]?.toLowerCase(),
      context: output.slice(0, 500),
    }
  }

  // Pattern: Outside expertise
  if (lowerOutput.includes("outside my expertise") || lowerOutput.includes("not my area")) {
    return {
      detected: true,
      reason: "Task outside role expertise",
      context: output.slice(0, 500),
    }
  }

  // Pattern: Insufficient permissions
  if (lowerOutput.includes("permission denied") || lowerOutput.includes("unauthorized")) {
    return {
      detected: true,
      reason: "Insufficient permissions",
      context: output.slice(0, 500),
    }
  }

  return { detected: false }
}

/**
 * Finds the nearest parent role that can delegate to the given role.
 * "Nearest" means the delegator with the highest tier number (closest
 * in the hierarchy) so that `worker → senior` is preferred over
 * `worker → orchestrator` when both can delegate to worker.
 */
export function findParentRole(role: string, teamConfig: TeamConfig): string | undefined {
  let best: { name: string; tier: number } | undefined
  for (const [roleName, roleDef] of Object.entries(teamConfig.roles)) {
    if (roleDef.canDelegate.includes(role)) {
      if (!best || roleDef.tier > best.tier) {
        best = { name: roleName, tier: roleDef.tier }
      }
    }
  }
  return best?.name
}

/**
 * Resolves the target role for escalation
 */
export function resolveEscalationTarget(
  currentRole: string,
  signal: EscalationSignal,
  teamConfig: TeamConfig,
): { role: string; reason: string } | undefined {
  // First priority: explicit suggested role if valid
  if (signal.suggestedRole && teamConfig.roles[signal.suggestedRole]) {
    return { role: signal.suggestedRole, reason: signal.reason ?? "Explicit escalation request" }
  }

  // Second priority: find parent role that can delegate
  const parent = findParentRole(currentRole, teamConfig)
  if (parent) {
    return { role: parent, reason: signal.reason ?? "Escalating to parent role" }
  }

  // Final fallback: default role
  if (teamConfig.routing.defaultRole && teamConfig.roles[teamConfig.routing.defaultRole]) {
    return { role: teamConfig.routing.defaultRole, reason: signal.reason ?? "Escalating to default role" }
  }

  return undefined
}

/**
 * Creates an escalated TaskResult from detection
 */
export function createEscalatedResult(
  taskId: string,
  output: string,
  signal: EscalationSignal,
  filesModified: string[],
): TaskResult {
  log.info("creating escalated result", { taskId, reason: signal.reason, targetRole: signal.suggestedRole })

  return {
    taskId,
    status: "escalated",
    output,
    filesModified,
    escalationReason: signal.reason,
  }
}

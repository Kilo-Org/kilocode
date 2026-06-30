import type { AgentRequirementResult } from "../types/messages"

export function keepAgentRequirementsResult(
  value: AgentRequirementResult | undefined,
  agent: string,
  directory: string,
) {
  if (!value || value.agent !== agent || value.directory !== directory) return false
  return value.state === "ready" || value.state === "blocked" || value.state === "error"
}

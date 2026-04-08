import z from "zod"
import { NamedError } from "@opencode-ai/util/error"
import type { TeamConfig, EffortLevel } from "./config"

export const TeamDelegationError = NamedError.create(
  "TeamDelegationError",
  z.object({
    parentRole: z.string(),
    targetRole: z.string(),
  }),
)

export const TeamConcurrencyError = NamedError.create(
  "TeamConcurrencyError",
  z.object({
    role: z.string(),
    maxConcurrent: z.number(),
  }),
)

export interface ResolvedTaskModel {
  model: { providerID: string; modelID: string }
  effort: EffortLevel
  role: string
}

export function resolveTaskModel(input: {
  subagentType: string
  teamConfig: TeamConfig | undefined
  parentRole: string | undefined
}): ResolvedTaskModel | undefined {
  const { subagentType, teamConfig, parentRole } = input

  // 1. If team not enabled, return undefined (existing behavior)
  if (!teamConfig?.enabled) return undefined

  // 2. Check if subagentType maps to a team role
  const role = teamConfig.roles[subagentType]
  if (!role) return undefined

  // 3. Enforce hierarchy (skip for flat strategy or top-level dispatch)
  if (teamConfig.routing.strategy === "hierarchical" && parentRole) {
    const parentRoleDef = teamConfig.roles[parentRole]
    if (parentRoleDef && !parentRoleDef.canDelegate.includes(subagentType)) {
      throw new TeamDelegationError({ parentRole, targetRole: subagentType })
    }
  }

  // 4. Return resolved model
  return {
    model: {
      providerID: role.provider,
      modelID: role.model,
    },
    effort: role.effort,
    role: subagentType,
  }
}

/**
 * useStagePosition — derives which team role covers a given workflow stage.
 *
 * Uses STAGE_CAPABILITY_REQUIREMENTS from capabilities.ts (single-capability per stage, R1-03).
 * Avoids a turbo cyclic dep by using the same lazy-require pattern as useTeamValidation.
 *
 * Architecture note: @devilcode/cli is available via bun workspace hoisting without
 * being declared in package.json. All cross-package types are declared locally
 * as structural duck-types to prevent Zod instance mismatches.
 */
import { createMemo, type Accessor } from "solid-js"

// ---------------------------------------------------------------------------
// Public types (locally declared — mirrors opencode types without importing them)
// ---------------------------------------------------------------------------

/** The 7 canonical workflow stage identifiers (matches WorkflowStage z.enum). */
export type WorkflowStageValue =
  | "plan"
  | "challenge"
  | "contract"
  | "build"
  | "review"
  | "ship"
  | "retro"

/** Structural duck-type for a team role config object. */
export type TeamRoleConfig = {
  label?: string
  model?: string
  capabilities?: string[]
  [key: string]: unknown
}

/** Structural duck-type for a team config object. */
export type UseStagePositionContext = {
  roles?: Record<string, TeamRoleConfig>
  [key: string]: unknown
}

export type StagePositionInfo = {
  stage: WorkflowStageValue
  /** The role key in the team config that covers this stage, or undefined if none. */
  position: string | undefined
  /** Human-readable role label, or undefined if no covering role. */
  roleLabel: string | undefined
  /** Model identifier for the covering role, or undefined if none. */
  modelLabel: string | undefined
  /** The required canonical capability for this stage. */
  requiredCapability: string | undefined
}

// ---------------------------------------------------------------------------
// Lazy module loader — avoids static cross-package import
// ---------------------------------------------------------------------------

type CapabilityMap = Record<string, string>

let _capMap: CapabilityMap | null = null

function getCapabilityMap(): CapabilityMap {
  if (_capMap) return _capMap
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const mod = require("@devilcode/cli/devilcode/team/capabilities") as {
      STAGE_CAPABILITY_REQUIREMENTS: CapabilityMap
    }
    /* eslint-enable @typescript-eslint/no-require-imports */
    _capMap = mod.STAGE_CAPABILITY_REQUIREMENTS
  } catch {
    // Fallback static map derived from capabilities.ts (compile-time-verified)
    _capMap = {
      plan: "planning",
      challenge: "planning",
      contract: "design",
      build: "implementation",
      review: "review",
      ship: "release",
      retro: "retrospective",
    }
  }
  return _capMap!
}

// ---------------------------------------------------------------------------
// Derive position from team config (R1-03 single-capability lookup)
// ---------------------------------------------------------------------------

function derivePosition(stage: WorkflowStageValue, team: UseStagePositionContext): StagePositionInfo {
  const capMap = getCapabilityMap()
  const required = capMap[stage]

  if (!required) {
    return { stage, position: undefined, roleLabel: undefined, modelLabel: undefined, requiredCapability: undefined }
  }

  const roles = team.roles ?? {}
  for (const [roleKey, role] of Object.entries(roles)) {
    const caps = (role as TeamRoleConfig).capabilities ?? []
    if (caps.includes(required)) {
      return {
        stage,
        position: roleKey,
        roleLabel: role.label,
        modelLabel: role.model,
        requiredCapability: required,
      }
    }
  }

  return { stage, position: undefined, roleLabel: undefined, modelLabel: undefined, requiredCapability: required }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Reactively derives which role covers a given workflow stage.
 *
 * @param stage   - Accessor or plain value for the target stage
 * @param team    - Accessor for the team config (roles, capabilities)
 */
export function useStagePosition(
  stage: Accessor<WorkflowStageValue>,
  team: Accessor<UseStagePositionContext>,
): Accessor<StagePositionInfo> {
  return createMemo<StagePositionInfo>(() => derivePosition(stage(), team()))
}

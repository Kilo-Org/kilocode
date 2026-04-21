import z from "zod"
import { CanonicalTeamConfig } from "./config"

// --- Zod Schemas ---

export const PositionSwapRequest = z.object({
  position: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
})
export type PositionSwapRequest = z.infer<typeof PositionSwapRequest>

export const PositionSwapErrorCode = z.enum([
  "POSITION_NOT_FOUND",
  "INVALID_PROVIDER",
  "INVALID_MODEL",
  "DELEGATION_VIOLATION",
  "WORKFLOW_NOT_ACTIVE",
])
export type PositionSwapErrorCode = z.infer<typeof PositionSwapErrorCode>

export const PositionSwapSuccess = z.object({
  success: z.literal(true),
  position: z.string(),
  previousProvider: z.string(),
  previousModel: z.string(),
  newProvider: z.string(),
  newModel: z.string(),
  slotsRebalanced: z.number(),
})
export type PositionSwapSuccess = z.infer<typeof PositionSwapSuccess>

export const PositionSwapFailure = z.object({
  success: z.literal(false),
  error: z.string(),
  code: PositionSwapErrorCode,
})
export type PositionSwapFailure = z.infer<typeof PositionSwapFailure>

export const PositionSwapResult = z.discriminatedUnion("success", [PositionSwapSuccess, PositionSwapFailure])
export type PositionSwapResult = z.infer<typeof PositionSwapResult>

// --- Validation ---

export function validatePositionSwap(
  teamConfig: CanonicalTeamConfig,
  request: PositionSwapRequest,
): { valid: true } | { valid: false; error: string; code: PositionSwapErrorCode } {
  // Check position exists
  if (!teamConfig.roles[request.position]) {
    return {
      valid: false,
      error: `Position '${request.position}' not found in team config`,
      code: "POSITION_NOT_FOUND",
    }
  }

  // Check delegation hierarchy (if hierarchical routing with parentRole)
  if (teamConfig.routing.strategy === "hierarchical") {
    const parentRole = teamConfig.routing.parentRole
    if (parentRole && teamConfig.roles[parentRole]) {
      const canDelegate = teamConfig.roles[parentRole].canDelegate as string[]
      if (!canDelegate.includes(request.position)) {
        return {
          valid: false,
          error: `Parent role '${parentRole}' cannot delegate to '${request.position}'`,
          code: "DELEGATION_VIOLATION",
        }
      }
    }
  }

  // Provider/model validation is advisory — errors surface at Session.create
  return { valid: true }
}

// --- Application ---

export function applyPositionSwap(teamConfig: CanonicalTeamConfig, request: PositionSwapRequest): PositionSwapResult {
  const validation = validatePositionSwap(teamConfig, request)
  if (!validation.valid) {
    return { success: false, error: validation.error, code: validation.code }
  }

  const role = teamConfig.roles[request.position]
  const previousProvider = role.provider
  const previousModel = role.model

  // Apply swap in-place (mutates the role within the config)
  role.provider = request.provider
  role.model = request.model

  return {
    success: true,
    position: request.position,
    previousProvider,
    previousModel,
    newProvider: request.provider,
    newModel: request.model,
    slotsRebalanced: 0,
  }
}

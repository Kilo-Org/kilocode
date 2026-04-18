/**
 * Canonical capability enum and stage→capability mapping.
 *
 * Single source of truth for what a workflow stage requires from a role.
 * Phase 1 is additive: this module is independent of legacy TeamRole/TeamConfig in config.ts.
 * Phase 2 migrates config.ts to reference CanonicalCapability.
 *
 * See .planning/specs/01-foundation-spec.md
 */

import z from "zod"
import { WorkflowStage } from "../workflow/types"

// ---------------------------------------------------------------------------
// Canonical capability enum
// ---------------------------------------------------------------------------

export const CanonicalCapability = z.enum([
  "planning",
  "design",
  "implementation",
  "review",
  "release",
  "testing",
  "research",
  "retrospective",
])
export type CanonicalCapability = z.infer<typeof CanonicalCapability>

// ---------------------------------------------------------------------------
// Stage → capability requirements map
// ---------------------------------------------------------------------------

export const STAGE_CAPABILITY_REQUIREMENTS: Record<z.infer<typeof WorkflowStage>, CanonicalCapability> = {
  plan: "planning",
  challenge: "planning",
  contract: "design",
  build: "implementation",
  review: "review",
  ship: "release",
  retro: "retrospective",
} as const

// Compile-time exhaustiveness assertion — fails typecheck if a new WorkflowStage
// is added without updating STAGE_CAPABILITY_REQUIREMENTS.
const _exhaustive: Record<z.infer<typeof WorkflowStage>, CanonicalCapability> = STAGE_CAPABILITY_REQUIREMENTS
void _exhaustive

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Returns the unique set of capabilities required for the given stages.
 * Deduplication preserves the order of first occurrence across stages.
 */
export function requiredCapabilitiesFor(stages: z.infer<typeof WorkflowStage>[]): CanonicalCapability[] {
  const seen = new Set<CanonicalCapability>()
  const result: CanonicalCapability[] = []
  for (const stage of stages) {
    const cap = STAGE_CAPABILITY_REQUIREMENTS[stage]
    if (!seen.has(cap)) {
      seen.add(cap)
      result.push(cap)
    }
  }
  return result
}

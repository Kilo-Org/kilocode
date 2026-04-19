import z from "zod"
import { CanonicalCapability, STAGE_CAPABILITY_REQUIREMENTS } from "./capabilities"
import { CanonicalPosition } from "./library"

export const EffortLevel = z.enum(["max", "xhigh", "high", "medium", "low", "default"]).default("default")
export type EffortLevel = z.infer<typeof EffortLevel>

// devilcode_change - audit MA4: schema reserved for future automation triggers.
// No runtime dispatcher consumes this yet; UI accepts and persists rules but they are
// inert until a workflow event subscriber is wired up. Keep the schema stable so user
// configs don't break when the dispatcher lands.
export const ReactionRule = z.object({
  trigger: z.enum(["ci-failed", "review-requested", "approved-and-green", "agent-stuck"]),
  auto: z.boolean().default(false),
  action: z.enum(["send-to-agent", "notify", "escalate"]),
  targetRole: z.string().optional(),
  retries: z.number().int().nonnegative().default(0),
  escalateAfterMinutes: z.number().int().positive().optional(),
})
export type ReactionRule = z.infer<typeof ReactionRule>

// ---------------------------------------------------------------------------
// Canonical types — Phase 9 owns the devil-vscode IPC schema update.
// ---------------------------------------------------------------------------

export const CanonicalTeamRole = z.object({
  displayName: z.string().min(1),
  positionId: CanonicalPosition,
  provider: z.string(),
  model: z.string(),
  effort: EffortLevel,
  tier: z.number().int().positive(),
  canDelegate: z.array(CanonicalPosition).default([]),
  maxConcurrent: z.number().int().positive().default(3),
  capabilities: z.array(CanonicalCapability).nonempty(),
  supplementaryCapabilities: z.array(z.string()).default([]),
})
export type CanonicalTeamRole = z.infer<typeof CanonicalTeamRole>

export const CanonicalTeamRouting = z.object({
  strategy: z.enum(["hierarchical", "flat"]).default("hierarchical"),
  defaultRole: CanonicalPosition,
  escalationEnabled: z.boolean().default(true),
  parentRole: CanonicalPosition.optional(),
  reviewEscalationRole: CanonicalPosition.optional(),
})
export type CanonicalTeamRouting = z.infer<typeof CanonicalTeamRouting>

export const CanonicalTeamConfig = z
  .object({
    enabled: z.boolean().default(false),
    // z.record(CanonicalPosition, ...) in Zod v4 requires ALL enum keys present.
    // We want partial presence (not all 11 positions required), so we use z.record(z.string(), ...)
    // and validate that every key is a valid CanonicalPosition via a refine below.
    roles: z.record(z.string(), CanonicalTeamRole),
    routing: CanonicalTeamRouting,
    reactions: z.array(ReactionRule).default([]).optional(),
  })
  .refine(
    (cfg) => Object.keys(cfg.roles).every((k) => CanonicalPosition.options.includes(k as CanonicalPosition)),
    { message: "All role keys must be valid CanonicalPosition values", path: ["roles"] },
  )
  .refine((cfg) => !cfg.enabled || cfg.routing.defaultRole in cfg.roles, {
    message: "routing.defaultRole must reference an existing role",
    path: ["routing", "defaultRole"],
  })
  .refine(
    (cfg) => !cfg.enabled || Object.values(cfg.roles).every((r) => r.canDelegate.every((d) => d in cfg.roles)),
    { message: "canDelegate entries must reference existing roles", path: ["roles"] },
  )
  .refine((cfg) => !cfg.enabled || !cfg.routing.parentRole || cfg.routing.parentRole in cfg.roles, {
    message: "routing.parentRole must reference an existing role",
    path: ["routing", "parentRole"],
  })
  .refine(
    (cfg) =>
      !cfg.enabled || !cfg.routing.reviewEscalationRole || cfg.routing.reviewEscalationRole in cfg.roles,
    {
      message: "routing.reviewEscalationRole must reference an existing role",
      path: ["routing", "reviewEscalationRole"],
    },
  )
  .superRefine((cfg, ctx) => {
    if (!cfg.enabled) return
    const missing: string[] = []
    for (const [stage, cap] of Object.entries(STAGE_CAPABILITY_REQUIREMENTS)) {
      const covered = Object.values(cfg.roles).some((r) => r.capabilities.includes(cap))
      if (!covered) missing.push(`${stage}(${cap})`)
    }
    if (missing.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Team missing canonical capability coverage for stages: ${missing.join(", ")}`,
        path: ["roles"],
      })
    }
  })
export type CanonicalTeamConfig = z.infer<typeof CanonicalTeamConfig>



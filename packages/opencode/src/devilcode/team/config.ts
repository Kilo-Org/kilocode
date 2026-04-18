import z from "zod"
import { CanonicalCapability, STAGE_CAPABILITY_REQUIREMENTS } from "./capabilities"
import { CanonicalPosition, POSITION_LIBRARY } from "./library"

export const EffortLevel = z.enum(["max", "xhigh", "high", "medium", "low", "default"]).default("default")
export type EffortLevel = z.infer<typeof EffortLevel>

export const TeamRole = z.object({
  displayName: z.string(),
  provider: z.string(),
  model: z.string(),
  effort: EffortLevel,
  tier: z.number().int().positive(),
  canDelegate: z.array(z.string()).default([]),
  maxConcurrent: z.number().int().positive().default(3),
  capabilities: z.array(z.string()).default([]),
})
export type TeamRole = z.infer<typeof TeamRole>

export const TeamRouting = z.object({
  strategy: z.enum(["hierarchical", "flat"]).default("hierarchical"),
  defaultRole: z.string(),
  escalationEnabled: z.boolean().default(true),
  // devilcode_change start - audit MA1: explicit parent role for hierarchical dispatch.
  // When omitted, BuildRunner falls back to defaultRole (no longer hardcoded "orchestrator").
  parentRole: z.string().optional(),
  // devilcode_change end
  // devilcode_change start - audit MA2: optional override for review-fix routing.
  // When omitted, reviewer falls back to defaultRole instead of hardcoded "senior".
  reviewEscalationRole: z.string().optional(),
  // devilcode_change end
})
export type TeamRouting = z.infer<typeof TeamRouting>

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

export const TeamConfig = z.object({
  enabled: z.boolean().default(false),
  roles: z.record(z.string(), TeamRole),
  routing: TeamRouting,
  reactions: z.array(ReactionRule).default([]).optional(),
}).refine(
  (cfg) => !cfg.enabled || cfg.routing.defaultRole in cfg.roles,
  { message: "routing.defaultRole must reference an existing role", path: ["routing", "defaultRole"] }
).refine(
  (cfg) => !cfg.enabled || Object.values(cfg.roles).every(role =>
    role.canDelegate.every(d => d in cfg.roles)
  ),
  { message: "canDelegate entries must reference existing roles", path: ["roles"] }
).refine(
  // devilcode_change - audit MA1: parentRole must reference an existing role when set.
  (cfg) => !cfg.enabled || !cfg.routing.parentRole || cfg.routing.parentRole in cfg.roles,
  { message: "routing.parentRole must reference an existing role", path: ["routing", "parentRole"] }
).refine(
  // devilcode_change - audit MA2: reviewEscalationRole must reference an existing role when set.
  (cfg) =>
    !cfg.enabled ||
    !cfg.routing.reviewEscalationRole ||
    cfg.routing.reviewEscalationRole in cfg.roles,
  { message: "routing.reviewEscalationRole must reference an existing role", path: ["routing", "reviewEscalationRole"] }
)
export type TeamConfig = z.infer<typeof TeamConfig>

// ---------------------------------------------------------------------------
// Canonical types — additive; legacy TeamRole/TeamConfig above remain intact.
// Phase 2 will flip presets and server endpoints to use these types.
// Phase 9 owns the devil-vscode IPC schema update.
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

// ---------------------------------------------------------------------------
// Migration helper — maps a legacy TeamConfig to CanonicalTeamConfig
// ---------------------------------------------------------------------------

export type LegacyMigrationIssue =
  | { kind: "unknown-capability"; roleId: string; value: string }
  | { kind: "missing-position-id"; roleId: string; inferredFrom?: string }
  | { kind: "ambiguous-capability-mapping"; roleId: string; value: string; candidates: CanonicalCapability[] }

export type LegacyMigrationResult =
  | { ok: true; value: CanonicalTeamConfig; warnings: LegacyMigrationIssue[] }
  | { ok: false; errors: LegacyMigrationIssue[]; warnings: LegacyMigrationIssue[] }

// Synonym table: legacy role key → CanonicalPosition
const POSITION_SYNONYM_MAP: Record<string, CanonicalPosition> = {
  lead: "senior-dev",
  coder: "developer",
  implementer: "developer",
  "ci-fixer": "release-engineer",
  release: "release-engineer",
  "frontend-dev": "frontend-specialist",
  "backend-dev": "backend-specialist",
  orchestrator: "coordinator",
  "deep-researcher": "researcher",
  "fast-scanner": "researcher",
  research: "researcher",
  reviewer: "reviewer",
  architect: "architect",
}

// Synonym table: legacy capability string → CanonicalCapability
const CAPABILITY_SYNONYM_MAP: Record<string, CanonicalCapability> = {
  planning: "planning",
  design: "design",
  coordination: "design",
  implementation: "implementation",
  coding: "implementation",
  code: "implementation",
  review: "review",
  "code-review": "review",
  "risk-analysis": "review",
  release: "release",
  ci: "release",
  testing: "testing",
  tests: "testing",
  research: "research",
  lookup: "research",
  search: "research",
  synthesis: "research",
  analysis: "research",
  "long-form": "research",
  triage: "research",
  retrospective: "retrospective",
}

// Capabilities that map to "implementation" but also land in supplementaryCapabilities
const SUPPLEMENTARY_TO_IMPLEMENTATION = new Set(["ui", "accessibility", "api", "db"])

export function fromLegacyTeamConfig(input: TeamConfig): LegacyMigrationResult {
  const errors: LegacyMigrationIssue[] = []
  const warnings: LegacyMigrationIssue[] = []
  const canonicalRoles: Record<string, CanonicalTeamRole> = {}

  for (const [roleId, role] of Object.entries(input.roles)) {
    // --- Infer positionId ---
    let positionId: CanonicalPosition | undefined

    // Direct match against CanonicalPosition values
    const directMatch = CanonicalPosition.safeParse(roleId)
    if (directMatch.success) {
      positionId = directMatch.data
    } else {
      // Synonym lookup
      const synonym = POSITION_SYNONYM_MAP[roleId]
      if (synonym) {
        positionId = synonym
      } else {
        errors.push({ kind: "missing-position-id", roleId })
      }
    }

    // --- Map capabilities ---
    const canonicalCapabilities: CanonicalCapability[] = []
    const supplementaryCapabilities: string[] = []

    for (const cap of role.capabilities) {
      if (SUPPLEMENTARY_TO_IMPLEMENTATION.has(cap)) {
        // Maps to implementation AND preserved in supplementary
        if (!canonicalCapabilities.includes("implementation")) {
          canonicalCapabilities.push("implementation")
        }
        supplementaryCapabilities.push(cap)
        continue
      }

      const mapped = CAPABILITY_SYNONYM_MAP[cap]
      if (mapped) {
        if (!canonicalCapabilities.includes(mapped)) {
          canonicalCapabilities.push(mapped)
        }
      } else {
        warnings.push({ kind: "unknown-capability", roleId, value: cap })
        supplementaryCapabilities.push(cap)
      }
    }

    // --- Map canDelegate to CanonicalPosition ---
    const canDelegate: CanonicalPosition[] = []
    for (const delegatee of role.canDelegate) {
      const directDelegateMatch = CanonicalPosition.safeParse(delegatee)
      if (directDelegateMatch.success) {
        canDelegate.push(directDelegateMatch.data)
      } else {
        const synonym = POSITION_SYNONYM_MAP[delegatee]
        if (synonym) {
          canDelegate.push(synonym)
        } else {
          // QA-4: use missing-position-id for position resolution failures, not unknown-capability
          warnings.push({ kind: "missing-position-id", roleId, inferredFrom: "canDelegate" })
        }
      }
    }

    // QA-2: deduplicate canDelegate entries (two legacy strings can resolve to the same CanonicalPosition)
    const uniqueCanDelegate = [...new Set(canDelegate)]

    if (positionId !== undefined) {
      const libraryEntry = POSITION_LIBRARY[positionId]

      // QA-1: emit warning when no capabilities map to canonical values before falling back
      if (canonicalCapabilities.length === 0) {
        warnings.push({ kind: "unknown-capability", roleId, value: "<no-mappable-capabilities-fallback:research>" })
      }
      const resolvedCapabilities = canonicalCapabilities.length > 0 ? canonicalCapabilities : ["research" as CanonicalCapability]

      // QA-3: detect collision when two legacy roles resolve to the same CanonicalPosition
      if (positionId in canonicalRoles) {
        const existing = canonicalRoles[positionId]!
        warnings.push({ kind: "ambiguous-capability-mapping", roleId, value: positionId, candidates: [] })
        // Merge: union capabilities (dedup), keep higher tier (lower number), keep higher effort (first-write-wins is existing)
        const mergedCapabilities = [...new Set([...existing.capabilities, ...resolvedCapabilities])] as [
          CanonicalCapability,
          ...CanonicalCapability[],
        ]
        const mergedTier = Math.min(existing.tier, libraryEntry ? libraryEntry.tier : role.tier)
        canonicalRoles[positionId] = {
          ...existing,
          capabilities: mergedCapabilities,
          tier: mergedTier,
          supplementaryCapabilities: [...new Set([...existing.supplementaryCapabilities, ...supplementaryCapabilities])],
        }
      } else {
        canonicalRoles[positionId] = {
          displayName: role.displayName,
          positionId,
          provider: role.provider,
          model: role.model,
          effort: role.effort,
          tier: libraryEntry ? libraryEntry.tier : role.tier,
          canDelegate: uniqueCanDelegate,
          maxConcurrent: role.maxConcurrent,
          capabilities: resolvedCapabilities as [CanonicalCapability, ...CanonicalCapability[]],
          supplementaryCapabilities,
        }
      }
    }
  }

  // If any role failed positionId resolution, return failure
  if (errors.length > 0) {
    return { ok: false, errors, warnings }
  }

  // Infer routing defaultRole
  const legacyDefault = input.routing.defaultRole
  let defaultRole: CanonicalPosition
  const directDefaultMatch = CanonicalPosition.safeParse(legacyDefault)
  if (directDefaultMatch.success) {
    defaultRole = directDefaultMatch.data
  } else {
    const synonym = POSITION_SYNONYM_MAP[legacyDefault]
    if (synonym) {
      defaultRole = synonym
    } else {
      // Fall back to first available canonical role
      const firstRole = Object.keys(canonicalRoles)[0]
      if (!firstRole) {
        return { ok: false, errors: [{ kind: "missing-position-id", roleId: legacyDefault }], warnings }
      }
      defaultRole = firstRole as CanonicalPosition
      warnings.push({ kind: "missing-position-id", roleId: legacyDefault })
    }
  }

  const canonicalConfig: unknown = {
    // Migration output always starts disabled: the coverage check is a runtime concern.
    // Phase 2 enables the canonical config after verifying full stage coverage.
    enabled: false,
    roles: canonicalRoles,
    routing: {
      strategy: input.routing.strategy,
      defaultRole,
      escalationEnabled: input.routing.escalationEnabled,
      parentRole: input.routing.parentRole
        ? CanonicalPosition.safeParse(input.routing.parentRole).success
          ? (input.routing.parentRole as CanonicalPosition)
          : POSITION_SYNONYM_MAP[input.routing.parentRole]
        : undefined,
      reviewEscalationRole: input.routing.reviewEscalationRole
        ? CanonicalPosition.safeParse(input.routing.reviewEscalationRole).success
          ? (input.routing.reviewEscalationRole as CanonicalPosition)
          : POSITION_SYNONYM_MAP[input.routing.reviewEscalationRole]
        : undefined,
    },
    reactions: input.reactions ?? [],
  }

  const parseResult = CanonicalTeamConfig.safeParse(canonicalConfig)
  if (!parseResult.success) {
    return {
      ok: false,
      errors: parseResult.error.issues.map((issue) => ({
        kind: "missing-position-id" as const,
        roleId: issue.path.join("."),
        inferredFrom: issue.message,
      })),
      warnings,
    }
  }

  return { ok: true, value: parseResult.data, warnings }
}

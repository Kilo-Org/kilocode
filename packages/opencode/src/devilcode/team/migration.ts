/**
 * Migration module — maps legacy TeamConfig shapes to canonical CanonicalTeamConfig.
 *
 * `fromLegacyTeamConfig` was moved here from `config.ts` (Phase 2, Plan 02-01).
 * No application code should depend on the `LegacyParse*` schemas — those are
 * exported solely for test-fixture construction.
 *
 * Public API:
 *   - `migrateLegacyTeamConfigFile(path)` — reads + parses a legacy JSON config file
 *   - `migrateLegacyTeamConfig(input)` — in-memory migration of an unknown value
 *   - `fromLegacyTeamConfig(input)` — low-level migration of a pre-parsed legacy shape
 *   - `LegacyMigrationIssue`, `LegacyMigrationResult` — result types
 *
 * @internal exports (test-only):
 *   - `LegacyParseTeamRole`, `LegacyParseTeamRouting`, `LegacyParseTeamConfig`
 */

import z from "zod"
import { readFileSync } from "node:fs"
import { CanonicalCapability } from "./capabilities"
import { CanonicalPosition, POSITION_LIBRARY } from "./library"
import { CanonicalTeamConfig, CanonicalTeamRole, ReactionRule, EffortLevel } from "./config"

// ---------------------------------------------------------------------------
// @internal Legacy parse schemas — TEST-ONLY consumption
//
// Exported SOLELY so test fixtures can construct legacy shapes without
// depending on the soon-to-be-deleted TeamConfig / TeamRole exports in
// config.ts. Do NOT import these from application code.
// Do NOT re-export from team/index.ts.
//
// Production callers must use migrateLegacyTeamConfigFile or
// migrateLegacyTeamConfig — those validate input via these schemas internally.
// ---------------------------------------------------------------------------

/**
 * @internal
 */
export const LegacyParseTeamRole = z.object({
  displayName: z.string(),
  provider: z.string(),
  model: z.string(),
  effort: EffortLevel,
  tier: z.number().int().positive(),
  canDelegate: z.array(z.string()).default([]),
  maxConcurrent: z.number().int().positive().default(3),
  capabilities: z.array(z.string()).default([]),
})

/**
 * @internal
 */
export const LegacyParseTeamRouting = z.object({
  strategy: z.enum(["hierarchical", "flat"]).default("hierarchical"),
  defaultRole: z.string(),
  parentRole: z.string().optional(),
  reviewEscalationRole: z.string().optional(),
  escalationEnabled: z.boolean().default(true),
})

/**
 * @internal Legacy team-config parse schema.
 *
 * Exported SOLELY so test fixtures can construct legacy shapes
 * without depending on the soon-to-be-deleted TeamConfig /
 * TeamRole exports in config.ts. Do NOT import these from
 * application code. Do NOT re-export from team/index.ts.
 *
 * Production callers should use migrateLegacyTeamConfigFile or
 * migrateLegacyTeamConfig instead — those validate input via
 * these schemas internally.
 */
export const LegacyParseTeamConfig = z.object({
  enabled: z.boolean().default(false),
  roles: z.record(z.string(), LegacyParseTeamRole),
  routing: LegacyParseTeamRouting,
  reactions: z.array(ReactionRule).default([]).optional(),
})

type LegacyTeamConfigShape = z.infer<typeof LegacyParseTeamConfig>

// ---------------------------------------------------------------------------
// Migration result types
// ---------------------------------------------------------------------------

export type LegacyMigrationIssue =
  | { kind: "unknown-capability"; roleId: string; value: string }
  | { kind: "missing-position-id"; roleId: string; inferredFrom?: string }
  | { kind: "ambiguous-capability-mapping"; roleId: string; value: string; candidates: CanonicalCapability[] }
  | { kind: "parse-failure"; roleId: "<root>"; message: string }

export type LegacyMigrationResult =
  | { ok: true; value: CanonicalTeamConfig; warnings: LegacyMigrationIssue[] }
  | { ok: false; errors: LegacyMigrationIssue[]; warnings: LegacyMigrationIssue[] }

// ---------------------------------------------------------------------------
// Internal synonym tables (moved from config.ts)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Core migration logic (MOVED from config.ts)
// ---------------------------------------------------------------------------

/**
 * Low-level migration of a pre-parsed legacy team config shape.
 *
 * Requires a `LegacyTeamConfigShape` input that has already been validated
 * via `LegacyParseTeamConfig.parse()`. External callers working with unknown
 * JSON input should use `migrateLegacyTeamConfig(unknown)` instead — it
 * validates the input schema before delegating here.
 */
export function fromLegacyTeamConfig(input: LegacyTeamConfigShape): LegacyMigrationResult {
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
      const resolvedCapabilities =
        canonicalCapabilities.length > 0 ? canonicalCapabilities : ["research" as CanonicalCapability]

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
          canDelegate: [...new Set([...existing.canDelegate, ...uniqueCanDelegate])] as CanonicalPosition[],
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

// ---------------------------------------------------------------------------
// Public file-based API
// ---------------------------------------------------------------------------

export function migrateLegacyTeamConfigFile(path: string): LegacyMigrationResult {
  try {
    const raw = readFileSync(path, "utf8")
    const json = JSON.parse(raw)
    return migrateLegacyTeamConfig(json)
  } catch (err) {
    return {
      ok: false,
      errors: [{ kind: "parse-failure", roleId: "<root>", message: err instanceof Error ? err.message : String(err) }],
      warnings: [],
    }
  }
}

// ---------------------------------------------------------------------------
// In-memory variant
// ---------------------------------------------------------------------------

export function migrateLegacyTeamConfig(input: unknown): LegacyMigrationResult {
  const parsed = LegacyParseTeamConfig.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      errors: [{ kind: "parse-failure", roleId: "<root>", message: parsed.error.message }],
      warnings: [],
    }
  }
  return fromLegacyTeamConfig(parsed.data)
}

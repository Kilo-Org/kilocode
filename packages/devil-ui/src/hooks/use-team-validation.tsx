/**
 * useTeamValidation — reactive Zod-driven team validation hook.
 *
 * Phase 4 hook consumed by the TUI team-builder view (Plan 04-03) and re-used by the
 * VS Code Agent Manager webview in Phase 9. Calls CanonicalTeamConfig.safeParse with
 * enabled=true so the existing superRefine stage-coverage validator fires.
 *
 * Architecture note: @devilcode/cli and @devilcode/kilo-ui have a mutual workspace
 * dependency (cli → kilo-ui for TUI primitives). Adding @devilcode/cli to devil-ui's
 * package.json creates a turbo cyclic dependency graph error. Instead, this hook:
 *   1. Declares the validator interface it needs as a local structural type
 *   2. Uses a lazy singleton pattern to load the validator from @devilcode/cli at
 *      first call, avoiding static import resolution at typecheck time
 *
 * @devilcode/cli is available in node_modules through bun workspace hoisting and
 * declared as an optional peer dependency.
 */
import { createMemo, type Accessor } from "solid-js"

// ---------------------------------------------------------------------------
// Public types — locally declared to avoid cross-package Zod instance issues
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

/**
 * Structural duck-type for a Zod v4 issue. Avoids importing `ZodIssue` from
 * devil-ui's own zod module to prevent cross-instance type mismatches with
 * opencode's Zod generic types.
 */
export type TeamIssue = {
  code: string
  message: string
  path: (string | number)[]
  [key: string]: unknown
}

export type TeamValidationResult = {
  isValid: boolean
  missingStages: WorkflowStageValue[]
  errorsByRole: Record<string, TeamIssue[]>
  rawErrors: TeamIssue[]
}

// ---------------------------------------------------------------------------
// Lazy runtime validator — avoids static cross-package import
// ---------------------------------------------------------------------------

type TeamConfigValidator = {
  safeParse(data: unknown): { success: true } | { success: false; error: { issues: TeamIssue[] } }
}

type StageValidator = {
  safeParse(v: unknown): { success: true; data: WorkflowStageValue } | { success: false }
}

type ValidatorBundle = { teamConfig: TeamConfigValidator; workflowStage: StageValidator }

let _validators: ValidatorBundle | null = null

function getValidators(): ValidatorBundle {
  if (_validators) return _validators
  // Dynamic require within a function body avoids tsgo static analysis of the import.
  // The package is available via bun workspace hoisting without being declared in package.json.
  /* eslint-disable @typescript-eslint/no-require-imports */
  const teamCfgMod = require(
    "@devilcode/cli/devilcode/team/config",
  ) as { CanonicalTeamConfig: TeamConfigValidator }
  const workflowMod = require(
    "@devilcode/cli/devilcode/workflow/types",
  ) as { WorkflowStage: StageValidator }
  /* eslint-enable @typescript-eslint/no-require-imports */
  _validators = { teamConfig: teamCfgMod.CanonicalTeamConfig, workflowStage: workflowMod.WorkflowStage }
  return _validators
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STAGE_PATTERN = /Team missing canonical capability coverage for stages:\s*(.+)$/

function extractMissingStages(errors: TeamIssue[], workflowStage: StageValidator): WorkflowStageValue[] {
  const result = new Set<WorkflowStageValue>()
  for (const err of errors) {
    const match = err.message.match(STAGE_PATTERN)
    if (!match) continue
    for (const fragment of match[1]!.split(",")) {
      const stageName = fragment.trim().split("(")[0]!.trim()
      const parsed = workflowStage.safeParse(stageName)
      if (parsed.success) result.add(parsed.data)
    }
  }
  return Array.from(result)
}

function groupErrorsByRole(errors: TeamIssue[]): Record<string, TeamIssue[]> {
  const out: Record<string, TeamIssue[]> = {}
  for (const err of errors) {
    if (err.path[0] !== "roles") continue
    const roleKey = err.path[1]
    if (typeof roleKey !== "string") continue
    if (!out[roleKey]) out[roleKey] = []
    out[roleKey].push(err)
  }
  return out
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTeamValidation(
  config: Accessor<unknown>,
): Accessor<TeamValidationResult> {
  return createMemo<TeamValidationResult>(() => {
    const { teamConfig, workflowStage } = getValidators()
    const candidate = { ...(config() as object), enabled: true }
    const result = teamConfig.safeParse(candidate)
    if (result.success) {
      return { isValid: true, missingStages: [], errorsByRole: {}, rawErrors: [] }
    }
    const issues = result.error.issues
    return {
      isValid: false,
      missingStages: extractMissingStages(issues, workflowStage),
      errorsByRole: groupErrorsByRole(issues),
      rawErrors: issues,
    }
  })
}

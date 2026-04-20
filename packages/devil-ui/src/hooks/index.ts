export { useFilteredList } from "@opencode-ai/ui/hooks"
export * from "./create-auto-scroll"

export { CommandRegistryProvider, useCommandRegistry } from "./use-command-registry"
export { usePromptHistory, createMemoryStore } from "./use-prompt-history"
export type { PromptHistoryStore } from "./use-prompt-history"
// Phase 4: team validation hook
export { useTeamValidation, type TeamValidationResult } from "./use-team-validation"
// Phase 5: density + first-run + stage-position hooks
export { useDensity, useDensityOptional, type DensityMode } from "./use-density"
export { useFirstRun, type UseFirstRunOptions, type UseFirstRunResult } from "./use-first-run"
export { useStagePosition, type UseStagePositionContext, type StagePositionInfo, type WorkflowStageValue } from "./use-stage-position"

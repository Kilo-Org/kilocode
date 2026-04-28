/**
 * Maximum number of parallel worktree versions for multi-version mode.
 * Keep in sync with MAX_MULTI_VERSIONS in webview-ui/src/types/messages.ts.
 */
export const MAX_MULTI_VERSIONS = 4

/** Telemetry source identifier for all Agent Manager events. */
export const PLATFORM = "agent-manager" as const

/** Kilo config directory name (project-level and inside worktrees). */
export const KILO_DIR = ".kilo"

import * as path from "node:path"

/**
 * Maximum number of parallel worktree versions for multi-version mode.
 * Keep in sync with MAX_MULTI_VERSIONS in webview-ui/src/types/messages.ts.
 */
export const MAX_MULTI_VERSIONS = 4

/** Telemetry source identifier for all Agent Manager events. */
export const PLATFORM = "agent-manager" as const

/** Devil config directory name (project-level and inside worktrees). */
export const DEVIL_DIR = ".kilo"

/** Legacy config directory name - kept for reference but migration removed. */
export const LEGACY_DIR = ".devilcode"

/** Result of the migration so callers can react (e.g. refresh VS Code git). */
export interface MigrationResult {
  /** Number of git worktree refs that were rewritten from .devilcode → .kilo. */
  refsFixed: number
}

/**
 * Migration from .devilcode/ to .kilo/ has been removed after GA release.
 * Users on legacy versions should manually migrate or reconfigure.
 */
export async function migrateAgentManagerData(_root: string, _log: (msg: string) => void): Promise<MigrationResult> {
  return { refsFixed: 0 }
}

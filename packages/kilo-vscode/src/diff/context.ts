import type { GitOps } from "../agent-manager/GitOps"

/** Host-side context of one diff panel. Kept out of `types.ts` so the webview never pulls Node modules. */
export interface PanelContext {
  workspaceRoot: string | undefined
  sessionId?: string
  /** Overrides the computed default source on open. */
  initialSourceId?: string
  /** Hides the source picker header in the diff viewer. */
  hidePicker?: boolean
  /** User-picked base branch for the workspace source. Undefined = auto. */
  baseBranchOverride?: string
  /** Explicit directory to diff inside, overriding the workspace root lookup. */
  dir?: string
  /**
   * When true, a source whose `dir` resolves to undefined returns an empty
   * diff instead of falling back to the workspace root.
   */
  strictDir?: boolean
  /** Explicit base ref for the workspace source, skipping auto-resolution. */
  baseBranch?: string
  /** Shared GitOps / log injected by Agent Manager to avoid per-source channels. */
  git?: GitOps
  log?: (...args: unknown[]) => void
}
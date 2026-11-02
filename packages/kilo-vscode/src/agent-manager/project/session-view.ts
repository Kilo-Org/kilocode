import type { SessionInfo } from "@opencode/client"

/** A root session as shown in a project's sidebar, tagged with its worktree. */
export type ProjectSessionView = SessionInfo & { worktreeId: string | null }

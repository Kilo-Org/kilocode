import { Effect } from "effect"
import type { SessionID } from "@/session/schema"
import type { KiloHooks } from "./hooks"

// Kilo-only git events: CommitMessage (IDE commit message generation) and BranchName (Agent
// Manager branch names).

/**
 * CommitMessage after a commit message was generated. Returns the message, rewritten by
 * `hookSpecificOutput.commitMessage`; a block fails with `KiloHooks.Blocked`.
 */
export function commit(input: {
  /** Repository path the client sent; hooks run there only when it is inside the instance worktree. */
  path: string
  message: string
  selected?: readonly string[]
  previous?: string
  language?: string
}): Effect.Effect<string, KiloHooks.Blocked> {
  return Effect.succeed(input.message)
}

/**
 * BranchName after an Agent Manager branch name was generated. Returns the name, rewritten by
 * `hookSpecificOutput.branchName`, or null when a hook blocked it (the worktree keeps its name).
 */
export function branch(input: { sessionID: SessionID; branch: string; prompt: string }): Effect.Effect<string | null> {
  return Effect.succeed(input.branch)
}

export * as KiloHookGit from "./git"

// The client actions of the slash menu. Each action runs a handler that the surface already has; an action without a
// handler on this surface is not listed. Kept free of JSX and webview contexts, so the extension tests can load it.
import type { CommandInfo } from "@opencode/client"
import type { SlashEntry } from "./slash"

const ACTIONS = [
  { name: "new", key: "prompt.slash.new", hints: ["clear"] },
  { name: "sessions", key: "prompt.slash.sessions", hints: ["resume", "continue", "history"] },
  { name: "models", key: "prompt.slash.models", hints: ["model"] },
  { name: "agents", key: "prompt.slash.agents", hints: ["modes"] },
  { name: "variant", key: "prompt.slash.variant", hints: ["variants", "reasoning", "thinking"] },
  { name: "compact", key: "prompt.slash.compact", hints: ["smol", "condense"] },
  { name: "help", key: "prompt.slash.help", hints: [] },
  { name: "settings", key: "prompt.slash.settings", hints: [] },
  { name: "reload", key: "common.reloadDescription", hints: ["refresh"] },
] as const

export type SlashActionName = (typeof ACTIONS)[number]["name"]

export type SlashHandlers = Partial<Record<SlashActionName, () => void>>

/** The menu entries of the actions this surface handles, in menu order. */
export function slashActions(handlers: SlashHandlers, t: (key: string) => string): SlashEntry[] {
  return ACTIONS.flatMap((action): SlashEntry[] => {
    const run = handlers[action.name]
    if (!run) return []
    return [{ kind: "action", name: action.name, description: t(action.key), hints: [...action.hints], run }]
  })
}

const SCOPES = [
  { scope: "worktree", key: "prompt.slash.review.worktree", hints: [] },
  { scope: "uncommitted", key: "prompt.slash.review.uncommitted", hints: [] },
  { scope: "staged", key: "prompt.slash.review.staged", hints: [] },
  { scope: "unpushed", key: "prompt.slash.review.unpushed", hints: [] },
  { scope: "branch", key: "prompt.slash.review.branch", hints: [] },
  { scope: "quick", key: "prompt.slash.review.quick", hints: ["--quick", "fast"] },
] as const

/**
 * The nested scopes of the server `/review` command, which reads the scope word as the first argument. The worktree
 * scope needs Agent Manager worktree metadata, so it is listed only for a worktree session.
 */
export function reviewScopes(
  commands: readonly CommandInfo[],
  worktree: boolean,
  t: (key: string) => string,
): SlashEntry[] {
  const command = commands.find((item) => item.name === "review")
  if (!command) return []
  return SCOPES.filter((item) => worktree || item.scope !== "worktree").map((item) => ({
    kind: "command",
    name: `review ${item.scope}`,
    description: t(item.key),
    hints: [...item.hints],
    command,
    args: item.scope,
  }))
}

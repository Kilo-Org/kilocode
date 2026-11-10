// The client actions of the slash menu. Each action runs a handler that the surface already has; an action without a
// handler on this surface is not listed. Kept free of JSX and webview contexts, so the extension tests can load it.
import type { CommandInfo } from "@opencode/client"
import type { SlashEntry } from "./slash"

// Descriptions reuse strings that every locale already translates. An action without a matching string has none.
const ACTIONS = [
  { name: "new", key: "command.session.new", hints: ["clear"] },
  { name: "sessions", key: "sidebar.topBar.history", hints: ["resume", "continue", "history"] },
  { name: "models", key: "settings.models.title", hints: ["model"] },
  { name: "agents", key: "settings.agentBehaviour.subtab.agents", hints: ["modes"] },
  { name: "marketplace", key: "sidebar.topBar.marketplace", hints: ["extensions", "skills", "mcp"] },
  { name: "variant", key: "prompt.thinking.tooltip", hints: ["variants", "reasoning", "thinking"] },
  { name: "compact", key: "command.session.compact", hints: ["smol", "condense"] },
  { name: "caffeinate", key: "agentManager.caffeination.toggle", hints: ["caffenate", "keep-awake", "awake", "sleep"] },
  { name: "help", hints: [] },
  { name: "settings", key: "sidebar.topBar.settings", hints: [] },
  { name: "reload", key: "common.reloadDescription", hints: ["refresh"] },
] as const

export type SlashActionName = (typeof ACTIONS)[number]["name"]

export type SlashHandlers = Partial<Record<SlashActionName, () => void>>

/** The menu entries of the actions this surface handles, in menu order. */
export function slashActions(handlers: SlashHandlers, t: (key: string) => string): SlashEntry[] {
  return ACTIONS.flatMap((action): SlashEntry[] => {
    const run = handlers[action.name]
    if (!run) return []
    const description = "key" in action ? t(action.key) : undefined
    return [{ kind: "action", name: action.name, description, hints: [...action.hints], run }]
  })
}

// The scope word of the command name already says what the row does, so a scope has no description to translate.
const SCOPES = [
  { scope: "worktree", hints: [] },
  { scope: "uncommitted", hints: [] },
  { scope: "staged", hints: [] },
  { scope: "unpushed", hints: [] },
  { scope: "branch", hints: [] },
  { scope: "quick", hints: ["--quick", "fast"] },
] as const

/**
 * The nested scopes of the server `/review` command, which reads the scope word as the first argument. The worktree
 * scope needs Agent Manager worktree metadata, so it is listed only for a worktree session.
 */
export function reviewScopes(commands: readonly CommandInfo[], worktree: boolean): SlashEntry[] {
  const command = commands.find((item) => item.name === "review")
  if (!command) return []
  return SCOPES.filter((item) => worktree || item.scope !== "worktree").map((item) => ({
    kind: "command",
    name: `review ${item.scope}`,
    hints: [...item.hints],
    command,
    args: item.scope,
  }))
}

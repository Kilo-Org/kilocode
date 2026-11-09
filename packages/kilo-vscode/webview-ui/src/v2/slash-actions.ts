// The client actions of the slash menu. Each action runs a handler that the surface already has; an action without a
// handler on this surface is not listed. Kept free of JSX and webview contexts, so the extension tests can load it.
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

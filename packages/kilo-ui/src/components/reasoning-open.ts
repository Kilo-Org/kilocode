export type ReasoningDisplay = "expanded" | "preview" | "headline"

export type ReasoningOpenInput = {
  mode: ReasoningDisplay
  streamed: boolean
  userOpened: boolean
  userCollapsed: boolean
}

/**
 * Initial/derived open state for a reasoning block.
 *
 * `userCollapsed` always wins. Each mode follows its own display rule so a
 * block that mounts before the resolved mode arrives can re-derive once the
 * config loads.
 */
export function reasoningOpenState(input: ReasoningOpenInput): boolean {
  if (input.userCollapsed) return false
  if (input.mode === "headline") return input.userOpened
  if (input.mode === "preview") return input.streamed || input.userOpened
  return true
}

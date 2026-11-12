export type ReasoningDisplay = "expanded" | "preview" | "headline"

export type ReasoningOpenInput = {
  mode: ReasoningDisplay
  userOpened: boolean
  userCollapsed: boolean
}

/**
 * Initial/derived open state for a reasoning block.
 *
 * The mode alone decides, so a block renders the same whether or not the transcript was mounted while
 * it streamed; only an explicit user choice differs per block. `userCollapsed` always wins, and each
 * mode is re-derived when the resolved mode arrives so a block that mounts before the config loads
 * still follows the configured layout.
 */
export function reasoningOpenState(input: ReasoningOpenInput): boolean {
  if (input.userCollapsed) return false
  if (input.mode === "headline") return input.userOpened
  return true
}

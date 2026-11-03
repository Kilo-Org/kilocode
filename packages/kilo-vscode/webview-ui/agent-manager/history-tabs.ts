/** The source tabs of the Agent Manager history. */
export type HistorySource = "local" | "worktree"

/**
 * The tab a keyboard request moves focus to. Arrows wrap, Home and End jump to
 * the first and last tab, and any other key leaves the tabs alone.
 */
export function historyTabTarget(
  sources: readonly HistorySource[],
  current: HistorySource,
  key: string,
): HistorySource | undefined {
  if (sources.length === 0) return undefined
  const index = sources.indexOf(current)
  if (index === -1) return undefined
  if (key === "Home") return sources[0]
  if (key === "End") return sources.at(-1)
  if (key === "ArrowLeft") return sources[(index - 1 + sources.length) % sources.length]
  if (key === "ArrowRight") return sources[(index + 1) % sources.length]
  return undefined
}
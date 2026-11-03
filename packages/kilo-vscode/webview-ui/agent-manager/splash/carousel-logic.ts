/** Index `delta` steps away from `index`, wrapping around both ends. */
export function wrap(index: number, delta: number, count: number): number {
  if (count === 0) return 0
  return (index + delta + count) % count
}

/** First card of the three-card window, keeping the selected card in the middle where possible. */
export function start(index: number, count: number): number {
  return Math.max(0, Math.min(index - 1, count - 3))
}

/** Card a key moves to. Arrow keys follow the reading direction. */
export function navigate(key: string, index: number, count: number, rtl: boolean): number | undefined {
  if (key === "Home") return 0
  if (key === "End") return count - 1
  const delta = { ArrowLeft: -1, ArrowRight: 1 }[key]
  if (delta === undefined) return
  return wrap(index, rtl ? -delta : delta, count)
}

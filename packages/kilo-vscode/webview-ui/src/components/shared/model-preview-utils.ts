/**
 * Format a model price for display.
 * Expects `n` in $/M tokens (as stored in model.cost.input / model.cost.output).
 */
export function fmtPrice(n: number): string {
  if (n === 0) return "Free"
  if (n < 0.01) return `$${n.toFixed(4)}/1M`
  return `$${n.toFixed(2)}/1M`
}

export function fmtCachedPrice(cost: { input: number; cache?: { read: number } }): string | null {
  const read = cost.cache?.read
  if (read !== undefined && read > 0) return fmtPrice(read)
  if (cost.input === 0) return fmtPrice(0)
  return null
}

export function avgPrice(cost: { input: number; output: number; cache?: { read: number } }): number {
  const read = cost.cache?.read
  if (read !== undefined && read > 0) {
    return read * 0.7 + cost.input * 0.2 + cost.output * 0.1
  }
  return cost.input * 0.9 + cost.output * 0.1
}

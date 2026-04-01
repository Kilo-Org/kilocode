/**
 * Format a model price for display.
 * Expects `n` in $/M tokens (as stored in model.cost.input / model.cost.output).
 */
export function fmtPrice(n: number): string {
  if (n === 0) return "Free"
  if (n < 0.01) return `$${n.toFixed(4)}/1M`
  return `$${n.toFixed(2)}/1M`
}

// kilocode_change - new file

/**
 * Format model pricing for display in the model picker.
 *
 * Cost values are per million tokens (e.g. 3 = $3.00/M).
 * Returns a compact string like "$3/$15" or undefined when
 * pricing data is unavailable or zero (free models are
 * labelled separately).
 */
export function formatPricing(cost: { input: number; output: number } | undefined): string | undefined {
  if (!cost) return undefined
  if (cost.input === 0 && cost.output === 0) return undefined
  return `$${formatRate(cost.input)}/$${formatRate(cost.output)}`
}

function formatRate(rate: number): string {
  if (rate === 0) return "0"
  if (rate >= 100) return rate.toFixed(0)
  // Up to 4 decimal places of precision, strip trailing zeros
  const decimals = rate >= 10 ? 1 : rate >= 1 ? 2 : 4
  return rate.toFixed(decimals).replace(/\.?0+$/, "")
}

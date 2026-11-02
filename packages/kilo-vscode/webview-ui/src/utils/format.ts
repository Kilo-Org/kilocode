/** Compact K/M formatting for token counts, e.g. 1234 -> "1.2K". */
export function formatCompactCount(n: number): string {
  // Thresholds account for toFixed(1) rounding up at the unit boundary, so e.g.
  // 999_950 renders "1.0M" rather than "1000.0K".
  if (n >= 999_950) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

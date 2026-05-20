/**
 * age.ts — Human-readable time ago from milliseconds
 * Zero deps. Pure math.
 *
 * age(0) → "today"
 * age(86400000) → "yesterday"
 * age(432000000) → "5 days ago"
 * stale(0) → "" | stale(432000000) → "This record is 5 days old..."
 */

const DAY = 86_400_000

export function days(ms: number): number {
  return Math.max(0, Math.floor((Date.now() - ms) / DAY))
}

export function ago(ms: number): string {
  const d = days(ms)
  if (d === 0) return "today"
  if (d === 1) return "yesterday"
  return `${d} days ago`
}

export function stale(ms: number): string {
  const d = days(ms)
  if (d <= 1) return ""
  return `This record is ${d} days old. Verify before trusting.`
}

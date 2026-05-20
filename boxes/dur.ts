/**
 * dur.ts — Milliseconds → human duration
 * Zero deps. Pure string.
 *
 * ms(500)  → "500ms"
 * ms(1500) → "1.5s"
 * ms(150)  → "2m30s"
 */

export function ms(n: number): string {
  if (n < 1000) return `${Math.round(n)}ms`
  const s = n / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  return `${Math.floor(s / 60)}m${Math.round(s % 60)}s`
}

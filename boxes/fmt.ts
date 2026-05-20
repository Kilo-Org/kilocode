/**
 * fmt.ts — Number → currency string
 * Zero deps. Pure string.
 *
 * money(0.0123) → "$0.0123"
 * money(1.5)    → "$1.50"
 */

export function money(n: number, prec = 4): string {
  return `$${n > 0.5 ? n.toFixed(2) : n.toFixed(prec)}`
}

export function num(n: number): string {
  return n.toLocaleString()
}

/**
 * tokens.ts — Rough token estimator
 * Zero deps.
 *
 * count("hello world") → 3
 */
export function count(text: string): number {
  return Math.max(0, Math.round((text || "").length / 4))
}

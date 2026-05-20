/**
 * tab-complete.ts — Prefix-based fuzzy completion with ranking
 * Inspired by Continue.dev CompletionProvider (Apache-2.0)
 * Deps: none
 */

export function fuzzyMatch(prefix: string, candidate: string): boolean {
  const p = prefix.toLowerCase()
  const c = candidate.toLowerCase()
  let pi = 0
  for (let ci = 0; ci < c.length && pi < p.length; ci++) {
    if (p[pi] === c[ci]) pi++
  }
  return pi === p.length
}

export function scoreCandidate(prefix: string, candidate: string): number {
  const p = prefix.toLowerCase()
  const c = candidate.toLowerCase()
  if (c === p) return 100
  if (c.startsWith(p)) return 80
  if (c.includes(p)) return 60
  if (fuzzyMatch(p, c)) return 40
  return 0
}

export function tabComplete(
  prefix: string,
  candidates: string[],
  topK = 10,
): string[] {
  return candidates
    .map(c => ({ c, s: scoreCandidate(prefix, c) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, topK)
    .map(x => x.c)
}

export function jaccard(a: string, b: string): number {
  const sa = new Set(a.toLowerCase().split(/\W+/).filter(Boolean))
  const sb = new Set(b.toLowerCase().split(/\W+/).filter(Boolean))
  const intersection = [...sa].filter(x => sb.has(x)).length
  const union = new Set([...sa, ...sb]).size
  return union === 0 ? 0 : intersection / union
}

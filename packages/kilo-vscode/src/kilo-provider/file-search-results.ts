import fuzzysort from "fuzzysort"

function base(p: string): string {
  const clean = p.replace(/\/+$/, "")
  return clean.split("/").pop() ?? clean
}

function depth(p: string): number {
  return p.split("/").length - 1
}

function score(query: string, p: string) {
  const name = base(p)
  const label = fuzzysort.single(query, name)
  const path = fuzzysort.single(query, p)
  return {
    p,
    label,
    path,
    depth: depth(p),
  }
}

function compare(a: ReturnType<typeof score>, b: ReturnType<typeof score>): number {
  const alabel = a.label !== null
  const blabel = b.label !== null
  if (alabel !== blabel) return alabel ? -1 : 1

  const ascore = a.label?.score ?? a.path?.score ?? 0
  const bscore = b.label?.score ?? b.path?.score ?? 0
  if (ascore !== bscore) return bscore - ascore

  const aname = base(a.p)
  const bname = base(b.p)
  if (aname.length !== bname.length) return aname.length - bname.length
  if (a.depth !== b.depth) return a.depth - b.depth
  if (a.p.length !== b.p.length) return a.p.length - b.p.length
  return a.p.localeCompare(b.p)
}

function rankOpen(query: string, paths: string[]): string[] {
  if (!query || !paths.length) return paths
  const scored: Array<ReturnType<typeof score>> = []
  for (const p of paths) {
    const result = score(query, p)
    if (result.path) scored.push(result)
  }
  return scored.sort(compare).map((x) => x.p)
}

function rankBackend(query: string, paths: string[]): string[] {
  if (!query || paths.length <= 1) return paths
  return paths
    .map((p) => score(query, p))
    .sort(compare)
    .map((x) => x.p)
}

export function mergeFileSearchResults(input: {
  query: string
  backend: string[]
  open: Set<string>
  active?: string
}): string[] {
  const norm = (p: string) => p.replaceAll("\\", "/")
  const query = norm(input.query).trim().toLowerCase()
  const open = new Set([...input.open].map(norm))
  const active = input.active ? norm(input.active) : undefined
  const backend = input.backend.map(norm)
  const matched = rankOpen(query, [...open])
  const tabs = (() => {
    if (!active || !matched.includes(active)) return matched
    return [active, ...matched.filter((p) => p !== active)]
  })()
  const seen = new Set(tabs)
  const remaining = backend.filter((p) => !seen.has(p))
  return [...tabs, ...rankBackend(query, remaining)]
}

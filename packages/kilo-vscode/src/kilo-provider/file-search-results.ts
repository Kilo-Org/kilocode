import fuzzysort from "fuzzysort"

function base(p: string): string {
  const clean = p.replace(/\/+$/, "")
  return clean.split("/").pop() ?? clean
}

function depth(p: string): number {
  return p.split("/").length - 1
}

/**
 * `basis` is the path the match is judged on, which is not always the path that
 * gets inserted. Entries from other workspace folders are absolute, and scoring
 * those in full would let a query match the filesystem prefix — a username or a
 * parent directory — on every one of them, and would inflate their depth.
 */
function score(query: string, p: string, priority: number, basis: string) {
  const name = base(basis)
  return {
    p,
    basis,
    name,
    label: fuzzysort.single(query, name),
    path: fuzzysort.single(query, basis),
    depth: depth(basis),
    priority,
  }
}

function compare(a: ReturnType<typeof score>, b: ReturnType<typeof score>): number {
  const alabel = a.label !== null
  const blabel = b.label !== null
  if (alabel !== blabel) return alabel ? -1 : 1

  const ascore = a.label?.score ?? a.path?.score ?? 0
  const bscore = b.label?.score ?? b.path?.score ?? 0
  if (ascore !== bscore) return bscore - ascore

  // Only once match quality ties does the owning workspace folder matter, so a
  // strong match in an added folder still beats a weak one in the session's own
  // project. Reversing these two would bury exact filename matches.
  if (a.priority !== b.priority) return a.priority - b.priority

  if (a.name.length !== b.name.length) return a.name.length - b.name.length
  if (a.depth !== b.depth) return a.depth - b.depth
  if (a.basis.length !== b.basis.length) return a.basis.length - b.basis.length
  return a.p.localeCompare(b.p)
}

type Basis = (p: string) => { priority: number; basis: string }

function rankOpen(query: string, paths: string[], of: Basis): string[] {
  if (!query || !paths.length) return paths
  const scored: Array<ReturnType<typeof score>> = []
  for (const p of paths) {
    const meta = of(p)
    const result = score(query, p, meta.priority, meta.basis)
    if (result.path) scored.push(result)
  }
  return scored.sort(compare).map((x) => x.p)
}

function rankBackend(query: string, paths: string[], of: Basis): string[] {
  if (!query || paths.length <= 1) return paths
  return paths
    .map((p) => {
      const meta = of(p)
      return score(query, p, meta.priority, meta.basis)
    })
    .sort(compare)
    .map((x) => x.p)
}

export function mergeFileSearchResults(input: {
  query: string
  backend: string[]
  open: Set<string>
  active?: string
  /**
   * Path to owning workspace-folder index, used only to break ties between
   * equally good matches. Absent entries rank as the session's own project.
   */
  priority?: Map<string, number>
  /**
   * Path to the root-relative path it should be judged on. Absent entries are
   * judged on themselves, which is what single-root search does.
   */
  relative?: Map<string, string>
}): string[] {
  const norm = (p: string) => p.replaceAll("\\", "/")
  const query = norm(input.query).trim().toLowerCase()
  const open = new Set([...input.open].map(norm))
  const active = input.active ? norm(input.active) : undefined
  const backend = input.backend.map(norm)
  const of: Basis = (p) => ({ priority: input.priority?.get(p) ?? 0, basis: input.relative?.get(p) ?? p })
  const matched = rankOpen(query, [...open], of)
  const tabs = (() => {
    if (!active || !matched.includes(active)) return matched
    return [active, ...matched.filter((p) => p !== active)]
  })()
  const seen = new Set(tabs)
  const remaining = backend.filter((p) => !seen.has(p))
  return [...tabs, ...rankBackend(query, remaining, of)]
}

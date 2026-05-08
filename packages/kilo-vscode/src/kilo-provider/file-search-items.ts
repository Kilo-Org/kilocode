export type FileSearchItem = { path: string; type: "file" | "folder" | "opened-file" }

const normalize = (p: string) => p.replaceAll("\\", "/")
const trim = (p: string) => normalize(p).replace(/\/+$/, "")

function base(p: string): string {
  const clean = trim(p)
  return clean.split("/").pop() ?? clean
}

function rank(query: string, p: string): number {
  const clean = trim(p).toLowerCase()
  const name = base(p).toLowerCase()
  if (clean === query || name === query) return 0
  if (name.startsWith(query) || (query.includes("/") && clean.startsWith(query))) return 1
  if (name.includes(query)) return 2
  if (clean.includes(query)) return 3
  return 4
}

export function mergeFileSearchItems(input: {
  query: string
  files: string[]
  folders: string[]
  open?: Set<string>
}): FileSearchItem[] {
  const query = normalize(input.query).trim().toLowerCase()
  const open = new Set([...(input.open ?? [])].map(normalize))
  const files = input.files.map((p) => {
    const path = normalize(p)
    return { path, type: open.has(path) ? ("opened-file" as const) : ("file" as const) }
  })
  const pinned = files.filter((item) => item.type === "opened-file")
  const rest = files.filter((item) => !open.has(item.path))
  // Dedup folders against themselves; a file and a folder that share a stem are distinct entries.
  const seen = new Set<string>()
  const folders = input.folders
    .filter((p) => {
      const key = trim(p)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((p, index) => ({
      item: { path: normalize(p), type: "folder" as const },
      index,
      rank: query ? rank(query, p) : 4,
    }))

  if (!query) return [...files, ...folders.map((x) => x.item)]

  const sorted = [...folders].sort((a, b) => a.rank - b.rank || a.index - b.index)
  const boosted = sorted.filter((x) => x.rank <= 1).map((x) => x.item)
  const other = sorted.filter((x) => x.rank > 1).map((x) => x.item)
  return [...pinned, ...boosted, ...rest, ...other]
}

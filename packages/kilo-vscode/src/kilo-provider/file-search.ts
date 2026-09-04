import * as path from "path"
import * as vscode from "vscode"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import { mergeFileSearchResults } from "./file-search-results"
import { mergeFileSearchItems, type FileSearchItem } from "./file-search-items"

/**
 * Bounds on the merged multi-root result, applied after ranking so the best
 * matches survive. Not applied to single-root workspaces, which keep the
 * backend's own limits untouched.
 */
const MULTI_FILE_LIMIT = 100
const MULTI_FOLDER_LIMIT = 50

/**
 * How many folders beyond the session's own project a single query may search.
 *
 * Each one costs its own file index and watcher in the backend, kept for an
 * hour, so an unusually large workspace must not grow that cost without bound.
 */
const MAX_EXTRA_ROOTS = 4

/** A folder open in the editor workspace, as a candidate mention source. */
export type SearchRoot = { path: string; name: string }

type Message = {
  query: string
  requestId: string
  sessionID?: string
}

type Input = {
  client: KiloClient | null
  message: Message
  current?: string
  context?: string
  dir: (id?: string) => string
  open: (dir: string) => Promise<Set<string>>
  post: (message: unknown) => void
  /**
   * Every folder in the editor workspace. Fan-out only happens when the
   * session's own directory is one of them, so worktree and Agent Manager
   * sessions stay scoped to their own tree.
   */
  roots?: () => readonly SearchRoot[]
}

const slash = (value: string) => value.replaceAll("\\", "/")

function same(a: string, b: string): boolean {
  if (!a || !b) return false
  return path.relative(a, b) === ""
}

/**
 * Split the workspace folders into the session's own project and the rest.
 *
 * `secondary` is empty unless `dir` is itself one of the workspace folders. A
 * session routed to a git worktree or an Agent Manager project has a directory
 * outside the folder list, and silently widening its search to unrelated
 * projects would be wrong.
 */
export function splitRoots(
  roots: readonly SearchRoot[],
  dir: string,
): { primary?: SearchRoot; secondary: SearchRoot[] } {
  const primary = roots.find((root) => same(root.path, dir))
  if (!primary) return { secondary: [] }
  return { primary, secondary: roots.filter((root) => root.path && !same(root.path, dir)) }
}

async function fetchBackend(client: KiloClient, dir: string, query: string): Promise<[string[], string[]]> {
  if (!client?.find?.files) return [[], []]
  const [fileRes, folderRes] = await Promise.allSettled([
    client.find.files({ query, directory: dir, type: "file", limit: 50 }, { throwOnError: true }),
    client.find.files({ query, directory: dir, type: "directory", limit: 50 }, { throwOnError: true }),
  ])
  return [settled(fileRes, "file"), settled(folderRes, "folder")]
}

/** Path of the active editor relative to `dir`, or undefined when it lives elsewhere. */
function activeIn(dir: string): string | undefined {
  const uri = vscode.window.activeTextEditor?.document.uri
  if (uri?.scheme !== "file" || !dir) return undefined
  const rel = path.relative(dir, uri.fsPath)
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return undefined
  return slash(rel)
}

type Gathered = {
  files: string[]
  folders: string[]
  open: Set<string>
  active?: string
  /** Inserted path to its root-relative form, so ranking is not skewed by the filesystem prefix. */
  relative: Map<string, string>
}

const EMPTY: Gathered = { files: [], folders: [], open: new Set(), relative: new Map() }

/**
 * Collect one root's candidates, without ranking them.
 *
 * Ranking is deliberately left to the caller: scoring each root separately and
 * concatenating would let fuzzy noise in the first root outrank an exact
 * filename match in another.
 *
 * Primary-root paths stay relative, preserving today's attachment behavior.
 * Secondary-root paths are made absolute: that is what makes them insertable as
 * mentions while `buildFileAttachments` still refuses to auto-read them, which
 * is the same boundary the "Browse files..." picker relies on. Their relative
 * form is kept alongside so ranking still judges them on the same basis.
 *
 * A root that cannot be read yields nothing rather than throwing. Extra folders
 * are arbitrary user-chosen directories, and one unreadable `.kilocodeignore`
 * must not empty the whole mention list.
 */
async function gather(
  client: KiloClient,
  root: string,
  query: string,
  open: (dir: string) => Promise<Set<string>>,
  absolute: boolean,
): Promise<Gathered> {
  if (!root) return EMPTY
  try {
    const [files, folders] = await fetchBackend(client, root, query)
    const tabs = await open(root)
    const active = activeIn(root)
    if (!absolute) {
      return { files: files.map(slash), folders: folders.map(slash), open: tabs, active, relative: new Map() }
    }
    const relative = new Map<string, string>()
    const abs = (value: string) => {
      const rel = slash(value)
      const full = slash(path.resolve(root, value))
      relative.set(full, rel)
      return full
    }
    return {
      files: files.map(abs),
      folders: folders.map(abs),
      open: new Set([...tabs].map(abs)),
      active: active ? abs(active) : undefined,
      relative,
    }
  } catch (err) {
    console.error(`[Kilo New] File search failed for ${root}:`, err)
    return EMPTY
  }
}

export async function handleFileSearch(input: Input): Promise<void> {
  const client = input.client
  if (!client) {
    input.post({ type: "fileSearchResult", paths: [], items: [], dir: "", requestId: input.message.requestId })
    return
  }

  const id = input.message.sessionID ?? input.current ?? input.context
  const dir = input.dir(id)
  const query = input.message.query
  // A root list that throws must not take the mention dropdown down with it;
  // fall back to searching the session's own directory alone.
  const split = (() => {
    try {
      return splitRoots(input.roots?.() ?? [], dir)
    } catch (err) {
      console.error("[Kilo New] Failed to read workspace folders:", err)
      return { secondary: [] as SearchRoot[] }
    }
  })()
  // A bare `@` searches the session's own project only. Every other workspace
  // folder costs a file index the backend then holds for an hour, and opening
  // the menu without searching is not a reason to build them — the same reason
  // past chats are fetched on the first character rather than on every `@`.
  const extras = query.trim() ? split.secondary.slice(0, MAX_EXTRA_ROOTS) : []
  const multi = extras.length > 0
  // Badges follow the shape of the workspace, not what this particular query
  // happened to search, so rows do not sprout a badge on the first keystroke.
  const labelled = split.secondary.length > 0

  const [primary, secondary] = await Promise.all([
    gather(client, dir, query, input.open, false),
    Promise.all(extras.map((root) => gather(client, root.path, query, input.open, true))),
  ])

  // In a multi-root workspace every entry is labelled, including the session's
  // own project: labelling only the added folders leaves the unlabelled ones
  // looking like they belong to no folder at all. Priority is the workspace
  // folder order, and only breaks ties between equally good matches.
  const labels = new Map<string, string>()
  const priority = new Map<string, number>()
  const relative = new Map<string, string>()
  const groups: Array<{ hits: Gathered; root?: SearchRoot }> = [
    { hits: primary, root: split.primary },
    ...secondary.map((hits, index) => ({ hits, root: extras[index] })),
  ]
  groups.forEach((group, index) => {
    for (const [full, rel] of group.hits.relative) relative.set(full, rel)
    for (const value of [...group.hits.files, ...group.hits.folders, ...group.hits.open]) {
      if (!priority.has(value)) priority.set(value, index)
      if (labelled && group.root && !labels.has(value)) labels.set(value, group.root.name)
    }
  })

  const opened = new Set(groups.flatMap((group) => [...group.hits.open]))
  for (const group of groups) {
    if (group.hits.active) opened.add(group.hits.active)
  }

  const ranked = mergeFileSearchResults({
    query,
    backend: groups.flatMap((group) => group.hits.files),
    open: opened,
    active: groups.find((group) => group.hits.active)?.hits.active,
    priority,
    relative,
  })
  const paths = multi ? ranked.slice(0, MULTI_FILE_LIMIT) : ranked
  // Folders need no priority map: mergeFileSearchItems sorts them by match rank
  // and breaks ties on input order, which is already workspace-folder order.
  const merged = mergeFileSearchItems({
    query,
    files: paths,
    folders: groups.flatMap((group) => group.hits.folders),
    open: opened,
    labels,
    relative,
  })
  // Cap folders only after ranking. Slicing the input would hand the whole
  // allowance to the first root, dropping every added folder before its
  // entries ever competed.
  const items = multi ? capFolders(merged, MULTI_FOLDER_LIMIT) : merged

  input.post({ type: "fileSearchResult", paths, items, dir, requestId: input.message.requestId })
}

/** Keep the best `limit` folder entries, leaving files and their order untouched. */
function capFolders(items: FileSearchItem[], limit: number): FileSearchItem[] {
  const kept: FileSearchItem[] = []
  let folders = 0
  for (const item of items) {
    if (item.type === "folder") {
      if (folders >= limit) continue
      folders++
    }
    kept.push(item)
  }
  return kept
}

function settled(result: PromiseSettledResult<{ data: string[] }>, kind: "file" | "folder"): string[] {
  if (result.status === "fulfilled") return result.value.data
  console.error(`[Kilo New] File search (${kind}) failed:`, result.reason)
  return []
}

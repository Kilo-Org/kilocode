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

/** Upper bound on files taken from any one added folder for a single query. */
const EXTERNAL_LIMIT = 200

/** Characters VS Code would read as glob syntax rather than as part of a name. */
const GLOB_SYNTAX = /[*?{}[\]]/g

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
  /** Narrow a folder's files to those its own ignore rules permit. */
  allowed?: (dir: string, files: string[]) => Promise<string[]>
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
 * Collect the session's own project, without ranking it.
 *
 * Ranking is deliberately left to the caller: scoring each root separately and
 * concatenating would let fuzzy noise in one root outrank an exact filename
 * match in another.
 *
 * A root that cannot be read yields nothing rather than throwing, so one
 * unreadable `.kilocodeignore` cannot empty the whole mention list.
 */
async function gather(
  client: KiloClient,
  root: string,
  query: string,
  open: (dir: string) => Promise<Set<string>>,
): Promise<Gathered> {
  if (!root) return EMPTY
  try {
    const [files, folders] = await fetchBackend(client, root, query)
    return {
      files: files.map(slash),
      folders: folders.map(slash),
      open: await open(root),
      active: activeIn(root),
      relative: new Map(),
    }
  } catch (err) {
    console.error(`[Kilo New] File search failed for ${root}:`, err)
    return EMPTY
  }
}

/**
 * Collect candidates from a folder the session does not belong to, using the
 * editor's own file index.
 *
 * Deliberately not the backend's `find.files`. Naming a directory there routes
 * the request through the instance middleware, which boots a full instance for
 * it: project detection, config load, and `plugin.init()` — so merely typing
 * would load an unrelated repo's config and run the plugins it declares. That
 * instance entry has no expiry, and the location stack behind it adds a native
 * file index and a filesystem watcher per directory. Adding a folder to the
 * workspace must not buy any of that.
 *
 * `findFiles` already has an index for every workspace folder, honours
 * `files.exclude` and `search.exclude`, spawns nothing, and never reaches the
 * backend. Results feed the same ranking and merge path as the primary root.
 *
 * Paths come back absolute, which is what makes them insertable as mentions
 * while `buildFileAttachments` still refuses to auto-read them — the same
 * boundary the "Browse files..." picker relies on. The relative form is kept
 * alongside so ranking judges them on the same basis as the primary root.
 */
async function gatherExternal(
  root: SearchRoot,
  query: string,
  open: (dir: string) => Promise<Set<string>>,
  allowed?: (dir: string, files: string[]) => Promise<string[]>,
): Promise<Gathered> {
  // A glob needs something literal to match on, so metacharacters are dropped
  // rather than escaped; the ranking below still judges the real query.
  const needle = query.replace(GLOB_SYNTAX, "").trim()
  if (!needle) return EMPTY
  try {
    const folder = vscode.workspace.workspaceFolders?.find((entry) => same(entry.uri.fsPath, root.path))
    if (!folder) return EMPTY
    const find = (pattern: string) =>
      vscode.workspace.findFiles(new vscode.RelativePattern(folder, pattern), undefined, EXTERNAL_LIMIT)
    // A glob's `*` spans one path segment, so interleaving them asks for the
    // query's characters in order within a single segment — the subsequence
    // shape fuzzysort matches on, and a superset of the plain substring form.
    // Both run because the limit truncates before anything is ranked, and a
    // literal hit must not be crowded out by looser ones.
    const loose = [...needle].join("*")
    const [literal, subsequence] = await Promise.all([
      find(`**/*${needle}*`),
      loose === needle ? Promise.resolve([]) : find(`**/*${loose}*`),
    ])
    const found = [...literal, ...subsequence]

    const relative = new Map<string, string>()
    const files: string[] = []
    const folders = new Set<string>()
    const lower = needle.toLowerCase()
    const record = (rel: string) => {
      const full = slash(path.resolve(root.path, rel))
      relative.set(full, rel)
      return full
    }
    const seen = new Set<string>()
    for (const uri of found) {
      const rel = slash(path.relative(root.path, uri.fsPath))
      if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) continue
      if (seen.has(rel)) continue
      seen.add(rel)
      files.push(record(rel))
      // The glob matches on the whole path, so a hit may be owed to a directory
      // name. Offer those directories too, as the backend does from its walk.
      const parts = rel.split("/")
      parts.slice(0, -1).forEach((part, index) => {
        if (part.toLowerCase().includes(lower)) folders.add(record(parts.slice(0, index + 1).join("/")))
      })
    }

    // findFiles honours files.exclude, search.exclude and .gitignore, but knows
    // nothing of .kilocodeignore. Apply it here so a folder the user has told
    // Kilo to leave alone stays out of the mention list too.
    const kept = allowed ? new Set(await allowed(root.path, files)) : undefined
    const active = activeIn(root.path)
    return {
      files: kept ? files.filter((file) => kept.has(file)) : files,
      folders: [...folders],
      open: new Set([...(await open(root.path))].map(record)),
      active: active ? record(active) : undefined,
      relative,
    }
  } catch (err) {
    console.error(`[Kilo New] File search failed for ${root.path}:`, err)
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
  // A bare `@` searches the session's own project only. The other folders are
  // searched by glob, which needs something literal to match on, and listing a
  // whole added repo is not what an unqualified `@` is asking for. Past chats
  // are fetched on the first character for the same reason.
  const extras = query.trim() ? split.secondary : []
  const multi = extras.length > 0
  // Badges follow the shape of the workspace, not what this particular query
  // happened to search, so rows do not sprout a badge on the first keystroke.
  const labelled = split.secondary.length > 0

  const [primary, secondary] = await Promise.all([
    gather(client, dir, query, input.open),
    Promise.all(extras.map((root) => gatherExternal(root, query, input.open, input.allowed))),
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

import * as path from "path"
import * as vscode from "vscode"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import { mergeFileSearchResults } from "./file-search-results"
import { mergeFileSearchItems } from "./file-search-items"

/**
 * Bounds on the merged multi-root result, applied after ranking so the best
 * matches survive. Not applied to single-root workspaces, which keep the
 * backend's own limits untouched.
 */
const MULTI_FILE_LIMIT = 100
const MULTI_FOLDER_LIMIT = 50

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

type Gathered = { files: string[]; folders: string[]; open: Set<string>; active?: string }

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
 * is the same boundary the "Browse files..." picker relies on.
 */
async function gather(
  client: KiloClient,
  root: string,
  query: string,
  open: (dir: string) => Promise<Set<string>>,
  absolute: boolean,
): Promise<Gathered> {
  if (!root) return { files: [], folders: [], open: new Set() }
  const [files, folders] = await fetchBackend(client, root, query)
  const tabs = await open(root)
  const active = activeIn(root)
  if (!absolute) return { files: files.map(slash), folders: folders.map(slash), open: tabs, active }
  const abs = (value: string) => slash(path.resolve(root, value))
  return {
    files: files.map(abs),
    folders: folders.map(abs),
    open: new Set([...tabs].map(abs)),
    active: active ? abs(active) : undefined,
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
  const split = splitRoots(input.roots?.() ?? [], dir)
  const extras = split.secondary
  const multi = extras.length > 0

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
  const groups: Array<{ hits: Gathered; root?: SearchRoot }> = [
    { hits: primary, root: split.primary },
    ...secondary.map((hits, index) => ({ hits, root: extras[index] })),
  ]
  groups.forEach((group, index) => {
    for (const value of [...group.hits.files, ...group.hits.folders, ...group.hits.open]) {
      if (!priority.has(value)) priority.set(value, index)
      if (multi && group.root && !labels.has(value)) labels.set(value, group.root.name)
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
  })
  const folders = groups.flatMap((group) => group.hits.folders)
  const paths = multi ? ranked.slice(0, MULTI_FILE_LIMIT) : ranked
  // Folders need no priority map: mergeFileSearchItems sorts them by match rank
  // and breaks ties on input order, which is already workspace-folder order.
  const items = mergeFileSearchItems({
    query,
    files: paths,
    folders: multi ? folders.slice(0, MULTI_FOLDER_LIMIT) : folders,
    open: opened,
    labels,
  })

  input.post({ type: "fileSearchResult", paths, items, dir, requestId: input.message.requestId })
}

function settled(result: PromiseSettledResult<{ data: string[] }>, kind: "file" | "folder"): string[] {
  if (result.status === "fulfilled") return result.value.data
  console.error(`[Kilo New] File search (${kind}) failed:`, result.reason)
  return []
}

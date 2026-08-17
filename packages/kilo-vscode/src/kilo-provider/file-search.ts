import * as path from "path"
import * as vscode from "vscode"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import { mergeFileSearchResults } from "./file-search-results"
import { mergeFileSearchItems, type FileSearchItem } from "./file-search-items"

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
}

type Cache = {
  files: string[]
  folders: string[]
  updated: number
}

const cache = new Map<string, Cache>()

export function prewarmFileSearch(client: KiloClient | null, dir: string): void {
  if (!client || !dir) return
  void fetchBackend(client, dir, "").then(([files, folders]) => {
    if (files.length || folders.length) {
      cache.set(dir, { files, folders, updated: Date.now() })
    }
  })
}

async function fetchBackend(client: KiloClient, dir: string, query: string): Promise<[string[], string[]]> {
  if (!client?.find?.files) return [[], []]
  const [fileRes, folderRes] = await Promise.allSettled([
    client.find.files({ query, directory: dir, type: "file", limit: 50 }, { throwOnError: true }),
    client.find.files({ query, directory: dir, type: "directory", limit: 50 }, { throwOnError: true }),
  ])
  return [settled(fileRes, "file"), settled(folderRes, "folder")]
}

function assemble(
  query: string,
  dir: string,
  files: string[],
  folders: string[],
  open: Set<string>,
): { paths: string[]; items: FileSearchItem[] } {
  const uri = vscode.window.activeTextEditor?.document.uri
  const rel = uri?.scheme === "file" && dir ? path.relative(dir, uri.fsPath) : undefined
  const active = rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel.replaceAll("\\", "/") : undefined
  const paths = mergeFileSearchResults({ query, backend: files, open, active })
  const items = mergeFileSearchItems({
    query,
    files: paths,
    folders,
    open: new Set(active ? [active, ...open] : open),
  })
  return { paths, items }
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
  const entry = !query && dir ? cache.get(dir) : undefined

  if (entry) {
    const open = await input.open(dir)
    const { paths, items } = assemble(query, dir, entry.files, entry.folders, open)
    input.post({ type: "fileSearchResult", paths, items, dir, requestId: input.message.requestId })
  }

  void fetchBackend(client, dir, query).then(async ([files, folders]) => {
    if (!query && dir && (files.length || folders.length)) {
      cache.set(dir, { files, folders, updated: Date.now() })
    }
    const open = dir ? await input.open(dir) : new Set<string>()
    const { paths, items } = assemble(query, dir, files, folders, open)
    input.post({ type: "fileSearchResult", paths, items, dir, requestId: input.message.requestId })
  })
}

function settled(result: PromiseSettledResult<{ data: string[] }>, kind: "file" | "folder"): string[] {
  if (result.status === "fulfilled") return result.value.data
  console.error(`[Kilo New] File search (${kind}) failed:`, result.reason)
  return []
}

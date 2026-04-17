import * as path from "path"
import * as vscode from "vscode"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import { mergeFileSearchResults } from "../kilo-provider-utils"
import { mergeFileSearchItems } from "./file-search-items"

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

export async function handleFileSearch(input: Input): Promise<void> {
  const client = input.client
  if (!client) {
    input.post({ type: "fileSearchResult", paths: [], items: [], dir: "", requestId: input.message.requestId })
    return
  }

  const id = input.message.sessionID ?? input.current ?? input.context
  const dir = input.dir(id)
  const open = dir ? await input.open(dir) : new Set<string>()

  const query = input.message.query
  void Promise.allSettled([
    client.find.files({ query, directory: dir, type: "file", limit: 50 }, { throwOnError: true }),
    client.find.files({ query, directory: dir, type: "directory", limit: 50 }, { throwOnError: true }),
  ]).then(([fileRes, folderRes]) => {
    const files = settled(fileRes, "file")
    const folders = settled(folderRes, "folder")
    const uri = vscode.window.activeTextEditor?.document.uri
    const rel = uri?.scheme === "file" && dir ? path.relative(dir, uri.fsPath) : undefined
    const active = rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel.replaceAll("\\", "/") : undefined
    const result = mergeFileSearchResults({ query, backend: files, open, active })
    const items = mergeFileSearchItems({ query, files: result, folders })
    input.post({ type: "fileSearchResult", paths: result, items, dir, requestId: input.message.requestId })
  })
}

function settled(result: PromiseSettledResult<{ data: string[] }>, kind: "file" | "folder"): string[] {
  if (result.status === "fulfilled") return result.value.data
  console.error(`[Kilo New] File search (${kind}) failed:`, result.reason)
  return []
}

import * as path from "path"
import * as vscode from "vscode"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import { mergeFileSearchItems, mergeFileSearchResults } from "../kilo-provider-utils"

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

  void Promise.all([
    client.find.files({ query: input.message.query, directory: dir, type: "file", limit: 50 }, { throwOnError: true }),
    client.find.files(
      { query: input.message.query, directory: dir, type: "directory", limit: 50 },
      { throwOnError: true },
    ),
  ])
    .then(([files, folders]) => {
      const uri = vscode.window.activeTextEditor?.document.uri
      const rel = uri?.scheme === "file" && dir ? path.relative(dir, uri.fsPath) : undefined
      const active = rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel.replaceAll("\\", "/") : undefined
      const result = mergeFileSearchResults({ query: input.message.query, backend: files.data, open, active })
      const items = mergeFileSearchItems({ query: input.message.query, files: result, folders: folders.data })
      input.post({ type: "fileSearchResult", paths: result, items, dir, requestId: input.message.requestId })
    })
    .catch((error: unknown) => {
      console.error("[Kilo New] File search failed:", error)
      input.post({ type: "fileSearchResult", paths: [], items: [], dir, requestId: input.message.requestId })
    })
}

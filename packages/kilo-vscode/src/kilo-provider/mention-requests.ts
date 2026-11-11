// The host side of the composer's `@` mentions. File search merges the server's ranked find with the editor's open
// tabs and workspace folders, the past chats come from the server's session list, and the terminal output, git
// changes and file picker are editor or git state the webview cannot read.
import path from "node:path"
import { OpenCode, type OpenCodeClient } from "@opencode/client"
import { TabInputNotebook, TabInputText, window, workspace } from "vscode"
import { getErrorMessage } from "../agent-manager/errors"
import { local } from "../local"
import type { Mention, ToHost, ToWebview } from "../protocol"
import type { Manager } from "../server"
import { FileIgnoreController } from "../services/autocomplete/shims/FileIgnoreController"
import { getTerminalContents } from "../services/terminal/context"
import { handleFilePicker } from "./file-picker"
import { handleFileSearch, type SearchRoot } from "./file-search"
import { handleGitChangesRequest } from "./git-changes-request"
import { handleSessionSearch } from "./session-search"

/** Ignore controllers kept per directory: multi-root search asks about several roots per keystroke. */
const IGNORE_LIMIT = 16

export function isMentionRequest(message: ToHost): message is Mention {
  return (
    message.type === "requestFileSearch" ||
    message.type === "requestSessionSearch" ||
    message.type === "requestFilePicker" ||
    message.type === "requestTerminalContext" ||
    message.type === "requestGitChangesContext"
  )
}

export function createMentionHost(input: { server: Manager; directory: string; post: (message: ToWebview) => void }) {
  let connection: { url: string; api: OpenCodeClient } | undefined
  const client = async () => {
    const server = await input.server.get()
    if (connection?.url === server.url) return connection.api
    const api = OpenCode.make({ baseUrl: server.url, headers: { authorization: server.authorization }, fetch: local })
    connection = { url: server.url, api }
    return api
  }
  // A server that cannot start answers every search with no results instead of leaving the menu waiting.
  const connected = () =>
    client().catch((err: unknown) => {
      console.error("[Kilo] Mention search failed:", err)
      return null
    })

  // A failed read of the ignore rules is evicted rather than cached, so the next lookup reads them again.
  const ignores = new Map<string, Promise<FileIgnoreController>>()
  const controller = (dir: string) => {
    const cached = ignores.get(dir)
    if (cached) return cached
    const pending = (async () => {
      const value = new FileIgnoreController(dir)
      await value.initialize()
      return value
    })()
    void pending.catch(() => {
      if (ignores.get(dir) === pending) ignores.delete(dir)
    })
    ignores.set(dir, pending)
    while (ignores.size > IGNORE_LIMIT) {
      const oldest = ignores.keys().next().value
      if (oldest === undefined || oldest === dir) break
      ignores.delete(oldest)
    }
    return pending
  }

  // Text and notebook tabs of `dir`, relative to it, that its ignore rules permit.
  const open = async (dir: string) => {
    const rules = await controller(dir).catch(() => undefined)
    const result = new Set<string>()
    for (const group of window.tabGroups.all) {
      for (const tab of group.tabs) {
        const uri =
          tab.input instanceof TabInputText || tab.input instanceof TabInputNotebook ? tab.input.uri : undefined
        if (uri?.scheme !== "file") continue
        const rel = path.relative(dir, uri.fsPath)
        if (rel.startsWith("..") || path.isAbsolute(rel)) continue
        if (rules && !rules.validateAccess(uri.fsPath)) continue
        result.add(rel.replaceAll("\\", "/"))
      }
    }
    return result
  }

  // Every folder of the editor workspace. Search fans out across them only when the session's directory is one.
  const roots = (): SearchRoot[] =>
    (workspace.workspaceFolders ?? []).map((folder) => ({ path: folder.uri.fsPath, name: folder.name }))

  // A relevance filter, not a permission boundary: rules that cannot be read let the files through.
  const allowed = async (dir: string, files: string[]) => {
    if (!dir || !files.length) return files
    const rules = await controller(dir).catch((err: unknown) => {
      console.warn("[Kilo] Failed to read ignore rules for", dir, err)
      return undefined
    })
    if (!rules) return files
    return files.filter((file) => rules.validateAccess(file))
  }

  const terminal = async (requestId: string) => {
    try {
      const output = await getTerminalContents(-1)
      input.post({ type: "terminalContextResult", requestId, content: output.content, truncated: output.truncated })
    } catch (error) {
      console.error("[Kilo] Failed to capture terminal context:", error)
      input.post({
        type: "terminalContextError",
        requestId,
        error: getErrorMessage(error) || "Failed to capture terminal output",
      })
    }
  }

  const handle = (message: Mention) => {
    switch (message.type) {
      case "requestFileSearch":
        return void connected().then((api) =>
          handleFileSearch({
            client: api,
            message,
            directory: input.directory,
            open,
            roots,
            allowed,
            post: input.post,
          }),
        )
      case "requestSessionSearch":
        return void connected().then((api) =>
          handleSessionSearch({ client: api, message, directory: input.directory, post: input.post }),
        )
      case "requestFilePicker":
        return void handleFilePicker({ requestId: message.requestId, post: input.post })
      case "requestTerminalContext":
        return void terminal(message.requestId)
      case "requestGitChangesContext":
        return void handleGitChangesRequest(message, {
          directory: input.directory,
          post: input.post,
          error: getErrorMessage,
        })
    }
  }

  return { handle }
}

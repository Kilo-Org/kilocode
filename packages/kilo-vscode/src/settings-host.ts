// Host side of the Settings panel. The extension host owns the config files: the webview cannot read the global
// config (`api.fs.read` is confined to the location) and `api.config.update` writes only `shell`. The host asks the
// server for the config documents (`api.config.get`), resolves the global and project target files from those
// entries, then reads and writes them with `jsonc-parser` so comments survive.
import { readFile, writeFile, mkdir } from "node:fs/promises"
import path from "node:path"
import { applyEdits, modify } from "jsonc-parser"
import { commands, workspace, Uri, window, type ExtensionContext } from "vscode"
import { KiloConfigFiles } from "@opencode/util/kilocode/config/files"
import { local } from "./local"
import type { ConfigEdit, ConfigScope, ToHost, ToWebview } from "./protocol"
import type { Manager } from "./server"

const NAMESPACE = "kilo-code.v2"

/** The Kilo settings the extension contributes; `kilo-code.v2.<key>` in `package.json`. */
export const KILO_SETTING_KEYS = [
  "fontSize",
  "language",
  "chat.shiftTabCyclesVariant",
  "claudeCodeCompat",
  "extraCaCerts",
] as const

const MODIFY = { formattingOptions: { tabSize: 2, insertSpaces: true, eol: "\n" } }

/** The config values the webview reads at boot; the same shape as `vscodeSettingsLoaded`. */
export function readKiloSettings(): Record<string, unknown> {
  const config = workspace.getConfiguration(NAMESPACE)
  return Object.fromEntries(KILO_SETTING_KEYS.map((key) => [key, config.get(key)]))
}

interface ConfigEntry {
  type: "document" | "directory"
  path?: string
}

export function settingsHost(input: {
  context: ExtensionContext
  server: Manager
  directory: string
  post: (message: ToWebview) => void
}) {
  const listener = workspace.onDidChangeConfiguration((event) => {
    if (KILO_SETTING_KEYS.some((key) => event.affectsConfiguration(`${NAMESPACE}.${key}`)))
      input.post({ type: "vscodeSettingsLoaded", values: readKiloSettings() })
  })

  const entries = async () => {
    const server = await input.server.get()
    const query = new URLSearchParams({ "location[directory]": input.directory })
    const response = await local(new URL(`/api/config?${query}`, server.url), {
      headers: { authorization: server.authorization },
    })
    return (await response.json()) as ConfigEntry[]
  }

  /** The global and project config files, from the server's config documents. */
  const targets = async () => {
    const list = await entries()
    const documents = new Set(
      list.flatMap((entry) => (entry.type === "document" && entry.path ? [entry.path] : [])),
    )
    const globalDir = list
      .flatMap((entry) => (entry.type === "directory" && entry.path ? [entry.path] : []))
      .find((directory) => !KiloConfigFiles.directories.includes(path.basename(directory)))
    if (!globalDir) throw new Error("The server did not report the Kilo global config directory")
    const global =
      KiloConfigFiles.writeCandidates(globalDir, true).find((file) => documents.has(file)) ??
      path.join(globalDir, KiloConfigFiles.newFile)
    const project =
      KiloConfigFiles.writeCandidates(input.directory, false).find((file) => documents.has(file)) ??
      path.join(input.directory, KiloConfigFiles.newFile)
    return { global, project }
  }

  const read = async (file: string) => {
    try {
      return await readFile(file, "utf8")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return ""
      throw error
    }
  }

  const readConfig = async () => {
    try {
      const files = await targets()
      const [global, project] = await Promise.all([read(files.global), read(files.project)])
      input.post({
        type: "configLoaded",
        global: { path: files.global, text: global },
        project: { path: files.project, text: project },
      })
    } catch {
      input.post({
        type: "configLoaded",
        global: { path: "", text: "" },
        project: { path: "", text: "" },
      })
    }
  }

  const writeConfig = async (scope: ConfigScope, edits: ConfigEdit[]) => {
    try {
      const files = await targets()
      const file = files[scope]
      if (!KiloConfigFiles.names.includes(path.basename(file)))
        throw new Error(`Refused a config write outside a Kilo config file: ${file}`)
      const existing = await read(file)
      const base = existing.trim().length > 0 ? existing : "{\n}\n"
      let text = base
      for (const edit of edits) {
        if (!Array.isArray(edit.path) || edit.path.length === 0) continue
        text = applyEdits(text, modify(text, edit.path, edit.value, MODIFY))
        const alias = aliasOf(edit.path)
        if (alias) text = applyEdits(text, modify(text, alias, undefined, MODIFY))
      }
      if (existing.trim().length === 0 && edits.every((edit) => edit.value === undefined)) {
        input.post({ type: "configWritten", ok: true })
        return
      }
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, text)
      input.post({ type: "configWritten", ok: true })
    } catch (error) {
      input.post({ type: "configWritten", ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }

  const updateSettings = async (values: Record<string, unknown>) => {
    const config = workspace.getConfiguration(NAMESPACE)
    for (const [key, value] of Object.entries(values)) {
      if (!(KILO_SETTING_KEYS as readonly string[]).includes(key)) continue
      await config.update(key, value === null ? undefined : value, true)
    }
  }

  const handle = (message: ToHost) => {
    if (message.type === "configRead") {
      void readConfig()
      return true
    }
    if (message.type === "configWrite") {
      void writeConfig(message.scope, message.edits)
      return true
    }
    if (message.type === "requestVSCodeSettings") {
      input.post({ type: "vscodeSettingsLoaded", values: readKiloSettings() })
      return true
    }
    if (message.type === "updateVSCodeSettings") {
      void updateSettings(message.values)
      return true
    }
    if (message.type === "openFile") {
      void workspace.openTextDocument(Uri.file(message.path)).then((document) => window.showTextDocument(document))
      return true
    }
    if (message.type === "openVSCodeSettings") {
      void commands.executeCommand("workbench.action.openSettings", message.query)
      return true
    }
    return false
  }

  return {
    handle,
    dispose() {
      listener.dispose()
    },
  }
}

/**
 * The v1 key that a written v2 path replaces, so both spellings never define the same setting. The v2 file keeps
 * the newer key; the v1 alias is removed in the same write. Mirrors the normalization in `core/config/normalize.ts`.
 */
export function aliasOf(path: string[]): string[] | undefined {
  if (path.length === 0) return undefined
  if (path[0] === "agents") {
    if (path.length === 3 && path[1] === "title" && path[2] === "model") return ["small_model"]
    const tail = path.slice(2)
    if (tail.length === 1 && tail[0] === "system") return ["agent", path[1]!, "prompt"]
    if (tail.length === 1 && tail[0] === "disabled") return ["agent", path[1]!, "disable"]
    return ["agent", ...path.slice(1)]
  }
  if (path[0] === "mcp" && path[1] === "servers" && path.length >= 3) return ["mcp", ...path.slice(2)]
  const top: Record<string, string> = {
    permissions: "permission",
    commands: "command",
    providers: "provider",
    snapshots: "snapshot",
  }
  const mapped = top[path[0]!]
  return mapped ? [mapped, ...path.slice(1)] : undefined
}

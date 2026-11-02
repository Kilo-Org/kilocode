// Host side of the Settings panel. The extension host owns the config files: the webview cannot read the global
// config (`api.fs.read` is confined to the location) and `api.config.update` writes only `shell`. The host asks the
// server for the config documents (`api.config.get`), resolves the global and project target files from those
// entries, then reads and writes them with `jsonc-parser` so comments survive.
import { existsSync } from "node:fs"
import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { commands, workspace, Uri, window, type ExtensionContext } from "vscode"
import { KiloConfigFiles } from "@opencode/util/kilocode/config/files"
import { applyConfigEdits, isKiloConfigFile, serialize } from "./config-file-edit"
import { local } from "./local"
import { resolveGlobalConfigDir, canonicalPath, matchConfigDocument } from "./settings-paths"
import type { ConfigEdit, ConfigScope, ToHost, ToWebview } from "./protocol"
import type { Manager } from "./server"

const NAMESPACE = "kilo-code.v2"

/** The Kilo settings the extension contributes; `kilo-code.v2.<key>` in `package.json`. */
export const KILO_SETTING_KEYS = [
  "fontSize",
  "language",
  "chat.shiftTabCyclesVariant",
  "maxCost",
  "claudeCodeCompat",
  "extraCaCerts",
] as const

/** `kilo-code.v2.fontSize` when set, otherwise `editor.fontSize`, clamped to the v1 slider range. */
export function effectiveFontSize(): number {
  const configured = workspace.getConfiguration(NAMESPACE).get<number>("fontSize")
  const raw = typeof configured === "number" ? configured : workspace.getConfiguration("editor").get<number>("fontSize", 13)
  return Number.isFinite(raw) ? Math.min(24, Math.max(10, Math.round(raw))) : 13
}

/** The config values the webview reads at boot; the same shape as `vscodeSettingsLoaded`. */
export function readKiloSettings(): Record<string, unknown> {
  const config = workspace.getConfiguration(NAMESPACE)
  return {
    ...Object.fromEntries(KILO_SETTING_KEYS.map((key) => [key, config.get(key)])),
    // The host's current fallback, so a tab keeps the right size when the setting is unset.
    effectiveFontSize: effectiveFontSize(),
  }
}

/** webview globalState keys that are not configuration, cleared by Reset All Settings. */
const GLOBAL_STATE_KEYS = ["kilo-code.v2.modelSelectorExpanded", "kilo-code.v2.autoApprove"]

interface ConfigEntry {
  type: "document" | "directory"
  path?: string
}

export function settingsHost(input: {
  context: ExtensionContext
  server: Manager
  directory: string
  post: (message: ToWebview) => void
  onReset?: () => void
}) {
  // The dev entry (`script/dev-isolated.ts`) keeps everything under `KILO_V2_PROFILE`, and `server.ts` defaults that
  // to the extension storage. A bundled server inherits the host environment and uses XDG paths directly.
  const bundled = existsSync(
    path.join(input.context.extensionPath, "bin", process.platform === "win32" ? "kilo2.exe" : "kilo2"),
  )
  const profile = bundled
    ? ""
    : (process.env.KILO_V2_PROFILE ?? path.join(input.context.globalStorageUri.fsPath, "profile"))

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
    const documents = new Map<string, string>()
    const directories: string[] = []
    for (const entry of list) {
      if (!entry.path) continue
      const real = await canonicalPath(entry.path)
      if (entry.type === "document") documents.set(real, entry.path)
      else directories.push(real)
    }

    // The project target never depends on the global directory. A missing global directory entry (the directory does
    // not exist yet) falls back to the same path the spawned server uses, and `writeConfig` creates it.
    const projectRoot = await canonicalPath(input.directory)
    const project =
      (await matchConfigDocument(KiloConfigFiles.writeCandidates(projectRoot, false), documents)) ??
      path.join(projectRoot, KiloConfigFiles.newFile)
    const globalDir = await canonicalPath(
      directories.find((directory) => !KiloConfigFiles.directories.includes(path.basename(directory))) ??
        resolveGlobalConfigDir(process.env, profile),
    )
    const global =
      (await matchConfigDocument(KiloConfigFiles.writeCandidates(globalDir, true), documents)) ??
      path.join(globalDir, KiloConfigFiles.newFile)
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
    } catch (error) {
      input.post({
        type: "configLoaded",
        global: { path: "", text: "" },
        project: { path: "", text: "" },
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // Immediate writes can overlap, and two overlapping read-modify-write passes over the same file would drop one
  // edit. Run every write through one chain so each reads the text the previous one wrote.
  const enqueue = serialize()

  const writeConfig = (id: number, scope: ConfigScope, edits: ConfigEdit[]) => {
    void enqueue(async () => {
      try {
        const files = await targets()
        const file = await canonicalPath(files[scope])
        if (!isKiloConfigFile(file)) throw new Error(`Refused a config write outside a Kilo config file: ${file}`)
        const existing = await read(file)
        if (existing.trim().length === 0 && edits.every((edit) => edit.value === undefined)) {
          input.post({ type: "configWritten", id, ok: true })
          return
        }
        await mkdir(path.dirname(file), { recursive: true })
        await writeFile(file, applyConfigEdits(existing, edits))
        input.post({ type: "configWritten", id, ok: true })
      } catch (error) {
        input.post({
          type: "configWritten",
          id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })
  }

  const updateSettings = async (values: Record<string, unknown>) => {
    const config = workspace.getConfiguration(NAMESPACE)
    for (const [key, value] of Object.entries(values)) {
      if (!(KILO_SETTING_KEYS as readonly string[]).includes(key)) continue
      await config.update(key, value === null ? undefined : value, true)
    }
  }

  const resetAllSettings = async () => {
    const confirmed = await window.showWarningMessage(
      "Reset all Kilo Code extension settings to defaults?",
      { modal: true },
      "Reset",
    )
    if (confirmed !== "Reset") return
    const config = workspace.getConfiguration(NAMESPACE)
    for (const key of KILO_SETTING_KEYS) await config.update(key, undefined, true)
    for (const key of GLOBAL_STATE_KEYS) await input.context.globalState.update(key, undefined)
    input.onReset?.()
    input.post({ type: "vscodeSettingsLoaded", values: readKiloSettings() })
    void window.showInformationMessage("Kilo Code settings have been reset to defaults.")
  }

  /** Open a config file in the editor, creating it first when the target does not exist yet. */
  const openConfigFile = async (file: string) => {
    try {
      if (isKiloConfigFile(file) && !(await stat(file).catch(() => undefined))) {
        await mkdir(path.dirname(file), { recursive: true })
        await writeFile(file, "{\n}\n")
      }
      await window.showTextDocument(await workspace.openTextDocument(Uri.file(file)))
    } catch (error) {
      void window.showErrorMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const handle = (message: ToHost) => {
    if (message.type === "configRead") {
      void readConfig()
      return true
    }
    if (message.type === "resetAllSettings") {
      void resetAllSettings()
      return true
    }
    if (message.type === "configWrite") {
      writeConfig(message.id, message.scope, message.edits)
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
      void openConfigFile(message.path)
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

// Host side of the Settings panel. The extension host owns the config files: the webview cannot read the global
// config (`api.fs.read` is confined to the location) and `api.config.update` writes only `shell`. The host asks the
// server for the config documents (`api.config.get`), resolves the global and project target files from those
// entries, then reads and writes them with `jsonc-parser` so comments survive.
import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { commands, workspace, Uri, window, type ExtensionContext } from "vscode"
import { KiloConfigFiles } from "@opencode/util/kilocode/config/files"
import type { SettingsHandler } from "./agent-manager/project/settings"
import { testOSNotification } from "./attention/os"
import { playSound, resolveSoundID, soundDirectory } from "./attention/sound"
import { applyConfigEdits, configWriteQueue, isKiloConfigFile } from "./config-file-edit"
import { configPolicy, type PolicyDocument } from "./config-policy"
import { fetchCustomProviderModels } from "./custom-provider-models"
import { local } from "./local"
import { validAutocompleteSetting } from "./services/autocomplete/settings"
import { candidateConfigFiles, chooseConfigFile, configDirectories } from "./open-config"
import { configTargets, type ConfigEntry } from "./config-targets"
import { resolveKiloProfile, canonicalPath } from "./settings-paths"
import type { Manager } from "./server"
import type { AgentManagerSettings, ConfigEdit, ConfigScope, ToHost, ToWebview } from "./protocol"
import { MODEL_RESET_KEYS } from "./model-preferences"

const NAMESPACE = "kilo-code.v2"

/** The Kilo settings the extension contributes; `kilo-code.v2.<key>` in `package.json`. */
export const KILO_SETTING_KEYS = [
  "fontSize",
  "language",
  "chat.shiftTabCyclesVariant",
  "chat.sendWhileRunning",
  "showTokenThroughput",
  "diff.renderMarkdown",
  "showTaskTimeline",
  "showShortcutHints",
  "showAutoApprovalReason",
  "attention.enabled",
  "attention.notifications",
  "attention.OSNotifications",
  "attention.sound",
  "maxCost",
  "claudeCodeCompat",
  "extraCaCerts",
  "languageCommitMessage",
  "indexing.showButtonWhenDisabled",
  "autocomplete.enableAutoTrigger",
  "autocomplete.enableSmartInlineTaskKeybinding",
  "autocomplete.enableChatAutocomplete",
  "autocomplete.provider",
  "autocomplete.model",
  "agentManager.autoBranchNaming",
  "agentManager.branchPrefix",
  "agentManager.worktreePool",
  "agentManager.pushFixes",
  "integratedBrowser",
  "agentManager.browser.useSystemChrome",
  "agentManager.browser.openLinksIn",
  "browserAutomation.enabled",
  "browserAutomation.useSystemChrome",
  "browserAutomation.headless",
  "experimental.nativeNotebookTools",
  "experimental.conversationPromptHistory",
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

/** Write the `kilo-code.v2.*` settings a webview asked for. Unknown keys are ignored. */
export async function writeKiloSettings(values: Record<string, unknown>) {
  const config = workspace.getConfiguration(NAMESPACE)
  for (const [key, value] of Object.entries(values)) {
    if (!(KILO_SETTING_KEYS as readonly string[]).includes(key)) continue
    if (key.startsWith("autocomplete.") && !validAutocompleteSetting(key.slice("autocomplete.".length), value)) continue
    if (key === "attention.sound" && value !== null && resolveSoundID(value) !== value) continue
    await config.update(key, value === null ? undefined : value, true)
  }
}

/** webview globalState keys that are not configuration, cleared by Reset All Settings. */
// As v1, a reset clears the model recents, usage and remembered efforts, but keeps the favorites.
const GLOBAL_STATE_KEYS = [
  "kilo-code.v2.modelSelectorExpanded",
  "kilo-code.v2.autoApprove",
  "kilo-code.v2.sandbox.newSessionDefault",
  ...MODEL_RESET_KEYS,
]

export function settingsHost(input: {
  context: ExtensionContext
  server: Manager
  directory: string
  post: (message: ToWebview) => void
  onReset?: () => void
  /** The Agent Manager project settings handler, owned by the provider. Absent in views without a provider. */
  agentManager?: () => SettingsHandler | undefined
}) {
  // The dev entry (`script/dev-isolated.ts`) keeps everything under `KILO_V2_PROFILE`, and `server.ts` defaults that
  // to the extension storage. A bundled server inherits the host environment and uses XDG paths directly.
  const profile = resolveKiloProfile(input.context)

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
  const targets = async (found?: ConfigEntry[]) =>
    configTargets({
      entries: found ?? (await entries()),
      directory: input.directory,
      profile,
    })

  /** Offer the existing files of a scope plus its missing target, with the server document list as loaded status. */
  const pickConfigFile = async (scope: ConfigScope, target: string, list: ConfigEntry[]) => {
    const documents: string[] = []
    const directories: string[] = []
    for (const entry of list) {
      if (!entry.path) continue
      const real = await canonicalPath(entry.path)
      if (entry.type === "document") documents.push(real)
      else directories.push(real)
    }
    const candidates = await candidateConfigFiles({
      target,
      directories: configDirectories({
        scope,
        target,
        projectRoot: await canonicalPath(input.directory),
        directories,
        documents,
      }),
      loaded: new Set(documents),
      exists: async (file) => Boolean(await stat(file).catch(() => undefined)),
      resolve: canonicalPath,
    })
    return chooseConfigFile(candidates, async (items) => {
      const picked = await window.showQuickPick(items, {
        title: scope === "global" ? "Open Global Config" : "Open Local Config",
        placeHolder: "Choose a config file",
      })
      return picked ?? undefined
    })
  }

  const read = async (file: string) => {
    try {
      return await readFile(file, "utf8")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return ""
      throw error
    }
  }

  // Kilo-only config fields are not in the upstream config schema, so the config API drops them on encode. Read the
  // documents in priority order, as core does for the effective value, and mark the value managed when the document
  // that sets it is not one of the two writable files. A document that is not readable JSON, such as a managed
  // preference plist, is skipped.
  const policyDocuments = async (list: ConfigEntry[], texts: Map<string, string>) => {
    const documents: PolicyDocument[] = []
    for (const entry of list) {
      if (entry.type !== "document" || !entry.path) continue
      documents.push({ path: entry.path, text: texts.get(entry.path) ?? (await read(entry.path).catch(() => "")) })
    }
    return documents
  }

  const readConfig = async () => {
    try {
      const list = await entries()
      const files = await targets(list)
      const [global, project] = await Promise.all([read(files.global), read(files.project)])
      const texts = new Map([
        [files.global, global],
        [files.project, project],
      ])
      input.post({
        type: "configLoaded",
        global: { path: files.global, text: global },
        project: { path: files.project, text: project },
        policy: configPolicy(await policyDocuments(list, texts), files),
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
  // edit. Every writer in the host shares one chain so each reads the text the previous one wrote.
  const writeConfig = (id: number, scope: ConfigScope, edits: ConfigEdit[]) => {
    void configWriteQueue(async () => {
      try {
        const files = await targets()
        const file = await canonicalPath(files[scope])
        if (!isKiloConfigFile(file)) throw new Error(`Refused a config write outside a Kilo config file: ${file}`)
        const existing = await read(file)
        if (existing.trim().length === 0 && edits.every((edit) => edit.value === undefined)) {
          input.post({ type: "configWritten", id, ok: true, file: { scope, path: files[scope], text: existing } })
          return
        }
        const text = applyConfigEdits(existing, edits)
        await mkdir(path.dirname(file), { recursive: true })
        await writeFile(file, text)
        input.post({ type: "configWritten", id, ok: true, file: { scope, path: files[scope], text } })
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

  const updateSettings = (values: Record<string, unknown>) => writeKiloSettings(values)

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
      if (KiloConfigFiles.names.includes(path.basename(file))) {
        const list = await entries()
        const files = await targets(list)
        const scope = file === files.global ? "global" : file === files.project ? "project" : undefined
        if (scope) {
          const picked = await pickConfigFile(scope, file, list)
          if (!picked) return
          file = picked.file
        }
      }
      if (isKiloConfigFile(file) && !(await stat(file).catch(() => undefined))) {
        await mkdir(path.dirname(file), { recursive: true })
        await writeFile(file, "{\n}\n")
      }
      await window.showTextDocument(await workspace.openTextDocument(Uri.file(file)))
    } catch (error) {
      void window.showErrorMessage(error instanceof Error ? error.message : String(error))
    }
  }

  /** The Agent Manager rows read and write a project the provider owns, so the handler stays provider-scoped. */
  const handleAgentManager = async (message: AgentManagerSettings) => {
    const handler = input.agentManager?.()
    if (!handler) return
    if (message.type === "agentManagerSettings") {
      const projects = await handler.projects(message.projectId)
      const projectId = projects.some((project) => project.id === message.projectId)
        ? message.projectId
        : projects[0]?.id
      input.post({ type: "agentManagerSettingsLoaded", requestId: message.requestId, projectId, projects })
      return
    }
    if (message.type === "agentManagerSettingsBranches") {
      const result = await handler.branches(message.projectId)
      input.post(
        result
          ? { type: "agentManagerSettingsBranchesLoaded", requestId: message.requestId, ...result }
          : { type: "agentManagerSettingsBranchesLoaded", requestId: message.requestId, projectId: message.projectId, error: "Could not read the branches of this project." },
      )
      return
    }
    if (message.type === "agentManagerSetDefaultBaseBranch") {
      await handler.setDefaultBaseBranch(message.projectId, message.branch)
    } else if (message.type === "agentManagerConfigureSetupScript") {
      await handler.configureSetupScript(message.projectId)
    }
    // Both writes change the project snapshot, so the rows refresh from the same handler.
    const projects = await handler.projects(message.projectId)
    input.post({
      type: "agentManagerSettingsLoaded",
      requestId: message.requestId,
      projectId: message.projectId,
      projects,
    })
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
    if (message.type === "attentionTestSound") {
      void playSound("default", resolveSoundID(message.sound), soundDirectory(input.context.extensionPath))
      return true
    }
    if (message.type === "attentionTestOS") {
      void testOSNotification().then((result) => input.post({ type: "attentionTestOSResult", ...result }))
      return true
    }
    if (message.type === "openVSCodeSettings") {
      void commands.executeCommand("workbench.action.openSettings", message.query)
      return true
    }
    if (
      message.type === "agentManagerSettings" ||
      message.type === "agentManagerSettingsBranches" ||
      message.type === "agentManagerSetDefaultBaseBranch" ||
      message.type === "agentManagerConfigureSetupScript"
    ) {
      void handleAgentManager(message)
      return true
    }
    if (message.type === "fetchCustomProviderModels") {
      void (async () => {
        // Resolve the config file here: the webview sends only the scope, never a path.
        const files = message.scope ? await targets().catch(() => undefined) : undefined
        input.post(
          await fetchCustomProviderModels({
            server: input.server,
            directory: input.directory,
            request: message,
            configPath: message.scope ? files?.[message.scope] : undefined,
          }),
        )
      })()
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

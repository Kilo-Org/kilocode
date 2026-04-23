import * as vscode from "vscode"
import { keybindings } from "../../keybindings"

const keys = new Set(["enableAutoTrigger", "enableSmartInlineTaskKeybinding", "enableChatAutocomplete"])
const cmd = "kilo-code.new.autocomplete.generateSuggestions"

type Message = {
  type: string
  key?: unknown
  value?: unknown
  text?: string
}

type Post = (msg: unknown) => void

export async function routeAutocompleteMessage(
  message: Message,
  post: Post,
  context?: vscode.ExtensionContext,
): Promise<boolean> {
  if (message.type === "requestAutocompleteSettings") {
    post(await buildAutocompleteSettingsMessage(context))
    return true
  }

  if (message.type === "updateAutocompleteSetting") {
    if (await update(message.key, message.value)) {
      post(await buildAutocompleteSettingsMessage(context))
    }
    return true
  }

  if (message.type === "openGlobalKeybindings") {
    await vscode.commands.executeCommand("workbench.action.openGlobalKeybindings", message.text ?? "kilo-code.new")
    return true
  }

  return false
}

export async function buildAutocompleteSettingsMessage(context?: vscode.ExtensionContext) {
  const cfg = config()
  return {
    type: "autocompleteSettingsLoaded" as const,
    settings: {
      enableAutoTrigger: cfg.get<boolean>("enableAutoTrigger", true),
      enableSmartInlineTaskKeybinding: cfg.get<boolean>("enableSmartInlineTaskKeybinding", false),
      enableChatAutocomplete: cfg.get<boolean>("enableChatAutocomplete", false),
    },
    keybindings: await keybindings([cmd], context),
  }
}

/** Push autocomplete settings to the webview whenever VS Code config changes. */
export function watchAutocompleteConfig(post: Post, context?: vscode.ExtensionContext): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((e) => {
    if (!e.affectsConfiguration("kilo-code.new.autocomplete")) return
    void buildAutocompleteSettingsMessage(context).then(post, (err) => {
      console.warn("[Kilo New] Failed to load autocomplete settings", err)
    })
  })
}

async function update(key: unknown, value: unknown) {
  if (typeof key !== "string") return false
  if (!keys.has(key)) return false

  await config().update(key, value, scope(key))
  return true
}

function config() {
  return vscode.workspace.getConfiguration("kilo-code.new.autocomplete", resource())
}

function resource() {
  return vscode.window.activeTextEditor?.document.uri ?? vscode.workspace.workspaceFolders?.[0]?.uri
}

function scope(key: string) {
  const info = config().inspect(key)
  if (info?.workspaceFolderValue !== undefined) return vscode.ConfigurationTarget.WorkspaceFolder
  if (info?.workspaceValue !== undefined) return vscode.ConfigurationTarget.Workspace
  return vscode.ConfigurationTarget.Global
}

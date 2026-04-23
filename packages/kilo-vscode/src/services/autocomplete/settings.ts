import * as vscode from "vscode"

const keys = new Set(["enableAutoTrigger", "enableSmartInlineTaskKeybinding", "enableChatAutocomplete"])

type Message = {
  type: string
  key?: unknown
  value?: unknown
}

type Post = (msg: unknown) => void

export async function routeAutocompleteMessage(message: Message, post: Post): Promise<boolean> {
  if (message.type === "requestAutocompleteSettings") {
    post(buildAutocompleteSettingsMessage())
    return true
  }

  if (message.type === "updateAutocompleteSetting") {
    if (await update(message.key, message.value)) {
      post(buildAutocompleteSettingsMessage())
    }
    return true
  }

  return false
}

export function buildAutocompleteSettingsMessage() {
  const config = vscode.workspace.getConfiguration("kilo-code.new.autocomplete")
  return {
    type: "autocompleteSettingsLoaded" as const,
    settings: {
      enableAutoTrigger: config.get<boolean>("enableAutoTrigger", true),
      enableSmartInlineTaskKeybinding: config.get<boolean>("enableSmartInlineTaskKeybinding", false),
      enableChatAutocomplete: config.get<boolean>("enableChatAutocomplete", false),
    },
  }
}

/** Push autocomplete settings to the webview whenever VS Code config changes. */
export function watchAutocompleteConfig(post: Post): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("kilo-code.new.autocomplete")) {
      post(buildAutocompleteSettingsMessage())
    }
  })
}

async function update(key: unknown, value: unknown) {
  if (typeof key !== "string") return false
  if (!keys.has(key)) return false

  await vscode.workspace
    .getConfiguration("kilo-code.new.autocomplete")
    .update(key, value, vscode.ConfigurationTarget.Global)

  return true
}

/**
 * Autocomplete settings handlers — extracted from KiloProvider.
 *
 * Handles requestAutocompleteSettings / updateAutocompleteSetting / openGlobalKeybindings
 * webview messages and exposes a helper for pushing current settings to the webview.
 */

import * as vscode from "vscode"
import { keybindings } from "../keybindings"

const ALLOWED_KEYS = new Set<string>(["enableAutoTrigger", "enableSmartInlineTaskKeybinding", "enableChatAutocomplete"])

type Message = { type: string; key?: string; value?: unknown; text?: string }

/**
 * Route autocomplete-related webview messages. Returns true when the message was handled.
 */
export async function routeAutocompleteMessage(message: Message, post: (msg: unknown) => void): Promise<boolean> {
  if (message.type === "requestAutocompleteSettings") {
    post(await buildSettingsMessage())
    return true
  }
  if (message.type === "updateAutocompleteSetting") {
    if (await updateSetting(message.key, message.value)) {
      post(await buildSettingsMessage())
    }
    return true
  }
  if (message.type === "openGlobalKeybindings") {
    const query = message.text ?? "kilo-code.new"
    await vscode.commands.executeCommand("workbench.action.openGlobalKeybindings", query)
    return true
  }
  return false
}

/**
 * Build the autocompleteSettingsLoaded message. Exposed so other flows
 * (e.g. "reset all settings") can push fresh settings after changing config.
 */
export async function buildSettingsMessage() {
  const config = vscode.workspace.getConfiguration("kilo-code.new.autocomplete")
  return {
    type: "autocompleteSettingsLoaded" as const,
    settings: {
      enableAutoTrigger: config.get<boolean>("enableAutoTrigger", true),
      enableSmartInlineTaskKeybinding: config.get<boolean>("enableSmartInlineTaskKeybinding", false),
      enableChatAutocomplete: config.get<boolean>("enableChatAutocomplete", false),
    },
    keybindings: await keybindings(["kilo-code.new.autocomplete.generateSuggestions"]),
  }
}

async function updateSetting(key: unknown, value: unknown) {
  if (typeof key !== "string" || !ALLOWED_KEYS.has(key)) return false
  await vscode.workspace
    .getConfiguration("kilo-code.new.autocomplete")
    .update(key, value, vscode.ConfigurationTarget.Global)
  return true
}

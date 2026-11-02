import * as vscode from "vscode"
import { validAutocompleteModel, validAutocompleteProvider } from "../../shared/autocomplete-models"

export const AUTOCOMPLETE_SECTION = "kilo-code.v2.autocomplete"

/** The keys under `kilo-code.v2.autocomplete`, as the Settings panel writes them. */
export const AUTOCOMPLETE_SETTING_KEYS = [
  "enableAutoTrigger",
  "enableSmartInlineTaskKeybinding",
  "enableChatAutocomplete",
  "provider",
  "model",
] as const

/**
 * The stored autocomplete settings. Provider and model stay null when unset, so the Settings panel can tell "not set"
 * from an explicit choice of the current default; the runtime resolves null to the default model.
 */
export function readAutocompleteSettings() {
  const config = vscode.workspace.getConfiguration(AUTOCOMPLETE_SECTION)
  return {
    enableAutoTrigger: config.get<boolean>("enableAutoTrigger", true),
    enableSmartInlineTaskKeybinding: config.get<boolean>("enableSmartInlineTaskKeybinding", false),
    enableChatAutocomplete: config.get<boolean>("enableChatAutocomplete", false),
    provider: config.get<string>("provider") ?? null,
    model: config.get<string>("model") ?? null,
  }
}

export function validAutocompleteSetting(key: string, value: unknown) {
  // Null clears provider and model back to the default.
  if (key === "model") return value === null || value === undefined || validAutocompleteModel(value)
  if (key === "provider") return value === null || value === undefined || validAutocompleteProvider(value)
  if (key === "enableAutoTrigger" || key === "enableSmartInlineTaskKeybinding" || key === "enableChatAutocomplete")
    return typeof value === "boolean"
  return false
}

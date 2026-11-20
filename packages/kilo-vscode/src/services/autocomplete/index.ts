import * as vscode from "vscode"
import { AutocompleteServiceManager } from "./AutocompleteServiceManager"
import { ensureBackendForAutocomplete } from "./ensure-backend"
import { migrateDefaultAutocompleteSettings } from "./migrate-default"
import type { KiloConnectionService } from "../cli-backend"

export const registerAutocompleteProvider = async (
  context: vscode.ExtensionContext,
  connectionService: KiloConnectionService,
) => {
  // Run before constructing the manager so its initial readSettings() sees
  // the cleared state and behaves as "Not set." Awaited because the manager's
  // constructor synchronously kicks off readSettings() via load(), which would
  // otherwise race with the migration.
  await migrateDefaultAutocompleteSettings(context)

  const autocompleteManager = new AutocompleteServiceManager(context, connectionService)
  context.subscriptions.push(autocompleteManager)

  // Register AutocompleteServiceManager Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("kilo-code.new.autocomplete.reload", async () => {
      await autocompleteManager.load()
    }),
  )
  context.subscriptions.push(
    vscode.commands.registerCommand("kilo-code.new.autocomplete.codeActionQuickFix", async () => {
      return
    }),
  )
  context.subscriptions.push(
    vscode.commands.registerCommand("kilo-code.new.autocomplete.cancelSuggestions", () => {
      vscode.commands.executeCommand("editor.action.inlineSuggest.hide")
      vscode.commands.executeCommand("setContext", "kilo-code.new.autocomplete.hasSuggestions", false)
    }),
  )
  context.subscriptions.push(
    vscode.commands.registerCommand("kilo-code.new.autocomplete.generateSuggestions", async () => {
      autocompleteManager.codeSuggestion()
    }),
  )
  context.subscriptions.push(
    vscode.commands.registerCommand("kilo-code.new.autocomplete.showIncompatibilityExtensionPopup", async () => {
      await autocompleteManager.showIncompatibilityExtensionPopup()
    }),
  )
  context.subscriptions.push(
    vscode.commands.registerCommand("kilo-code.new.autocomplete.disable", async () => {
      await autocompleteManager.disable()
    }),
  )

  // Register AutocompleteServiceManager Code Actions
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider("*", autocompleteManager.codeActionProvider, {
      providedCodeActionKinds: Object.values(autocompleteManager.codeActionProvider.providedCodeActionKinds),
    }),
  )

  // Re-load when autocomplete settings change (e.g. toggled from webview or VS Code settings UI).
  // Also ensure the CLI backend is running when autocomplete gets enabled.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("kilo-code.new.autocomplete")) {
        ensureBackendForAutocomplete(connectionService)
        void autocompleteManager.load()
      }
    }),
  )
}

import * as vscode from "vscode"
import { AutocompleteServiceManager } from "./AutocompleteServiceManager"
import type { Connection } from "./connection"
import { ensureBackendForAutocomplete } from "./ensure-backend"
import { AUTOCOMPLETE_SECTION } from "./settings"
import { INLINE_COMPLETION_ACCEPTED_COMMAND } from "./next-edit/NextEditInlineCompletionProvider"
import { nesLog } from "./next-edit/log"
import { chainNextPrediction } from "./next-edit/NextEditSuggestionManager"

/**
 * Registers inline autocomplete. The server holds the credentials, so a running server is the only prerequisite;
 * with autocomplete on, the server starts at activation instead of on the first chat request.
 */
export function registerAutocompleteProvider(context: vscode.ExtensionContext, connection: Connection) {
  ensureBackendForAutocomplete(connection)

  const manager = new AutocompleteServiceManager(context, connection)
  context.subscriptions.push(
    manager,
    vscode.commands.registerCommand("kilo-code.v2.autocomplete.reload", () => manager.load()),
    vscode.commands.registerCommand("kilo-code.v2.autocomplete.codeActionQuickFix", () => undefined),
    vscode.commands.registerCommand("kilo-code.v2.autocomplete.cancelSuggestions", () => {
      void vscode.commands.executeCommand("editor.action.inlineSuggest.hide")
      void vscode.commands.executeCommand("setContext", "kilo-code.v2.autocomplete.hasSuggestions", false)
    }),
    vscode.commands.registerCommand("kilo-code.v2.autocomplete.generateSuggestions", () => manager.codeSuggestion()),
    vscode.commands.registerCommand("kilo-code.v2.autocomplete.showIncompatibilityExtensionPopup", () =>
      manager.showIncompatibilityExtensionPopup(),
    ),
    vscode.commands.registerCommand("kilo-code.v2.autocomplete.disable", () => manager.disable()),
    // After an accepted Next Edit, request the next prediction at once, so repeated Tab walks a refactor.
    vscode.commands.registerCommand(INLINE_COMPLETION_ACCEPTED_COMMAND, () => {
      nesLog("suggestion accepted")
      if (manager.currentMode === "next-edit") chainNextPrediction()
    }),
    // The first Tab moves the cursor to an off-cursor suggestion, the second applies it.
    vscode.commands.registerCommand("kilo-code.v2.autocomplete.nextEdit.acceptOrJump", () =>
      manager.nextEditSuggestionManager.acceptOrJump(),
    ),
    vscode.commands.registerCommand("kilo-code.v2.autocomplete.nextEdit.dismiss", () =>
      manager.nextEditSuggestionManager.clear(),
    ),
    vscode.languages.registerCodeActionsProvider("*", manager.codeActionProvider, {
      providedCodeActionKinds: Object.values(manager.codeActionProvider.providedCodeActionKinds),
    }),
    // Settings from the Settings panel or the VS Code settings UI apply without a reload.
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration(AUTOCOMPLETE_SECTION)) return
      ensureBackendForAutocomplete(connection)
      void manager.load()
    }),
  )
  return manager
}

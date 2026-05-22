import * as vscode from "vscode"
import { AutocompleteServiceManager } from "./AutocompleteServiceManager"
import { ensureBackendForAutocomplete } from "./ensure-backend"
import { nesLog } from "./next-edit/log"
import { INLINE_COMPLETION_ACCEPTED_COMMAND as NEXT_EDIT_ACCEPTED_COMMAND } from "./next-edit/NextEditInlineCompletionProvider"
import {
  NEXT_EDIT_ACCEPT_OR_JUMP_COMMAND,
  NEXT_EDIT_DISMISS_COMMAND,
  chainNextPrediction,
} from "./next-edit/NextEditSuggestionManager"
import type { KiloConnectionService } from "../cli-backend"

export const registerAutocompleteProvider = (
  context: vscode.ExtensionContext,
  connectionService: KiloConnectionService,
) => {
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
  // Fired by VSCode when the user accepts a Next Edit suggestion. The provider
  // attaches this command to its InlineCompletionItem so VSCode invokes it on Tab.
  context.subscriptions.push(
    vscode.commands.registerCommand(NEXT_EDIT_ACCEPTED_COMMAND, () => {
      nesLog("suggestion accepted")
      // Chain: re-trigger immediately so Mercury can surface the next edit
      // without the user needing to type. The mode check guards against
      // chaining when Mercury isn't the active model.
      const mgr = AutocompleteServiceManager.getInstance()
      if (mgr && mgr.currentMode === "next-edit") chainNextPrediction()
    }),
  )
  // Tab handler for off-cursor suggestions: jump cursor to the predicted edit
  // location; second Tab (or Tab while cursor is already there) applies the edit.
  context.subscriptions.push(
    vscode.commands.registerCommand(NEXT_EDIT_ACCEPT_OR_JUMP_COMMAND, async () => {
      await autocompleteManager.nextEditSuggestionManager.acceptOrJump()
    }),
  )
  // Esc handler: dismiss the pending suggestion without applying it.
  context.subscriptions.push(
    vscode.commands.registerCommand(NEXT_EDIT_DISMISS_COMMAND, () => {
      autocompleteManager.nextEditSuggestionManager.clear()
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

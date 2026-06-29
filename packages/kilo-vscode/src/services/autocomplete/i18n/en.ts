// English runtime translations for autocomplete (kilocode:autocomplete.* namespace)
// Source: src/i18n/locales/en/kilocode.json → "autocomplete" section

export const dict = {
  "kilocode:autocomplete.statusBar.enabled": "$(kilo-logo) Autocomplete",
  "kilocode:autocomplete.statusBar.snoozed": "snoozed",
  "kilocode:autocomplete.statusBar.warning": "$(warning) Autocomplete",
  "kilocode:autocomplete.statusBar.tooltip.basic": "Kilo Code Autocomplete",
  "kilocode:autocomplete.statusBar.tooltip.disabled": "Kilo Code Autocomplete (disabled)",
  "kilocode:autocomplete.statusBar.tooltip.noUsableProvider":
    "**No autocomplete model configured**\n\nTo enable autocomplete, add a profile with one of these supported providers: {{providers}}.\n\n[Open Settings]({{command}})",
  "kilocode:autocomplete.statusBar.tooltip.sessionTotal": "Session total cost:",
  "kilocode:autocomplete.statusBar.tooltip.provider": "Provider:",
  "kilocode:autocomplete.statusBar.tooltip.model": "Model:",
  "kilocode:autocomplete.statusBar.tooltip.profile": "Profile: ",
  "kilocode:autocomplete.statusBar.tooltip.defaultProfile": "Default",
  "kilocode:autocomplete.statusBar.tooltip.completionSummary":
    "Performed {{count}} completions between {{startTime}} and {{endTime}}, for a total cost of {{cost}}.",
  "kilocode:autocomplete.statusBar.tooltip.providerInfo": "Autocompletions provided by {{model}} via {{provider}}.",
  "kilocode:autocomplete.statusBar.cost.zero": "$0.00",
  "kilocode:autocomplete.statusBar.cost.lessThanCent": "<$0.01",
  "kilocode:autocomplete.toggleMessage": "Kilo Code Autocomplete {{status}}",
  "kilocode:autocomplete.progress.title": "Kilo Code",
  "kilocode:autocomplete.progress.analyzing": "Analyzing your code...",
  "kilocode:autocomplete.progress.generating": "Generating suggested edits...",
  "kilocode:autocomplete.progress.processing": "Processing suggested edits...",
  "kilocode:autocomplete.progress.showing": "Displaying suggested edits...",
  "kilocode:autocomplete.input.title": "Kilo Code: Quick Task",
  "kilocode:autocomplete.input.placeholder": "e.g., 'refactor this function to be more efficient'",
  "kilocode:autocomplete.commands.generateSuggestions": "Kilo Code: Generate Suggested Edits",
  "kilocode:autocomplete.commands.generateSuggestions.title": "Generate Suggested Edits",
  "kilocode:autocomplete.commands.displaySuggestions": "Display Suggested Edits",
  "kilocode:autocomplete.commands.cancelSuggestions": "Cancel Suggested Edits",
  "kilocode:autocomplete.commands.nextEdit.acceptOrJump": "Next Edit: Accept or Jump to Suggested Edit",
  "kilocode:autocomplete.commands.nextEdit.dismiss": "Next Edit: Dismiss Pending Suggestion",
  "kilocode:autocomplete.commands.applyCurrentSuggestion": "Apply Current Suggested Edit",
  "kilocode:autocomplete.commands.applyAllSuggestions": "Apply All Suggested Edits",
  "kilocode:autocomplete.commands.category": "Kilo Code",
  "kilocode:autocomplete.codeAction.title": "Kilo Code: Suggested Edits",
  "kilocode:autocomplete.inlineCompletion.acceptedCommandTitle": "Autocomplete Accepted",
  "kilocode:autocomplete.nextEdit.outputChannel": "Kilo Code · Next Edit",
  "kilocode:autocomplete.nextEdit.acceptedCommandTitle": "Next Edit Accepted",
  "kilocode:autocomplete.nextEdit.decoration.removed": "→ (removed)",
  "kilocode:autocomplete.nextEdit.hint.apply": "  ↳ Tab to apply · Esc to dismiss",
  "kilocode:autocomplete.nextEdit.hint.jump": "  ↳ Tab to jump here · Esc to dismiss",
  "kilocode:autocomplete.configuration.model.enum.codestralGateway": "Codestral via Kilo Gateway",
  "kilocode:autocomplete.configuration.model.enum.mercuryFimGateway": "Mercury Edit 2 (FIM) via Kilo Gateway",
  "kilocode:autocomplete.configuration.model.enum.mercuryNextEditGateway":
    "Mercury Edit 2 (Next Edit), multi-line edit predictions with jump-to-edit UX, via Kilo Gateway",
  "kilocode:autocomplete.configuration.model.enum.codestralMistral":
    "Codestral via your connected Mistral provider API key",
  "kilocode:autocomplete.configuration.model.enum.mercuryFimInception":
    "Mercury Edit 2 (FIM) via your connected Inception provider API key",
  "kilocode:autocomplete.configuration.model.enum.mercuryNextEditInception":
    "Mercury Edit 2 (Next Edit), multi-line edit predictions with jump-to-edit UX, via your connected Inception provider API key",
  "kilocode:autocomplete.configuration.model.description":
    "Model to use for inline autocomplete suggestions. If unset, the recommended default is used.",
  "kilocode:autocomplete.configuration.provider.enum.kilo": "Use autocomplete models through Kilo Gateway",
  "kilocode:autocomplete.configuration.provider.enum.mistral":
    "Use autocomplete models through your connected Mistral provider API key",
  "kilocode:autocomplete.configuration.provider.enum.inception":
    "Use autocomplete models through your connected Inception provider API key",
  "kilocode:autocomplete.configuration.provider.description":
    "Provider to use for inline autocomplete suggestions. If unset, Kilo Gateway is used.",
  "kilocode:autocomplete.configuration.enableAutoTrigger.description": "Enable automatic inline completion suggestions",
  "kilocode:autocomplete.configuration.enableSmartInlineTaskKeybinding.description":
    "Enable smart inline task keybinding",
  "kilocode:autocomplete.configuration.enableChatAutocomplete.description": "Enable chat textarea autocomplete",
  "kilocode:autocomplete.chatParticipant.fullName": "Kilo Code Agent",
  "kilocode:autocomplete.chatParticipant.name": "Agent",
  "kilocode:autocomplete.chatParticipant.description": "I can help you with quick tasks and suggested edits.",
  "kilocode:autocomplete.incompatibilityExtensionPopup.message":
    "The Kilo Code Autocomplete is being blocked by a conflict with GitHub Copilot. To fix this, you must disable Copilot's inline suggestions.",
  "kilocode:autocomplete.incompatibilityExtensionPopup.disableCopilot": "Disable Copilot",
  "kilocode:autocomplete.incompatibilityExtensionPopup.disableInlineAssist": "Disable Autocomplete",
  "kilocode:autocomplete.creditsExhausted.message":
    "Kilo Code Autocomplete has been paused because your account has no remaining credits. Add credits to resume autocomplete.",
  "kilocode:autocomplete.creditsExhausted.addCredits": "Add Credits",
  "kilocode:autocomplete.authError.message":
    "Kilo Code Autocomplete has been paused due to an authentication error. Please sign in again.",
}

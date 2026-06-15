// English runtime translations for autocomplete (kilocode:autocomplete.* namespace)
// Source: src/i18n/locales/en/kilocode.json → "autocomplete" section

export const dict = {
  "kilocode:autocomplete.statusBar.enabled": "$(sparkle) Autocomplete",
  "kilocode:autocomplete.statusBar.snoozed": "snoozed",
  "kilocode:autocomplete.statusBar.warning": "$(warning) Autocomplete",
  "kilocode:autocomplete.statusBar.tooltip.basic": "LLMAPI Autocomplete",
  "kilocode:autocomplete.statusBar.tooltip.disabled": "LLMAPI Autocomplete (disabled)",
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
  "kilocode:autocomplete.toggleMessage": "LLMAPI Autocomplete {{status}}",
  "kilocode:autocomplete.progress.title": "LLMAPI",
  "kilocode:autocomplete.progress.analyzing": "Analyzing your code...",
  "kilocode:autocomplete.progress.generating": "Generating suggested edits...",
  "kilocode:autocomplete.progress.processing": "Processing suggested edits...",
  "kilocode:autocomplete.progress.showing": "Displaying suggested edits...",
  "kilocode:autocomplete.input.title": "LLMAPI: Quick Task",
  "kilocode:autocomplete.input.placeholder": "e.g., 'refactor this function to be more efficient'",
  "kilocode:autocomplete.commands.generateSuggestions": "LLMAPI: Generate Suggested Edits",
  "kilocode:autocomplete.commands.displaySuggestions": "Display Suggested Edits",
  "kilocode:autocomplete.commands.cancelSuggestions": "Cancel Suggested Edits",
  "kilocode:autocomplete.commands.applyCurrentSuggestion": "Apply Current Suggested Edit",
  "kilocode:autocomplete.commands.applyAllSuggestions": "Apply All Suggested Edits",
  "kilocode:autocomplete.commands.category": "LLMAPI",
  "kilocode:autocomplete.codeAction.title": "LLMAPI: Suggested Edits",
  "kilocode:autocomplete.chatParticipant.fullName": "LLMAPI Agent",
  "kilocode:autocomplete.chatParticipant.name": "Agent",
  "kilocode:autocomplete.chatParticipant.description": "I can help you with quick tasks and suggested edits.",
  "kilocode:autocomplete.incompatibilityExtensionPopup.message":
    "The LLMAPI Autocomplete is being blocked by a conflict with GitHub Copilot. To fix this, you must disable Copilot's inline suggestions.",
  "kilocode:autocomplete.incompatibilityExtensionPopup.disableCopilot": "Disable Copilot",
  "kilocode:autocomplete.incompatibilityExtensionPopup.disableInlineAssist": "Disable Autocomplete",
  "kilocode:autocomplete.creditsExhausted.message":
    "LLMAPI Autocomplete has been paused because your account has no remaining credits. Add credits to resume autocomplete.",
  "kilocode:autocomplete.creditsExhausted.addCredits": "Add Credits",
  "kilocode:autocomplete.authError.message":
    "LLMAPI Autocomplete has been paused due to an authentication error. Please sign in again.",
}

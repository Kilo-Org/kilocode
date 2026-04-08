// English runtime translations for autocomplete (devilcode:autocomplete.* namespace)
// Source: src/i18n/locales/en/devilcode.json → "autocomplete" section

export const dict = {
  "devilcode:autocomplete.statusBar.enabled": "$(kilo-logo) Autocomplete",
  "devilcode:autocomplete.statusBar.snoozed": "snoozed",
  "devilcode:autocomplete.statusBar.warning": "$(warning) Autocomplete",
  "devilcode:autocomplete.statusBar.tooltip.basic": "Devil Code Autocomplete",
  "devilcode:autocomplete.statusBar.tooltip.disabled": "Devil Code Autocomplete (disabled)",
  "devilcode:autocomplete.statusBar.tooltip.noUsableProvider":
    "**No autocomplete model configured**\n\nTo enable autocomplete, add a profile with one of these supported providers: {{providers}}.\n\n[Open Settings]({{command}})",
  "devilcode:autocomplete.statusBar.tooltip.sessionTotal": "Session total cost:",
  "devilcode:autocomplete.statusBar.tooltip.provider": "Provider:",
  "devilcode:autocomplete.statusBar.tooltip.model": "Model:",
  "devilcode:autocomplete.statusBar.tooltip.profile": "Profile: ",
  "devilcode:autocomplete.statusBar.tooltip.defaultProfile": "Default",
  "devilcode:autocomplete.statusBar.tooltip.completionSummary":
    "Performed {{count}} completions between {{startTime}} and {{endTime}}, for a total cost of {{cost}}.",
  "devilcode:autocomplete.statusBar.tooltip.providerInfo": "Autocompletions provided by {{model}} via {{provider}}.",
  "devilcode:autocomplete.statusBar.cost.zero": "$0.00",
  "devilcode:autocomplete.statusBar.cost.lessThanCent": "<$0.01",
  "devilcode:autocomplete.toggleMessage": "Devil Code Autocomplete {{status}}",
  "devilcode:autocomplete.progress.title": "Devil Code",
  "devilcode:autocomplete.progress.analyzing": "Analyzing your code...",
  "devilcode:autocomplete.progress.generating": "Generating suggested edits...",
  "devilcode:autocomplete.progress.processing": "Processing suggested edits...",
  "devilcode:autocomplete.progress.showing": "Displaying suggested edits...",
  "devilcode:autocomplete.input.title": "Devil Code: Quick Task",
  "devilcode:autocomplete.input.placeholder": "e.g., 'refactor this function to be more efficient'",
  "devilcode:autocomplete.commands.generateSuggestions": "Devil Code: Generate Suggested Edits",
  "devilcode:autocomplete.commands.displaySuggestions": "Display Suggested Edits",
  "devilcode:autocomplete.commands.cancelSuggestions": "Cancel Suggested Edits",
  "devilcode:autocomplete.commands.applyCurrentSuggestion": "Apply Current Suggested Edit",
  "devilcode:autocomplete.commands.applyAllSuggestions": "Apply All Suggested Edits",
  "devilcode:autocomplete.commands.category": "Devil Code",
  "devilcode:autocomplete.codeAction.title": "Devil Code: Suggested Edits",
  "devilcode:autocomplete.chatParticipant.fullName": "Devil Code Agent",
  "devilcode:autocomplete.chatParticipant.name": "Agent",
  "devilcode:autocomplete.chatParticipant.description": "I can help you with quick tasks and suggested edits.",
  "devilcode:autocomplete.incompatibilityExtensionPopup.message":
    "The Devil Code Autocomplete is being blocked by a conflict with GitHub Copilot. To fix this, you must disable Copilot's inline suggestions.",
  "devilcode:autocomplete.incompatibilityExtensionPopup.disableCopilot": "Disable Copilot",
  "devilcode:autocomplete.incompatibilityExtensionPopup.disableInlineAssist": "Disable Autocomplete",
  "devilcode:autocomplete.creditsExhausted.message":
    "Devil Code Autocomplete has been paused because your account has no remaining credits. Add credits to resume autocomplete.",
  "devilcode:autocomplete.creditsExhausted.addCredits": "Add Credits",
  "devilcode:autocomplete.authError.message":
    "Devil Code Autocomplete has been paused due to an authentication error. Please sign in again.",
}

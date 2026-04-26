// Kilo-specific translations and overrides
// Keys here will override any matching keys from upstream translations
export const dict = {
  // Kilo Gateway provider translations
  "provider.connect.kiloGateway.line1":
    "Kilo Gateway gives you access to a curated set of reliable optimized models for coding agents.",
  "provider.connect.kiloGateway.line2":
    "With a single API key you'll get access to models such as Claude, GPT, Gemini, GLM and more.",
  "provider.connect.kiloGateway.visit.prefix": "Visit ",
  "provider.connect.kiloGateway.visit.link": "kilo.ai",
  "provider.connect.kiloGateway.visit.suffix": " to collect your API key.",

  // Provider dialog translations
  "dialog.provider.group.recommended": "Recommended",
  "dialog.provider.kilo.note": "Access 500+ AI models",

  // Reasoning block label
  "ui.permission.run": "Run",
  "ui.reasoning.label": "Reasoning",

  // Marketplace
  "marketplace.tab.skills": "Skills",
  "marketplace.tab.mcpServers": "MCP Servers",
  "marketplace.tab.modes": "Modes",
  "marketplace.category.all": "All",
  "marketplace.placeholder": "To be implemented",
  "marketplace.card.installed": "Installed",
  "marketplace.card.install": "Install",
  "marketplace.card.remove": "Remove",
  "marketplace.card.removeScope": "Remove ({{scope}})",
  "marketplace.card.showMore": "Show more",
  "marketplace.card.showLess": "Show less",
  "marketplace.install.title": "Install {{name}}",
  "marketplace.install.scope": "Scope",
  "marketplace.install.scope.project": "Project",
  "marketplace.install.scope.global": "Global",
  "marketplace.install.prerequisites": "Prerequisites",
  "marketplace.install.installing": "Installing...",
  "marketplace.install.cancel": "Cancel",
  "marketplace.install.success": "Successfully installed!",
  "marketplace.install.failed": "Installation failed",
  "marketplace.install.done": "Done",
  "marketplace.install.close": "Close",
  "marketplace.remove.title": "Remove {{name}}?",
  "marketplace.remove.confirm":
    "Are you sure you want to remove this {{type}}? This will remove it from your {{scope}} configuration.",
  "marketplace.remove.cancel": "Cancel",
  "marketplace.remove.confirm.button": "Remove",
  "marketplace.tab.mcp": "MCP",
  "marketplace.search": "Search...",
  "marketplace.filter.all": "All Items",
  "marketplace.filter.notInstalled": "Not Installed",
  "marketplace.empty": "No items found",
  "marketplace.badge.mcpServer": "MCP Server",
  "marketplace.badge.mode": "Mode",
  "marketplace.card.by": "by {{author}}",
  "marketplace.install.method": "Installation Method",
  "marketplace.install.parameters": "Parameters",
  "marketplace.install.optional": "(optional)",
  "marketplace.install.required": "{{name}} is required",
  "marketplace.scope.project": "project",
  "marketplace.scope.global": "global",
  "marketplace.remove.type.mcp": "MCP server",
  "marketplace.remove.type.skill": "skill",
  "marketplace.remove.type.mode": "mode",
  "marketplace.remove.failed": "Failed to remove {{name}}",
  "marketplace.install": "Install",
  "marketplace.filter.installed": "Installed",
  "marketplace.error.dismiss": "Dismiss",
  "marketplace.warning.busyOne": "One session is running and will be interrupted",
  "marketplace.warning.busyMany": "Several sessions are running and will be interrupted",
  "marketplace.warning.installAnyway": "Install anyway",
  "marketplace.warning.cancel": "Cancel",
  "marketplace.contribute.prompt": "Missing a skill, mode, or MCP server?",
  "marketplace.contribute.cta": "Contribute on GitHub",

  // Plan follow-up question shown after plan_exit. The English strings here must match
  // the canonical `label`/`header`/`question` sent by the backend — those canonical labels
  // are still what the backend matches on (see packages/opencode/src/kilocode/plan-followup.ts).
  "plan.followup.header": "Implement",
  "plan.followup.question": "Ready to implement?",
  "plan.followup.answer.newSession": "Start new session",
  "plan.followup.answer.newSession.description": "Implement in a fresh session with a clean context",
  "plan.followup.answer.continue": "Continue here",
  "plan.followup.answer.continue.description": "Implement the plan in this session",

  // Autocomplete Custom Provider
  "settings.autocomplete.customProvider.title": "Custom Provider",
  "settings.autocomplete.customProvider.description": "Connect an OpenAI-compatible completion endpoint.",
  "settings.autocomplete.customProvider.providerName.title": "Provider Name",
  "settings.autocomplete.customProvider.providerName.placeholder": "e.g., ollama, openai",
  "settings.autocomplete.customProvider.model.title": "Model",
  "settings.autocomplete.customProvider.model.placeholder": "e.g., starcoder2",
  "settings.autocomplete.customProvider.apiBase.title": "API Base URL",
  "settings.autocomplete.customProvider.apiBase.placeholder": "e.g., http://localhost:11434/v1",
  "settings.autocomplete.customProvider.apiKey.title": "API Key",
  "settings.autocomplete.customProvider.apiKey.placeholder": "Enter your API key",
  "settings.autocomplete.customProvider.headers.title": "Custom Headers",
  "settings.autocomplete.customProvider.headers.description": "Add any required headers for authentication or routing.",
  "settings.autocomplete.customProvider.headers.key.placeholder": "Header name",
  "settings.autocomplete.customProvider.headers.value.placeholder": "Header value",
  "settings.autocomplete.customProvider.headers.add": "Add header",
}

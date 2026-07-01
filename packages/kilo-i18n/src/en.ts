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
  "provider.connect.kiloGateway.byok.prefix": "For more usage stats, ",
  "provider.connect.kiloGateway.byok.link": "BYOK via Kilo's Gateway",
  "provider.connect.kiloGateway.byok.suffix": ".",

  // Provider settings translations
  "settings.providers.group.recommended": "Recommended",
  "settings.providers.note.kilo": "Access 500+ AI models",
  "settings.providers.note.opencode": "Curated models including Claude, GPT, Gemini and more",
  "settings.providers.note.anthropic": "Direct access to Claude models, including Pro and Max",
  "settings.providers.note.deepseek": "DeepSeek models for reasoning and coding tasks",
  "settings.providers.note.copilot": "Claude models for coding assistance",
  "settings.providers.note.openai": "GPT and Codex models with API key or ChatGPT login",
  "settings.providers.note.google": "Gemini models for fast, structured responses",
  "settings.providers.note.openrouter": "Access all supported models from one provider",
  "settings.providers.note.vercel": "Unified access to AI models with smart routing",

  // Reasoning block label
  "ui.permission.run": "Run",
  "ui.reasoning.label": "Reasoning",

  // Marketplace
  "marketplace.tab.skills": "Skills",
  "marketplace.tab.mcpServers": "MCP Servers",
  "marketplace.category.all": "All",
  "marketplace.placeholder": "To be implemented",
  "marketplace.card.installed": "Installed",
  "marketplace.card.install": "Install",
  "marketplace.card.remove": "Remove",
  "marketplace.card.removeScope": "Remove ({{scope}})",
  "marketplace.card.showMore": "Show more",
  "marketplace.card.showLess": "Show less",
  "marketplace.install.title": "Install {{name}}",
  "marketplace.install.scope": "Where should this be available?",
  "marketplace.install.scope.project": "Project",
  "marketplace.install.scope.global": "Global",
  "marketplace.install.scope.project.description":
    "Only this project. The installed files can be committed and shared with your team.",
  "marketplace.install.scope.global.description": "All projects on this machine. Stored in your user configuration.",
  "marketplace.install.destination": "Installation destination",
  "marketplace.install.about.mcp":
    "An MCP server gives Kilo additional tools for working with external services or local programs.",
  "marketplace.install.about.agent": "An agent adds a reusable role with its own instructions and permissions.",
  "marketplace.install.about.skill": "A skill adds task-specific instructions and resources that Kilo can load when needed.",
  "marketplace.install.mcp.warning":
    "MCP servers can run local commands or connect to external services. Kilo will ask for permission before using their tools unless your permissions allow them automatically.",
  "marketplace.install.project.warning":
    "Project files may be committed to version control. Do not store secrets here unless the configuration references an environment variable.",
  "marketplace.install.learnMore": "Learn how Marketplace installs work",
  "marketplace.install.learnMcp": "Learn more about MCP",
  "marketplace.install.installedAt": "Installed to {{path}}",
  "marketplace.intro": "Install reusable agents, skills, and MCP tools for one project or every project.",
  "marketplace.intro.learnMore": "About Marketplace",
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
  "marketplace.tab.agents": "Agents",
  "marketplace.search": "Search...",
  "marketplace.filter.all": "All Items",
  "marketplace.filter.notInstalled": "Not Installed",
  "marketplace.filter.relevant": "Relevant to my workspace",
  "marketplace.empty": "No items found",
  "marketplace.empty.relevant": "No relevant marketplace items found for this workspace.",
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
  "marketplace.remove.type.agent": "agent",
  "marketplace.remove.failed": "Failed to remove {{name}}",
  "marketplace.install": "Install",
  "marketplace.filter.installed": "Installed",
  "marketplace.error.dismiss": "Dismiss",
  "marketplace.warning.busyOne": "One session is running and will be interrupted",
  "marketplace.warning.busyMany": "Several sessions are running and will be interrupted",
  "marketplace.warning.installAnyway": "Install anyway",
  "marketplace.warning.cancel": "Cancel",
  "marketplace.contribute.prompt": "Missing a skill, agent, or MCP server?",
  "marketplace.contribute.cta": "Contribute on GitHub",
  "marketplace.migration.notice":
    "Modes have been replaced by agents. If you previously installed marketplace modes, please remove and reinstall them as agents to migrate to the new format.",

  // Plan follow-up question shown after plan_exit. The English strings here must match
  // the canonical `label`/`header`/`question` sent by the backend — those canonical labels
  // are still what the backend matches on (see packages/opencode/src/kilocode/plan-followup.ts).
  "plan.followup.header": "Implement",
  "plan.followup.question": "Ready to implement?",
  "plan.followup.answer.newSession": "Start new session",
  "plan.followup.answer.newSession.description": "Implement in a fresh session with a clean context",
  "plan.followup.answer.continue": "Continue here",
  "plan.followup.answer.continue.description": "Implement the plan in this session",
  "plan.followup.answer.keepRefining": "Keep refining",
  "plan.followup.answer.keepRefining.description": "Keep planning without implementing yet",

  // Slow-repo snapshot prompt. The English strings here are the canonical
  // labels sent by the backend and must stay in sync with
  // packages/opencode/src/kilocode/snapshot/track.ts.
  "snapshot.slowRepo.header": "Snapshot is slow",
  "snapshot.slowRepo.question":
    "It is taking a long time to initialize the snapshot system, likely due to the size of the repository.\n\nDo you want to disable Snapshots for this repository?",
  "snapshot.slowRepo.answer.continue": "Continue with snapshots",
  "snapshot.slowRepo.answer.continue.description":
    "Keep waiting for the snapshot to complete. Subsequent turns are fast once the initial snapshot is built.",
  "snapshot.slowRepo.answer.disable": "Disable for this project",
  "snapshot.slowRepo.answer.disable.description":
    "Turn off Kilo's snapshots for this project. You will lose undo/redo of Kilo file changes, but git still tracks everything.",

  // Edit-tool header: hover-revealed action opening the diff in a full tab.
  "ui.messagePart.openInDiffViewer": "Open in Diff Viewer",
  // Shell-tool section labels and actions.
  "ui.messagePart.shell.command": "Command",
  "ui.messagePart.shell.output": "Output",
  "ui.messagePart.openInEditor": "Open in Editor",

  // Message feedback (thumbs up/down per assistant response)
  "ui.message.feedback.helpful": "This was helpful",
  "ui.message.feedback.notHelpful": "This wasn't helpful",
  "ui.message.feedback.clearRating": "Clear rating",
}

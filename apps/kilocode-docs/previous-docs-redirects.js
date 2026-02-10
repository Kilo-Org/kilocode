module.exports = [
	{
		source: "/docs/features/system-notifications",
		destination: "/docs/getting-started/settings/system-notifications",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/features/auto-approving-actions",
		destination: "/docs/getting-started/settings/auto-approving-actions",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/features/suggested-responses",
		destination: "/docs/code-with-ai/agents/chat-interface#suggested-responses",
		basePath: false,
		permanent: true,
	},
	// ============================================
	// GET STARTED
	// ============================================
	{
		source: "/docs/basic-usage/byok",
		destination: "/docs/getting-started/byok",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/getting-started/setting-up",
		destination: "/docs/getting-started/setup-authentication",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/getting-started/connecting-api-provider",
		destination: "/docs/getting-started/setup-authentication",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/getting-started/concepts",
		destination: "/docs/getting-started",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/getting-started/your-first-task",
		destination: "/docs/getting-started/quickstart",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/basic-usage/connecting-providers",
		destination: "/docs/ai-providers",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/providers/:path*",
		destination: "/docs/ai-providers/:path*",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/basic-usage/settings-management",
		destination: "/docs/getting-started/settings",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/basic-usage/adding-credits",
		destination: "/docs/getting-started/adding-credits",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/advanced-usage/migrating-from-cursor-windsurf",
		destination: "/docs/getting-started/migrating",
		basePath: false,
		permanent: true,
	},

	// ============================================
	// CODE WITH AI - Platforms
	// ============================================
	{
		source: "/docs/cli",
		destination: "/docs/code-with-ai/platforms/cli",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/advanced-usage/cloud-agent",
		destination: "/docs/code-with-ai/platforms/cloud-agent",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/advanced-usage/slackbot",
		destination: "/docs/code-with-ai/platforms/slack",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/slack",
		destination: "/docs/code-with-ai/platforms/slack",
		basePath: false,
		permanent: true,
	},

	// ============================================
	// CODE WITH AI - Working with Agents
	// ============================================
	{
		source: "/docs/basic-usage/the-chat-interface",
		destination: "/docs/code-with-ai/agents/chat-interface",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/basic-usage/context-mentions",
		destination: "/docs/code-with-ai/agents/context-mentions",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/basic-usage/using-modes",
		destination: "/docs/code-with-ai/agents/using-modes",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/basic-usage/orchestrator-mode",
		destination: "/docs/code-with-ai/agents/orchestrator-mode",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/basic-usage/model-selection-guide",
		destination: "/docs/code-with-ai/agents/model-selection",
		basePath: false,
		permanent: true,
	},

	// ============================================
	// CODE WITH AI - Features
	// ============================================
	{
		source: "/docs/basic-usage/autocomplete",
		destination: "/docs/code-with-ai/features/autocomplete",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/basic-usage/autocomplete/index",
		destination: "/docs/code-with-ai/features/autocomplete",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/basic-usage/autocomplete/mistral-setup",
		destination: "/docs/code-with-ai/features/autocomplete/mistral-setup",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/features/code-actions",
		destination: "/docs/code-with-ai/features/code-actions",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/features/browser-use",
		destination: "/docs/code-with-ai/features/browser-use",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/basic-usage/git-commit-generation",
		destination: "/docs/code-with-ai/features/git-commit-generation",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/features/checkpoints",
		destination: "/docs/code-with-ai/features/checkpoints",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/features/enhance-prompt",
		destination: "/docs/code-with-ai/features/enhance-prompt",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/features/fast-edits",
		destination: "/docs/code-with-ai/features/fast-edits",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/basic-usage/task-todo-list",
		destination: "/docs/code-with-ai/features/task-todo-list",
		basePath: false,
		permanent: true,
	},

	// ============================================
	// CUSTOMIZE - Context & Indexing
	// ============================================
	{
		source: "/docs/features/codebase-indexing",
		destination: "/docs/customize/context/codebase-indexing",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/advanced-usage/large-projects",
		destination: "/docs/customize/context/large-projects",
		basePath: false,
		permanent: true,
	},
	// Old code-with-ai/context paths redirect to new customize/context paths
	{
		source: "/docs/code-with-ai/context/codebase-indexing",
		destination: "/docs/customize/context/codebase-indexing",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/code-with-ai/context/large-projects",
		destination: "/docs/customize/context/large-projects",
		basePath: false,
		permanent: true,
	},
	// Removed memory bank page redirects to Agents.md
	{
		source: "/docs/advanced-usage/memory-bank",
		destination: "/docs/customize/agents-md",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/customize/context/memory-bank",
		destination: "/docs/customize/agents-md",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/code-with-ai/context/memory-bank",
		destination: "/docs/customize/agents-md",
		basePath: false,
		permanent: true,
	},

	// ============================================
	// CUSTOMIZE - Customization
	// ============================================
	{
		source: "/docs/agent-behavior/custom-modes",
		destination: "/docs/customize/custom-modes",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/agent-behavior/custom-rules",
		destination: "/docs/customize/custom-rules",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/agent-behavior/custom-instructions",
		destination: "/docs/customize/custom-instructions",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/agent-behavior/agents-md",
		destination: "/docs/customize/agents-md",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/agent-behavior/workflows",
		destination: "/docs/customize/workflows",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/agent-behavior/skills",
		destination: "/docs/customize/skills",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/features/skills",
		destination: "/docs/customize/skills",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/agent-behavior/prompt-engineering",
		destination: "/docs/customize/prompt-engineering",
		basePath: false,
		permanent: true,
	},
	// Old code-with-ai/customization paths redirect to new customize paths
	{
		source: "/docs/code-with-ai/customization/custom-modes",
		destination: "/docs/customize/custom-modes",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/code-with-ai/customization/custom-rules",
		destination: "/docs/customize/custom-rules",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/code-with-ai/customization/custom-instructions",
		destination: "/docs/customize/custom-instructions",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/code-with-ai/customization/agents-md",
		destination: "/docs/customize/agents-md",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/code-with-ai/customization/workflows",
		destination: "/docs/customize/workflows",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/code-with-ai/customization/skills",
		destination: "/docs/customize/skills",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/code-with-ai/customization/prompt-engineering",
		destination: "/docs/customize/prompt-engineering",
		basePath: false,
		permanent: true,
	},

	// ============================================
	// CODE WITH AI - App Builder
	// ============================================
	{
		source: "/docs/advanced-usage/appbuilder",
		destination: "/docs/code-with-ai/app-builder",
		basePath: false,
		permanent: true,
	},

	// ============================================
	// COLLABORATE - Sessions & Sharing
	// ============================================
	{
		source: "/docs/advanced-usage/sessions",
		destination: "/docs/collaborate/sessions-sharing",
		basePath: false,
		permanent: true,
	},

	// ============================================
	// COLLABORATE - Kilo for Teams
	// ============================================
	{
		source: "/docs/plans/about",
		destination: "/docs/collaborate/teams/about-plans",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/plans/getting-started",
		destination: "/docs/collaborate/teams/getting-started",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/plans/dashboard",
		destination: "/docs/collaborate/teams/dashboard",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/plans/team-management",
		destination: "/docs/collaborate/teams/team-management",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/plans/custom-modes",
		destination: "/docs/collaborate/teams/custom-modes-org",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/plans/billing",
		destination: "/docs/collaborate/teams/billing",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/plans/analytics",
		destination: "/docs/collaborate/teams/analytics",
		basePath: false,
		permanent: true,
	},

	// ============================================
	// COLLABORATE - AI Adoption Dashboard
	// ============================================
	{
		source: "/docs/plans/adoption-dashboard/overview",
		destination: "/docs/collaborate/adoption-dashboard/overview",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/plans/adoption-dashboard/understanding-your-score",
		destination: "/docs/collaborate/adoption-dashboard/understanding-your-score",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/plans/adoption-dashboard/improving-your-score",
		destination: "/docs/collaborate/adoption-dashboard/improving-your-score",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/plans/adoption-dashboard/for-team-leads",
		destination: "/docs/collaborate/adoption-dashboard/for-team-leads",
		basePath: false,
		permanent: true,
	},

	// ============================================
	// COLLABORATE - Enterprise
	// ============================================
	{
		source: "/docs/plans/enterprise/SSO",
		destination: "/docs/collaborate/enterprise/sso",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/plans/enterprise/sso",
		destination: "/docs/collaborate/enterprise/sso",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/plans/enterprise/model-access",
		destination: "/docs/collaborate/enterprise/model-access-controls",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/plans/enterprise/audit-logs",
		destination: "/docs/collaborate/enterprise/audit-logs",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/plans/migration",
		destination: "/docs/collaborate/enterprise/migration",
		basePath: false,
		permanent: true,
	},

	// ============================================
	// AUTOMATE
	// ============================================
	{
		source: "/docs/advanced-usage/code-reviews",
		destination: "/docs/automate/code-reviews",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/advanced-usage/agent-manager",
		destination: "/docs/automate/agent-manager",
		basePath: false,
		permanent: true,
	},

	// ============================================
	// AUTOMATE - CI/CD & Integrations
	// ============================================
	{
		source: "/docs/advanced-usage/integrations",
		destination: "/docs/automate/integrations/overview",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/features/auto-launch-configuration",
		destination: "/docs/automate/integrations/auto-launch",
		basePath: false,
		permanent: true,
	},

	// ============================================
	// AUTOMATE - Extending Kilo
	// ============================================
	{
		source: "/docs/advanced-usage/local-models",
		destination: "/docs/automate/extending/local-models",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/features/shell-integration",
		destination: "/docs/automate/extending/shell-integration",
		basePath: false,
		permanent: true,
	},

	// ============================================
	// AUTOMATE - MCP
	// ============================================
	{
		source: "/docs/features/mcp/overview",
		destination: "/docs/automate/mcp/overview",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/features/mcp/using-mcp-in-kilo-code",
		destination: "/docs/automate/mcp/using-in-kilo-code",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/features/mcp/using-mcp-in-cli",
		destination: "/docs/automate/mcp/using-in-cli",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/features/mcp/what-is-mcp",
		destination: "/docs/automate/mcp/what-is-mcp",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/features/mcp/server-transports",
		destination: "/docs/automate/mcp/server-transports",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/features/mcp/mcp-vs-api",
		destination: "/docs/automate/mcp/mcp-vs-api",
		basePath: false,
		permanent: true,
	},

	// ============================================
	// DEPLOY & SECURE
	// ============================================
	{
		source: "/docs/advanced-usage/deploy",
		destination: "/docs/deploy-secure/deploy",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/advanced-usage/managed-indexing",
		destination: "/docs/deploy-secure/managed-indexing",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/contributing/architecture/security-reviews",
		destination: "/docs/deploy-secure/security-reviews",
		basePath: false,
		permanent: true,
	},

	// ============================================
	// CONTRIBUTING
	// ============================================
	{
		source: "/docs/contributing/index",
		destination: "/docs/contributing",
		basePath: false,
		permanent: true,
	},

	// ============================================
	// CONTRIBUTING - Architecture
	// ============================================
	{
		source: "/docs/contributing/architecture/index",
		destination: "/docs/contributing/architecture",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/contributing/architecture/onboarding-engagement-improvements",
		destination: "/docs/contributing/architecture/onboarding-improvements",
		basePath: false,
		permanent: true,
	},

	// ============================================
	// PAGES TO CONDENSE (Redirects to parent pages)
	// ============================================
	{
		source: "/docs/features/system-notifications",
		destination: "/docs/getting-started/settings",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/features/suggested-responses",
		destination: "/docs/code-with-ai/agents/chat-interface",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/basic-usage/how-tools-work",
		destination: "/docs/automate/how-tools-work",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/features/auto-approving-actions",
		destination: "/docs/getting-started/settings",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/advanced-usage/auto-cleanup",
		destination: "/docs/getting-started/settings",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/features/model-temperature",
		destination: "/docs/code-with-ai/agents/model-selection",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/advanced-usage/rate-limits-costs",
		destination: "/docs/getting-started/adding-credits",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/advanced-usage/free-and-budget-models",
		destination: "/docs/code-with-ai/agents/free-and-budget-models",
		basePath: false,
		permanent: true,
	},

	// ============================================
	// AUTOMATE - Tools Reference
	// ============================================
	{
		source: "/docs/features/tools/tool-use-overview",
		destination: "/docs/automate/tools",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/features/tools/access-mcp-resource",
		destination: "/docs/automate/tools/access-mcp-resource",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/features/tools/apply-diff",
		destination: "/docs/automate/tools/apply-diff",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/features/tools/ask-followup-question",
		destination: "/docs/automate/tools/ask-followup-question",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/features/tools/attempt-completion",
		destination: "/docs/automate/tools/attempt-completion",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/features/tools/browser-action",
		destination: "/docs/automate/tools/browser-action",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/features/tools/delete-file",
		destination: "/docs/automate/tools/delete-file",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/features/tools/execute-command",
		destination: "/docs/automate/tools/execute-command",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/features/tools/list-code-definition-names",
		destination: "/docs/automate/tools/list-code-definition-names",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/features/tools/list-files",
		destination: "/docs/automate/tools/list-files",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/features/tools/new-task",
		destination: "/docs/automate/tools/new-task",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/features/tools/read-file",
		destination: "/docs/automate/tools/read-file",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/features/tools/search-files",
		destination: "/docs/automate/tools/search-files",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/features/tools/switch-mode",
		destination: "/docs/automate/tools/switch-mode",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/features/tools/update-todo-list",
		destination: "/docs/automate/tools/update-todo-list",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/features/tools/use-mcp-tool",
		destination: "/docs/automate/tools/use-mcp-tool",
		basePath: false,
		permanent: true,
	},
	{
		source: "/docs/features/tools/write-to-file",
		destination: "/docs/automate/tools/write-to-file",
		basePath: false,
		permanent: true,
	},
]

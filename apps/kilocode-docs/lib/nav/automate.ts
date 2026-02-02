import { NavSection } from "../types"

export const AutomateNav: NavSection[] = [
	{
		title: "Agents",
		links: [
			{ href: "/automate", children: "Overview" },
			{ href: "/automate/integrations", children: "Integrations" },
			{ href: "/automate/code-reviews", children: "Code Reviews" },
			{ href: "/automate/agent-manager", children: "Agent Manager" },
		],
	},
	{
		title: "Extending Kilo",
		links: [
			{ href: "/automate/extending/local-models", children: "Local Models" },
			{
				href: "/automate/extending/shell-integration",
				children: "Shell Integration",
			},
			{
				href: "/automate/extending/auto-launch",
				children: "Auto-launch Configuration",
			},
		],
	},
	{
		title: "MCP",
		links: [
			{ href: "/automate/mcp/overview", children: "MCP Overview" },
			{
				href: "/automate/mcp/using-in-kilo-code",
				children: "Using MCP in Kilo Code",
			},
			{ href: "/automate/mcp/using-in-cli", children: "Using MCP in CLI" },
			{ href: "/automate/mcp/what-is-mcp", children: "What is MCP" },
			{
				href: "/automate/mcp/server-transports",
				children: "Server Transports",
			},
			{ href: "/automate/mcp/mcp-vs-api", children: "MCP vs API" },
		],
	},
	{
		title: "Tools",
		links: [
			{ href: "/automate/how-tools-work", children: "How Tools Work" },
			{ href: "/automate/tools", children: "Tools Details" },
		],
	},
]

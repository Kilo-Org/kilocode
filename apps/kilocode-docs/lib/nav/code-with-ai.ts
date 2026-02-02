import { NavSection } from "../types"

export const CodeWithAiNav: NavSection[] = [
	{
		title: "Platforms",
		links: [
			{ href: "/code-with-ai", children: "Overview" },
			{ href: "/code-with-ai/platforms/vscode", children: "VS Code Extension" },
			{
				href: "/code-with-ai/platforms/jetbrains",
				children: "JetBrains Extension",
			},
			{ href: "/code-with-ai/platforms/cli", children: "CLI" },
			{ href: "/code-with-ai/platforms/cloud-agent", children: "Cloud Agent" },
			{ href: "/code-with-ai/platforms/mobile", children: "Mobile Apps" },
			{ href: "/code-with-ai/platforms/slack", children: "Slack" },
			{ href: "/code-with-ai/app-builder", children: "App Builder" },
		],
	},
	{
		title: "Working with Agents",
		links: [
			{
				href: "/code-with-ai/agents/chat-interface",
				children: "The Chat Interface",
			},
			{
				href: "/code-with-ai/agents/context-mentions",
				children: "Context & Mentions",
			},
			{ href: "/code-with-ai/agents/using-modes", children: "Using Modes" },
			{
				href: "/code-with-ai/agents/orchestrator-mode",
				children: "Orchestrator Mode",
			},
			{
				href: "/code-with-ai/agents/model-selection",
				children: "Model Selection",
			},
			{
				href: "/code-with-ai/agents/free-and-budget-models",
				children: "Free & Budget Models",
			},
		],
	},
	{
		title: "Features",
		links: [
			{
				href: "/code-with-ai/features/autocomplete",
				children: "Autocomplete",
				subLinks: [{ href: "/code-with-ai/features/autocomplete/mistral-setup", children: "Mistral Setup" }],
			},
			{ href: "/code-with-ai/features/code-actions", children: "Code Actions" },
			{ href: "/code-with-ai/features/browser-use", children: "Browser Use" },
			{
				href: "/code-with-ai/features/git-commit-generation",
				children: "Git Commit Generation",
			},
			{ href: "/code-with-ai/features/checkpoints", children: "Checkpoints" },
			{
				href: "/code-with-ai/features/enhance-prompt",
				children: "Enhance Prompt",
			},
			{ href: "/code-with-ai/features/fast-edits", children: "Fast Edits" },
			{
				href: "/code-with-ai/features/task-todo-list",
				children: "Task Todo List",
			},
			{ href: "/code-with-ai/features/speech-to-text", children: "Voice Transcription" },
		],
	},
]

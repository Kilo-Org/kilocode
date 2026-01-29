import { NavSection } from "../types"

export const AiProvidersNav: NavSection[] = [
	{
		title: "AI Providers",
		links: [
			{ href: "/ai-providers", children: "Overview" },
			{ href: "/ai-providers/kilocode", children: "Kilo Code (Default)" },
		],
	},
	{
		title: "AI Labs",
		links: [
			{ href: "/ai-providers/anthropic", children: "Anthropic" },
			{ href: "/ai-providers/claude-code", children: "Claude Code" },
			{ href: "/ai-providers/openai", children: "OpenAI" },
			{
				href: "/ai-providers/openai-chatgpt-plus-pro",
				children: "ChatGPT Plus/Pro",
			},
			{ href: "/ai-providers/gemini", children: "Google Gemini" },
			{ href: "/ai-providers/mistral", children: "Mistral AI" },
			{ href: "/ai-providers/deepseek", children: "DeepSeek" },
			{ href: "/ai-providers/xai", children: "xAI (Grok)" },
		],
	},
	{
		title: "AI Gateways",
		links: [
			{ href: "/ai-providers/openrouter", children: "OpenRouter" },
			{ href: "/ai-providers/glama", children: "Glama" },
			{ href: "/ai-providers/requesty", children: "Requesty" },
			{ href: "/ai-providers/unbound", children: "Unbound" },
			{
				href: "/ai-providers/vercel-ai-gateway",
				children: "Vercel AI Gateway",
			},
		],
	},
	{
		title: "Cloud Providers",
		links: [
			{ href: "/ai-providers/vertex", children: "Google Vertex AI" },
			{ href: "/ai-providers/bedrock", children: "AWS Bedrock" },
			{ href: "/ai-providers/groq", children: "Groq" },
			{ href: "/ai-providers/cerebras", children: "Cerebras" },
			{ href: "/ai-providers/fireworks", children: "Fireworks AI" },
		],
	},
	{
		title: "Local & Self-Hosted",
		links: [
			{ href: "/ai-providers/ollama", children: "Ollama" },
			{ href: "/ai-providers/lmstudio", children: "LM Studio" },
			{ href: "/ai-providers/vscode-lm", children: "VS Code LM API" },
			{
				href: "/ai-providers/openai-compatible",
				children: "OpenAI Compatible",
			},
		],
	},
	{
		title: "Other Providers",
		links: [
			{ href: "/ai-providers/chutes-ai", children: "Chutes AI" },
			{ href: "/ai-providers/inception", children: "Inception" },
			{ href: "/ai-providers/minimax", children: "MiniMax" },
			{ href: "/ai-providers/moonshot", children: "Moonshot" },
			{ href: "/ai-providers/ovhcloud", children: "OVHcloud" },
			{ href: "/ai-providers/sap-ai-core", children: "SAP AI Core" },
		],
	},
	{
		title: "Special Modes",
		links: [
			{ href: "/ai-providers/v0", children: "v0" },
			{ href: "/ai-providers/human-relay", children: "Human Relay" },
			{ href: "/ai-providers/synthetic", children: "Synthetic Provider" },
			{
				href: "/ai-providers/virtual-quota-fallback",
				children: "Virtual Quota Fallback",
			},
		],
	},
]

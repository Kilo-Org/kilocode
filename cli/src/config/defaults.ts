import type { CLIConfig, AutoApprovalConfig } from "./types.js"

/**
 * Default auto approval configuration
 * Matches the defaults from the webview settings
 */
export const DEFAULT_AUTO_APPROVAL: AutoApprovalConfig = {
	enabled: true,
	read: {
		enabled: true,
		outside: true,
	},
	write: {
		enabled: true,
		outside: true,
		protected: false,
	},
	browser: {
		enabled: false,
	},
	retry: {
		enabled: false,
		delay: 10,
	},
	mcp: {
		enabled: true,
	},
	mode: {
		enabled: true,
	},
	subtasks: {
		enabled: true,
	},
	execute: {
		enabled: true,
		allowed: ["ls", "cat", "echo", "pwd"],
		denied: ["rm -rf", "sudo rm", "mkfs", "dd if="],
	},
	question: {
		enabled: false,
		timeout: 60,
	},
	todo: {
		enabled: true,
	},
}

export const DEFAULT_CONFIG: CLIConfig = {
	version: "1.0.0",
	mode: "code",
	telemetry: true,
	provider: "default",
	providers: [
		{
			id: "default",
			provider: "kilocode",
			kilocodeToken: "",
			kilocodeModel: "anthropic/claude-sonnet-4.5",
		},
	],
	autoApproval: DEFAULT_AUTO_APPROVAL,
	theme: "dark",
}

export function createDefaultProvider(provider: string): any {
	switch (provider) {
		case "kilocode":
			return {
				id: "kilocode-default",
				provider: "kilocode",
				kilocodeToken: "",
				kilocodeModel: "anthropic/claude-sonnet-4",
			}
		case "anthropic":
			return {
				id: "anthropic-default",
				provider: "anthropic",
				apiKey: "",
				apiModelId: "claude-3-5-sonnet-20241022",
			}
		case "openai-native":
			return {
				id: "openai-default",
				provider: "openai-native",
				openAiNativeApiKey: "",
				apiModelId: "gpt-4o",
			}
		case "openrouter":
			return {
				id: "openrouter-default",
				provider: "openrouter",
				openRouterApiKey: "",
				openRouterModelId: "anthropic/claude-3-5-sonnet",
			}
		case "ollama":
			return {
				id: "ollama-default",
				provider: "ollama",
				ollamaBaseUrl: "http://localhost:11434",
				ollamaModelId: "llama3.2",
			}
		case "openai":
			return {
				id: "openai-default",
				provider: "openai",
				openAiApiKey: "",
				openAiBaseUrl: "",
				apiModelId: "gpt-4o",
			}
		default:
			return {
				id: `${provider}-default`,
				provider,
			}
	}
}

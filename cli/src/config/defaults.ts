import type { CLIConfig, AutoApprovalConfig } from "./types.js"

/**
 * Default auto approval configuration
 * Matches the defaults from the webview settings
 */
export const DEFAULT_AUTO_APPROVAL: AutoApprovalConfig = {
	enabled: true,
	read: {
		enabled: true,
		outside: false,
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

export const DEFAULT_CONFIG = {
	version: "1.0.0",
	mode: "code",
	telemetry: true,
	provider: "default",
	providers: [
		{
			id: "default",
			provider: "kilocode",
			kilocodeToken: "",
			kilocodeModel: "x-ai/grok-code-fast-1",
		},
	],
	autoApproval: DEFAULT_AUTO_APPROVAL,
	theme: "dark",
	customThemes: {},
} satisfies CLIConfig

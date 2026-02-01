import type { CLIConfig, AutoApprovalConfig } from "./types.js"
import type { BudgetConfig } from "../services/budget/types.js"

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

/**
 * Default budget configuration
 * Tracks daily/weekly/monthly spend with configurable limits
 */
export const DEFAULT_BUDGET_CONFIG: BudgetConfig = {
	enabled: true,
	daily: {
		enabled: true,
		limit: 10.0,
	},
	weekly: {
		enabled: true,
		limit: 50.0,
	},
	monthly: {
		enabled: true,
		limit: 200.0,
	},
	warningThresholds: [0.5, 0.75, 0.9],
	actionAtLimit: "warn",
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
	budget: DEFAULT_BUDGET_CONFIG,
	theme: "dark",
	customThemes: {},
} satisfies CLIConfig

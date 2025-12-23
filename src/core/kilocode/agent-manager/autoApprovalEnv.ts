/**
 * Helper functions for passing auto-approval configuration to CLI processes
 * via environment variables.
 *
 * This enables Agent Manager sessions to respect the same permission settings
 * as the main sidebar, rather than always running in YOLO mode.
 */

import type { ExtensionState } from "../../../shared/ExtensionMessage"

/**
 * Environment variable name for passing auto-approval config to CLI
 */
export const KILO_AUTO_APPROVAL_ENV_KEY = "KILO_AUTO_APPROVAL_JSON"

/**
 * Auto-approval configuration structure that matches CLI's AutoApprovalConfig type
 */
export interface AutoApprovalEnvConfig {
	enabled: boolean
	read?: { enabled?: boolean; outside?: boolean }
	write?: { enabled?: boolean; outside?: boolean; protected?: boolean }
	browser?: { enabled?: boolean }
	retry?: { enabled?: boolean; delay?: number }
	mcp?: { enabled?: boolean }
	mode?: { enabled?: boolean }
	subtasks?: { enabled?: boolean }
	execute?: { enabled?: boolean; allowed?: string[]; denied?: string[] }
	question?: { enabled?: boolean; timeout?: number }
	todo?: { enabled?: boolean }
}

/**
 * Extract auto-approval configuration from extension state.
 * This maps the extension's state properties to the CLI's config format.
 */
export function extractAutoApprovalConfig(
	state: Pick<
		ExtensionState,
		| "autoApprovalEnabled"
		| "alwaysAllowReadOnly"
		| "alwaysAllowReadOnlyOutsideWorkspace"
		| "alwaysAllowWrite"
		| "alwaysAllowWriteOutsideWorkspace"
		| "alwaysAllowWriteProtected"
		| "alwaysAllowBrowser"
		| "alwaysApproveResubmit"
		| "requestDelaySeconds"
		| "alwaysAllowMcp"
		| "alwaysAllowModeSwitch"
		| "alwaysAllowSubtasks"
		| "alwaysAllowExecute"
		| "allowedCommands"
		| "deniedCommands"
		| "alwaysAllowFollowupQuestions"
		| "followupAutoApproveTimeoutMs"
		| "alwaysAllowUpdateTodoList"
	>,
): AutoApprovalEnvConfig {
	return {
		enabled: state.autoApprovalEnabled ?? false,
		read: {
			enabled: state.alwaysAllowReadOnly ?? false,
			outside: state.alwaysAllowReadOnlyOutsideWorkspace ?? false,
		},
		write: {
			enabled: state.alwaysAllowWrite ?? false,
			outside: state.alwaysAllowWriteOutsideWorkspace ?? false,
			protected: state.alwaysAllowWriteProtected ?? false,
		},
		browser: {
			enabled: state.alwaysAllowBrowser ?? false,
		},
		retry: {
			enabled: state.alwaysApproveResubmit ?? false,
			delay: state.requestDelaySeconds ?? 10,
		},
		mcp: {
			enabled: state.alwaysAllowMcp ?? false,
		},
		mode: {
			enabled: state.alwaysAllowModeSwitch ?? false,
		},
		subtasks: {
			enabled: state.alwaysAllowSubtasks ?? false,
		},
		execute: {
			enabled: state.alwaysAllowExecute ?? false,
			allowed: state.allowedCommands ?? [],
			denied: state.deniedCommands ?? [],
		},
		question: {
			enabled: state.alwaysAllowFollowupQuestions ?? false,
			timeout: state.followupAutoApproveTimeoutMs ?? 60000,
		},
		todo: {
			enabled: state.alwaysAllowUpdateTodoList ?? false,
		},
	}
}

/**
 * Build environment variables for passing auto-approval config to CLI.
 * Returns an object with KILO_AUTO_APPROVAL_JSON set to the JSON-encoded config.
 */
export function buildAutoApprovalEnv(config: AutoApprovalEnvConfig): Record<string, string> {
	return {
		[KILO_AUTO_APPROVAL_ENV_KEY]: JSON.stringify(config),
	}
}

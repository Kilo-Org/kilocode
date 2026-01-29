/**
 * Hooks module
 * Claude Code compatible lifecycle hooks for Kilo CLI
 */

// Config loading and merging
export {
	loadHooks,
	mergeHooksConfigs,
	getHooksForEvent,
	getProjectConfigPath,
	GLOBAL_CONFIG_DIR,
	GLOBAL_CONFIG_FILE,
} from "./config.js"

// Hook execution
export {
	runHooks,
	runPreToolUseHooks,
	runPostToolUseHooks,
	runPermissionRequestHooks,
	runUserPromptSubmitHooks,
	runNotificationHooks,
	runStopHooks,
	runPreCompactHooks,
	runSessionStartHooks,
	runSessionEndHooks,
	matchesPattern,
	type HookEventResult,
} from "./runner.js"

// Re-export types for convenience
export type {
	HookEvent,
	HooksConfig,
	HookMatcher,
	HookCommand,
	HookInput,
	HookResult,
	HookDecision,
} from "../config/types.js"

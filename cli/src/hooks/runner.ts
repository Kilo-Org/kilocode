/**
 * Hooks execution runner
 * Executes hooks with Claude Code compatible matching and decision handling
 */

import { spawn } from "child_process"
import type {
	HooksConfig,
	HookMatcher,
	HookCommand,
	HookEvent,
	HookInput,
	HookResult,
	HookDecision,
} from "../config/types.js"
import { getHooksForEvent } from "./config.js"
import { logs } from "../services/logs.js"

/** Default timeout for hook execution (30 seconds) */
const DEFAULT_HOOK_TIMEOUT = 30000

/**
 * Exit code that blocks the operation (Claude Code compatible)
 * Exit code 2 means "block this operation"
 */
const BLOCK_EXIT_CODE = 2

/**
 * Result of running hooks for an event
 */
export interface HookEventResult {
	/** Whether any hook blocked the operation */
	blocked: boolean
	/** Reason for blocking (from hook decision or stderr) */
	blockReason?: string
	/** All individual hook results */
	results: HookResult[]
	/** Aggregated decision from hooks */
	decision?: HookDecision
}

/**
 * Check if a matcher pattern matches the given target
 *
 * @param pattern - Matcher pattern (empty/"*" matches all, "|" for OR)
 * @param target - Target string to match against
 * @returns Whether the pattern matches the target
 */
export function matchesPattern(pattern: string, target: string): boolean {
	// Empty string or "*" matches everything
	if (pattern === "" || pattern === "*") {
		return true
	}

	// Check for pipe-separated patterns (OR matching)
	if (pattern.includes("|")) {
		const patterns = pattern.split("|").map((p) => p.trim())
		return patterns.some((p) => matchesPattern(p, target))
	}

	// Exact match (case-sensitive)
	return pattern === target
}

/**
 * Find all matching hooks for a given target
 */
function findMatchingHooks(matchers: HookMatcher[], target: string): HookCommand[] {
	const matchingHooks: HookCommand[] = []

	for (const matcher of matchers) {
		if (matchesPattern(matcher.matcher, target)) {
			matchingHooks.push(...matcher.hooks)
		}
	}

	return matchingHooks
}

/**
 * Execute a single hook command
 *
 * @param hook - Hook command to execute
 * @param input - Input data to pass via stdin as JSON
 * @returns Hook execution result
 */
async function executeHookCommand(hook: HookCommand, input: HookInput): Promise<HookResult> {
	const timeout = hook.timeout ?? DEFAULT_HOOK_TIMEOUT

	return new Promise((resolve) => {
		const startTime = Date.now()

		try {
			// Spawn shell process
			const child = spawn(hook.command, [], {
				shell: true,
				stdio: ["pipe", "pipe", "pipe"],
				timeout,
			})

			let stdout = ""
			let stderr = ""
			let resolved = false

			const resolveOnce = (result: HookResult) => {
				if (!resolved) {
					resolved = true
					resolve(result)
				}
			}

			// Collect stdout
			child.stdout?.on("data", (data: Buffer) => {
				stdout += data.toString()
			})

			// Collect stderr
			child.stderr?.on("data", (data: Buffer) => {
				stderr += data.toString()
			})

			// Handle process completion
			child.on("close", (code) => {
				const exitCode = code ?? 0
				const duration = Date.now() - startTime

				logs.debug(`Hook completed`, "HooksRunner", {
					command: hook.command.substring(0, 50),
					exitCode,
					duration,
					stdoutLength: stdout.length,
					stderrLength: stderr.length,
				})

				// Try to parse stdout as JSON decision
				let decision: HookDecision | undefined
				if (stdout.trim()) {
					try {
						const parsed = JSON.parse(stdout.trim())
						if (typeof parsed === "object" && parsed !== null) {
							decision = parsed as HookDecision
						}
					} catch {
						// Not valid JSON, that's fine
					}
				}

				resolveOnce({
					exitCode,
					stdout,
					stderr,
					...(decision ? { decision } : {}),
				})
			})

			// Handle errors
			child.on("error", (error) => {
				logs.error(`Hook execution error`, "HooksRunner", {
					command: hook.command.substring(0, 50),
					error: error.message,
				})

				resolveOnce({
					exitCode: 1,
					stdout,
					stderr: stderr + `\nError: ${error.message}`,
				})
			})

			// Set up timeout handler
			const timeoutId = setTimeout(() => {
				if (!resolved) {
					logs.warn(`Hook timed out`, "HooksRunner", {
						command: hook.command.substring(0, 50),
						timeout,
					})

					child.kill("SIGTERM")

					resolveOnce({
						exitCode: 124, // Standard timeout exit code
						stdout,
						stderr: stderr + `\nHook timed out after ${timeout}ms`,
					})
				}
			}, timeout)

			child.on("close", () => {
				clearTimeout(timeoutId)
			})

			// Write input to stdin and close
			const inputJson = JSON.stringify(input)
			child.stdin?.write(inputJson)
			child.stdin?.end()
		} catch (error) {
			logs.error(`Failed to spawn hook process`, "HooksRunner", {
				command: hook.command.substring(0, 50),
				error: error instanceof Error ? error.message : String(error),
			})

			resolve({
				exitCode: 1,
				stdout: "",
				stderr: `Failed to execute hook: ${error instanceof Error ? error.message : String(error)}`,
			})
		}
	})
}

/**
 * Run all hooks for an event
 *
 * @param hooks - Hooks configuration
 * @param event - Hook event type
 * @param target - Target to match against (e.g., tool name)
 * @param input - Input data to pass to hooks
 * @returns Combined result of all hook executions
 */
export async function runHooks(
	hooks: HooksConfig,
	event: HookEvent,
	target: string,
	input: Omit<HookInput, "hook_event">,
): Promise<HookEventResult> {
	const matchers = getHooksForEvent(hooks, event)

	if (matchers.length === 0) {
		return {
			blocked: false,
			results: [],
		}
	}

	// Find all hooks that match the target
	const matchingHooks = findMatchingHooks(matchers, target)

	if (matchingHooks.length === 0) {
		return {
			blocked: false,
			results: [],
		}
	}

	logs.debug(`Running ${matchingHooks.length} hooks for ${event}`, "HooksRunner", {
		target,
	})

	// Build full input with event type
	const fullInput: HookInput = {
		...input,
		hook_event: event,
	}

	// Execute hooks in order
	const results: HookResult[] = []
	let blocked = false
	let blockReason: string | undefined
	let aggregatedDecision: HookDecision | undefined

	for (const hook of matchingHooks) {
		const result = await executeHookCommand(hook, fullInput)
		results.push(result)

		// Check for blocking conditions:
		// 1. Exit code 2 (Claude Code convention)
		// 2. JSON decision with permissionDecision: "deny"
		if (result.exitCode === BLOCK_EXIT_CODE) {
			blocked = true
			blockReason = result.decision?.permissionDecisionReason || result.stderr.trim() || "Blocked by hook"

			logs.info(`Hook blocked operation`, "HooksRunner", {
				event,
				target,
				reason: blockReason,
			})
		}

		if (result.decision?.permissionDecision === "deny") {
			blocked = true
			blockReason = result.decision.permissionDecisionReason || "Denied by hook"
			aggregatedDecision = result.decision

			logs.info(`Hook denied permission`, "HooksRunner", {
				event,
				target,
				reason: blockReason,
			})
		}

		// If any hook blocks, we can optionally continue or stop
		// For now, we continue to collect all results but mark as blocked
	}

	return {
		blocked,
		...(blockReason ? { blockReason } : {}),
		results,
		...(aggregatedDecision ? { decision: aggregatedDecision } : {}),
	}
}

/**
 * Run PreToolUse hooks
 * Returns whether the tool should be blocked
 */
export async function runPreToolUseHooks(
	hooks: HooksConfig,
	toolName: string,
	toolInput: Record<string, unknown>,
	context: { workspace?: string; session_id?: string },
): Promise<HookEventResult> {
	return runHooks(hooks, "PreToolUse", toolName, {
		tool_name: toolName,
		tool_input: toolInput,
		workspace: context.workspace,
		session_id: context.session_id,
	})
}

/**
 * Run PostToolUse hooks
 */
export async function runPostToolUseHooks(
	hooks: HooksConfig,
	toolName: string,
	toolInput: Record<string, unknown>,
	toolOutput: unknown,
	context: { workspace?: string; session_id?: string },
): Promise<HookEventResult> {
	return runHooks(hooks, "PostToolUse", toolName, {
		tool_name: toolName,
		tool_input: toolInput,
		tool_output: toolOutput,
		workspace: context.workspace,
		session_id: context.session_id,
	})
}

/**
 * Run PermissionRequest hooks
 */
export async function runPermissionRequestHooks(
	hooks: HooksConfig,
	permissionType: string,
	details: Record<string, unknown>,
	context: { workspace?: string; session_id?: string },
): Promise<HookEventResult> {
	return runHooks(hooks, "PermissionRequest", permissionType, {
		tool_name: permissionType,
		tool_input: details,
		workspace: context.workspace,
		session_id: context.session_id,
	})
}

/**
 * Run UserPromptSubmit hooks
 */
export async function runUserPromptSubmitHooks(
	hooks: HooksConfig,
	prompt: string,
	context: { workspace?: string; session_id?: string },
): Promise<HookEventResult> {
	return runHooks(hooks, "UserPromptSubmit", "", {
		prompt,
		workspace: context.workspace,
		session_id: context.session_id,
	})
}

/**
 * Run Notification hooks
 */
export async function runNotificationHooks(
	hooks: HooksConfig,
	notificationType: string,
	details: Record<string, unknown>,
	context: { workspace?: string; session_id?: string },
): Promise<HookEventResult> {
	return runHooks(hooks, "Notification", notificationType, {
		tool_name: notificationType,
		tool_input: details,
		workspace: context.workspace,
		session_id: context.session_id,
	})
}

/**
 * Run Stop hooks (when agent finishes responding)
 */
export async function runStopHooks(
	hooks: HooksConfig,
	reason: string,
	context: { workspace?: string; session_id?: string },
): Promise<HookEventResult> {
	return runHooks(hooks, "Stop", reason, {
		tool_name: reason,
		workspace: context.workspace,
		session_id: context.session_id,
	})
}

/**
 * Run PreCompact hooks
 */
export async function runPreCompactHooks(
	hooks: HooksConfig,
	context: { workspace?: string; session_id?: string; taskId?: string },
): Promise<HookEventResult> {
	return runHooks(hooks, "PreCompact", "", {
		workspace: context.workspace,
		session_id: context.session_id,
		task_id: context.taskId,
	})
}

/**
 * Run SessionStart hooks
 */
export async function runSessionStartHooks(
	hooks: HooksConfig,
	context: { workspace?: string; session_id?: string; isResume?: boolean },
): Promise<HookEventResult> {
	return runHooks(hooks, "SessionStart", context.isResume ? "resume" : "start", {
		workspace: context.workspace,
		session_id: context.session_id,
		is_resume: context.isResume,
	})
}

/**
 * Run SessionEnd hooks
 */
export async function runSessionEndHooks(
	hooks: HooksConfig,
	context: { workspace?: string; session_id?: string; reason?: string },
): Promise<HookEventResult> {
	return runHooks(hooks, "SessionEnd", context.reason || "exit", {
		workspace: context.workspace,
		session_id: context.session_id,
		reason: context.reason,
	})
}

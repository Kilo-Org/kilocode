/**
 * Approval Decision Service
 *
 * Pure function service that determines what action to take for approval requests.
 * This centralizes all approval decision logic that was previously scattered across
 * multiple components and hooks.
 *
 * @module approvalDecision
 */

import type { ExtensionChatMessage } from "../types/messages.js"
import type { AutoApprovalConfig } from "../config/types.js"
import { CI_MODE_MESSAGES } from "../constants/ci.js"
import { logs } from "./logs.js"

/**
 * Result of an approval decision
 */
export interface ApprovalDecision {
	/** The action to take */
	action: "auto-approve" | "auto-reject" | "manual"
	/** Delay in milliseconds before executing (for retries) */
	delay?: number
	/** Message to send with the response (for CI mode rejections) */
	message?: string
}

/**
 * Helper function to check if a command matches allowed/denied patterns
 * Supports hierarchical matching:
 * - "git" matches "git status", "git commit", etc.
 * - "git status" matches "git status --short", "git status -v", etc.
 * - Exact match: "git status --short" only matches "git status --short"
 */
function matchesCommandPattern(command: string, patterns: string[]): boolean {
	if (patterns.length === 0) return false

	const normalizedCommand = command.trim()

	return patterns.some((pattern) => {
		const normalizedPattern = pattern.trim()

		// Wildcard matches everything
		if (normalizedPattern === "*") return true

		// Exact match
		if (normalizedPattern === normalizedCommand) return true

		// Hierarchical match: pattern is a prefix of the command
		// Must match word boundaries to avoid false positives
		// e.g., "git" matches "git status" but not "gitignore"
		if (normalizedCommand.startsWith(normalizedPattern)) {
			// Check if it's followed by whitespace or end of string
			const nextChar = normalizedCommand[normalizedPattern.length]
			return nextChar === undefined || nextChar === " " || nextChar === "\t"
		}

		return false
	})
}

/**
 * Determines the approval decision for a tool request
 */
function getToolApprovalDecision(
	message: ExtensionChatMessage,
	config: AutoApprovalConfig,
	isCIMode: boolean,
): ApprovalDecision {
	try {
		const toolData = JSON.parse(message.text || "{}")
		const tool = toolData.tool

		// Read operations
		if (
			tool === "readFile" ||
			tool === "listFiles" ||
			tool === "listFilesTopLevel" ||
			tool === "listFilesRecursive" ||
			tool === "searchFiles" ||
			tool === "codebaseSearch" ||
			tool === "listCodeDefinitionNames"
		) {
			const isOutsideWorkspace = toolData.isOutsideWorkspace === true
			const shouldApprove = isOutsideWorkspace ? (config.read?.outside ?? false) : (config.read?.enabled ?? false)

			if (shouldApprove) {
				return { action: "auto-approve" }
			}
			return isCIMode ? { action: "auto-reject", message: CI_MODE_MESSAGES.AUTO_REJECTED } : { action: "manual" }
		}

		// Write operations
		if (
			tool === "editedExistingFile" ||
			tool === "appliedDiff" ||
			tool === "newFileCreated" ||
			tool === "insertContent" ||
			tool === "searchAndReplace"
		) {
			const isOutsideWorkspace = toolData.isOutsideWorkspace === true
			const isProtected = toolData.isProtected === true

			let shouldApprove = false
			if (isProtected) {
				shouldApprove = config.write?.protected ?? false
			} else if (isOutsideWorkspace) {
				shouldApprove = config.write?.outside ?? false
			} else {
				shouldApprove = config.write?.enabled ?? false
			}

			if (shouldApprove) {
				return { action: "auto-approve" }
			}
			return isCIMode ? { action: "auto-reject", message: CI_MODE_MESSAGES.AUTO_REJECTED } : { action: "manual" }
		}

		// Browser operations
		if (tool === "browser_action") {
			if (config.browser?.enabled) {
				return { action: "auto-approve" }
			}
			return isCIMode ? { action: "auto-reject", message: CI_MODE_MESSAGES.AUTO_REJECTED } : { action: "manual" }
		}

		// MCP operations
		if (tool === "use_mcp_tool" || tool === "use_mcp_server" || tool === "access_mcp_resource") {
			if (config.mcp?.enabled) {
				return { action: "auto-approve" }
			}
			logs.warn("MCP tool rejected - mcp.enabled is false", "approvalDecision", {
				tool,
				mcpEnabled: config.mcp?.enabled,
			})
			return isCIMode ? { action: "auto-reject", message: CI_MODE_MESSAGES.AUTO_REJECTED } : { action: "manual" }
		}

		// Mode switching
		if (tool === "switchMode") {
			if (config.mode?.enabled) {
				return { action: "auto-approve" }
			}
			return isCIMode ? { action: "auto-reject", message: CI_MODE_MESSAGES.AUTO_REJECTED } : { action: "manual" }
		}

		// Subtasks
		if (tool === "newTask") {
			if (config.subtasks?.enabled) {
				return { action: "auto-approve" }
			}
			return isCIMode ? { action: "auto-reject", message: CI_MODE_MESSAGES.AUTO_REJECTED } : { action: "manual" }
		}

		// Todo list updates
		if (tool === "updateTodoList") {
			if (config.todo?.enabled) {
				return { action: "auto-approve" }
			}
			return isCIMode ? { action: "auto-reject", message: CI_MODE_MESSAGES.AUTO_REJECTED } : { action: "manual" }
		}
	} catch {
		// If we can't parse the message, don't auto-approve
		return isCIMode ? { action: "auto-reject", message: CI_MODE_MESSAGES.AUTO_REJECTED } : { action: "manual" }
	}

	// Unknown tool
	return isCIMode ? { action: "auto-reject", message: CI_MODE_MESSAGES.AUTO_REJECTED } : { action: "manual" }
}

/**
 * Determines the approval decision for a command execution request
 */
function getCommandApprovalDecision(
	message: ExtensionChatMessage,
	config: AutoApprovalConfig,
	isCIMode: boolean,
): ApprovalDecision {
	if (!config.execute?.enabled) {
		logs.debug("Command execution not enabled in config", "approvalDecision", {
			executeEnabled: config.execute?.enabled,
		})
		return isCIMode ? { action: "auto-reject", message: CI_MODE_MESSAGES.AUTO_REJECTED } : { action: "manual" }
	}

	// Parse command from message
	// It can be either JSON with a "command" field or plain text
	let command = ""
	try {
		const commandData = JSON.parse(message.text || "{}")
		command = commandData.command || ""
	} catch {
		// If parsing fails, use text directly as the command
		command = message.text || ""
	}

	const allowedCommands = config.execute?.allowed ?? []
	const deniedCommands = config.execute?.denied ?? []

	logs.info("Checking command approval", "approvalDecision", {
		command,
		rawText: message.text,
		allowedCommands,
		deniedCommands,
		executeEnabled: config.execute?.enabled,
		configExecute: config.execute,
	})

	// Check denied list first (takes precedence)
	if (matchesCommandPattern(command, deniedCommands)) {
		logs.debug("Command matches denied pattern", "approvalDecision", { command })
		return isCIMode ? { action: "auto-reject", message: CI_MODE_MESSAGES.AUTO_REJECTED } : { action: "manual" }
	}

	// If allowed list is empty, don't allow any commands
	if (allowedCommands.length === 0) {
		logs.debug("Allowed commands list is empty", "approvalDecision")
		return isCIMode ? { action: "auto-reject", message: CI_MODE_MESSAGES.AUTO_REJECTED } : { action: "manual" }
	}

	// Check if command matches allowed patterns
	if (matchesCommandPattern(command, allowedCommands)) {
		logs.info("Command matches allowed pattern - auto-approving", "approvalDecision", {
			command,
			matchedAgainst: allowedCommands,
		})
		return { action: "auto-approve" }
	}

	logs.info("Command does not match any allowed pattern", "approvalDecision", {
		command,
		allowedCommands,
		deniedCommands,
	})
	return isCIMode ? { action: "auto-reject", message: CI_MODE_MESSAGES.AUTO_REJECTED } : { action: "manual" }
}

/**
 * Determines the approval decision for a followup question
 *
 * NOTE: Follow-up questions should NOT require approval in normal operation.
 * They are handled by useFollowupCIResponse hook which sends a response (not approval).
 * This function is kept for backward compatibility and config-based auto-approval.
 */
function getFollowupApprovalDecision(
	message: ExtensionChatMessage,
	config: AutoApprovalConfig,
	isCIMode: boolean,
): ApprovalDecision {
	// In CI mode, always auto-approve followup questions with special message
	// This is handled by useFollowupCIResponse hook, but kept here for consistency
	if (isCIMode) {
		return {
			action: "auto-approve",
			message: CI_MODE_MESSAGES.FOLLOWUP_RESPONSE,
		}
	}

	// In non-CI mode, check config
	if (config.question?.enabled) {
		return { action: "auto-approve" }
	}

	return { action: "manual" }
}

/**
 * Determines the approval decision for an API retry request
 */
function getRetryApprovalDecision(
	message: ExtensionChatMessage,
	config: AutoApprovalConfig,
	isCIMode: boolean,
): ApprovalDecision {
	if (config.retry?.enabled) {
		// In CI mode, approve immediately without delay
		if (isCIMode) {
			return { action: "auto-approve" }
		}
		// In non-CI mode, apply retry delay
		return {
			action: "auto-approve",
			delay: (config.retry?.delay ?? 10) * 1000,
		}
	}

	return isCIMode ? { action: "auto-reject", message: CI_MODE_MESSAGES.AUTO_REJECTED } : { action: "manual" }
}

/**
 * Main function to determine approval decision for any message
 *
 * This is a pure function that takes a message and configuration,
 * and returns a decision about what action to take.
 *
 * @param message - The message requiring approval
 * @param config - The approval configuration
 * @param isCIMode - Whether CI mode is active
 * @param isYoloMode - Whether YOLO mode is active (auto-approve all tool permissions)
 * @returns The approval decision
 *
 * @example
 * ```typescript
 * const decision = getApprovalDecision(message, config, false, false)
 * if (decision.action === 'auto-approve') {
 *   await approve(decision.message)
 * } else if (decision.action === 'auto-reject') {
 *   await reject(decision.message)
 * } else {
 *   // Show manual approval UI
 * }
 * ```
 */
export function getApprovalDecision(
	message: ExtensionChatMessage,
	config: AutoApprovalConfig,
	isCIMode: boolean,
	isYoloMode: boolean = false,
): ApprovalDecision {
	// Only process ask messages
	if (message.type !== "ask") {
		return { action: "manual" }
	}

	// Don't process partial or already answered messages
	if (message.partial || message.isAnswered) {
		return { action: "manual" }
	}

	const askType = message.ask

	// In YOLO mode, auto-approve all tool permissions but NOT followup questions
	// Followup questions should still require user input in YOLO mode
	if (isYoloMode && askType !== "followup") {
		logs.info(`YOLO mode: Auto-approving ${askType}`, "approvalDecision")
		return { action: "auto-approve" }
	}

	switch (askType) {
		case "tool":
			return getToolApprovalDecision(message, config, isCIMode)

		case "command":
			return getCommandApprovalDecision(message, config, isCIMode)

		case "command_output":
			// Command output always requires manual approval
			// User must choose to continue (proceed with conversation) or abort (kill command)
			return { action: "manual" }

		case "followup":
			return getFollowupApprovalDecision(message, config, isCIMode)

		case "api_req_failed":
			return getRetryApprovalDecision(message, config, isCIMode)

		// Handle MCP server requests (extension uses this as ask type instead of "tool")
		case "use_mcp_server":
			if (config.mcp?.enabled) {
				return { action: "auto-approve" }
			}
			logs.warn("MCP operation rejected - mcp.enabled is false", "approvalDecision", {
				askType,
				mcpEnabled: config.mcp?.enabled,
			})
			return isCIMode ? { action: "auto-reject", message: CI_MODE_MESSAGES.AUTO_REJECTED } : { action: "manual" }

		default:
			// Unknown ask type - don't auto-approve
			logs.warn("Unknown ask type", "approvalDecision", { askType, isCIMode })
			return isCIMode ? { action: "auto-reject", message: CI_MODE_MESSAGES.AUTO_REJECTED } : { action: "manual" }
	}
}

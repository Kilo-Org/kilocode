/**
 * Message ID generation utilities for JSON schema contract
 *
 * Generates unique, deterministic message IDs for tracking messages
 * in automation workflows.
 */

import type { CliMessage } from "../../types/cli.js"
import type { ExtensionChatMessage } from "../../types/messages.js"

/**
 * Generate a short hash from string content
 */
function shortHash(str: string): string {
	let hash = 0
	for (let i = 0; i < str.length; i++) {
		const char = str.charCodeAt(i)
		hash = (hash << 5) - hash + char
		hash = hash & hash // Convert to 32-bit integer
	}
	// Convert to base36 and take last 6 characters for brevity
	return Math.abs(hash).toString(36).slice(-6).padStart(6, "0")
}

/**
 * Generate a unique message ID for a CLI message
 *
 * Format: cli-{timestamp}-{hash}
 * Uses existing id if available, otherwise generates from content
 */
export function generateCliMessageId(message: CliMessage): string {
	// Use existing id if present
	if (message.id) {
		return `cli-${message.ts}-${shortHash(message.id)}`
	}

	// Generate hash from content
	const contentHash = shortHash(message.content || message.type)
	return `cli-${message.ts}-${contentHash}`
}

/**
 * Generate a unique message ID for an extension message
 *
 * Format: ext-{timestamp}-{hash}
 * Uses stable message properties (not text) to create deterministic hash
 * that remains consistent across partial/complete streaming updates.
 */
export function generateExtensionMessageId(message: ExtensionChatMessage): string {
	// Create hash from stable message properties only (not text, which changes during streaming)
	const hashSource = [message.type, message.ask || "", message.say || ""].join("|")

	const contentHash = shortHash(hashSource)
	return `ext-${message.ts}-${contentHash}`
}

import { z } from "zod"
import { JSON_SCHEMA_VERSION } from "./events.js"

/**
 * Input message schema for --json-io mode
 *
 * Supports both versioned (v1.0.0) and legacy formats for backward compatibility.
 */

/**
 * Versioned input message schema (v1.0.0)
 *
 * Use discriminated union to enforce response field when type="response"
 */
const baseVersionedInputSchema = z.object({
	schemaVersion: z.literal(JSON_SCHEMA_VERSION),
	content: z.string().optional(),
	images: z.array(z.string()).optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
})

export const versionedInputMessageSchema = z.discriminatedUnion("type", [
	// User input
	baseVersionedInputSchema.extend({
		type: z.literal("user_input"),
	}),
	// Tool approval
	baseVersionedInputSchema.extend({
		type: z.literal("approval"),
	}),
	// Tool rejection
	baseVersionedInputSchema.extend({
		type: z.literal("rejection"),
	}),
	// Abort task
	baseVersionedInputSchema.extend({
		type: z.literal("abort"),
	}),
	// Special askResponse (retry_clicked, objectResponse, messageResponse)
	baseVersionedInputSchema.extend({
		type: z.literal("response"),
		response: z.enum(["messageResponse", "retry_clicked", "objectResponse"]), // Required for type="response"
	}),
])

/**
 * Legacy input message schema (pre-v1.0.0)
 *
 * Matches the actual format accepted by useStdinJsonHandler.
 * Examples:
 *   {"type": "askResponse", "text": "hello"}
 *   {"type": "askResponse", "askResponse": "yesButtonClicked"}
 *   {"type": "respondToApproval", "approved": true}
 *   {"type": "cancelTask"}
 */
export const legacyInputMessageSchema = z.object({
	// Message type determines how to handle
	type: z.enum(["askResponse", "respondToApproval", "cancelTask"]),

	// For askResponse: the response type or defaults to messageResponse
	askResponse: z.string().optional(),

	// User text input
	text: z.string().optional(),

	// Image attachments
	images: z.array(z.string()).optional(),

	// For respondToApproval: approval decision
	approved: z.boolean().optional(),
})

/**
 * Combined input message schema
 *
 * Accepts both versioned and legacy formats.
 * Consumers should check for schemaVersion to determine format.
 */
export const inputMessageSchema = z.union([versionedInputMessageSchema, legacyInputMessageSchema])

// Inferred types
export type VersionedInputMessage = z.infer<typeof versionedInputMessageSchema>
export type LegacyInputMessage = z.infer<typeof legacyInputMessageSchema>
export type InputMessage = z.infer<typeof inputMessageSchema>

/**
 * Check if an input message is versioned (v1.0.0)
 */
export function isVersionedInput(input: InputMessage): input is VersionedInputMessage {
	return "schemaVersion" in input && input.schemaVersion === JSON_SCHEMA_VERSION
}

/**
 * Normalize legacy input to versioned format
 */
export function normalizeInput(input: InputMessage): VersionedInputMessage {
	if (isVersionedInput(input)) {
		return input
	}

	// Convert legacy format to versioned format
	const legacy = input as LegacyInputMessage

	switch (legacy.type) {
		case "cancelTask":
			return {
				schemaVersion: JSON_SCHEMA_VERSION,
				type: "abort",
				images: legacy.images,
			}

		case "respondToApproval":
			return {
				schemaVersion: JSON_SCHEMA_VERSION,
				type: legacy.approved ? "approval" : "rejection",
				content: legacy.text,
				images: legacy.images,
			}

		case "askResponse":
			// Map common responses to semantic types
			if (legacy.askResponse === "yesButtonClicked") {
				return {
					schemaVersion: JSON_SCHEMA_VERSION,
					type: "approval",
					content: legacy.text,
					images: legacy.images,
				}
			}
			if (legacy.askResponse === "noButtonClicked") {
				return {
					schemaVersion: JSON_SCHEMA_VERSION,
					type: "rejection",
					content: legacy.text,
					images: legacy.images,
				}
			}
			// Special response types (retry_clicked, objectResponse) use response field
			if (
				legacy.askResponse === "retry_clicked" ||
				legacy.askResponse === "objectResponse" ||
				legacy.askResponse === "messageResponse"
			) {
				return {
					schemaVersion: JSON_SCHEMA_VERSION,
					type: "response",
					response: legacy.askResponse as "retry_clicked" | "objectResponse" | "messageResponse",
					content: legacy.text,
					images: legacy.images,
				}
			}
			// Unknown askResponse: treat as user input
			return {
				schemaVersion: JSON_SCHEMA_VERSION,
				type: "user_input",
				content: legacy.text ?? "",
				images: legacy.images,
			}

		default:
			return {
				schemaVersion: JSON_SCHEMA_VERSION,
				type: "user_input",
				content: "",
				images: legacy.images,
			}
	}
}

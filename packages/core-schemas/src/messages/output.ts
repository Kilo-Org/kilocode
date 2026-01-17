import { z } from "zod"
import { JSON_SCHEMA_VERSION, outputEventSchema, messageStatusSchema } from "./events.js"

/**
 * Base fields for all JSON output messages
 */
const outputMessageBaseSchema = z.object({
	schemaVersion: z.literal(JSON_SCHEMA_VERSION),
	messageId: z.string(),
	timestamp: z.number(),
	source: z.enum(["cli", "extension"]),
	event: outputEventSchema,
	status: messageStatusSchema,
})

/**
 * CLI-sourced output message schema
 *
 * Uses passthrough() to allow additional fields for backward compatibility.
 */
export const cliOutputMessageSchema = outputMessageBaseSchema
	.extend({
		source: z.literal("cli"),
		type: z.enum(["user", "assistant", "system", "error", "welcome", "empty", "requestCheckpointRestoreApproval"]),
		id: z.string(),
		content: z.string(),
		partial: z.boolean().optional(),
		metadata: z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]).optional(),
		payload: z.unknown().optional(),
	})
	.passthrough()

/**
 * Extension-sourced output message schema
 *
 * Uses passthrough() to allow additional fields for backward compatibility.
 * Explicitly declares common fields for better documentation.
 */
export const extensionOutputMessageSchema = outputMessageBaseSchema
	.extend({
		source: z.literal("extension"),
		type: z.enum(["ask", "say"]),
		ask: z.string().optional(),
		say: z.string().optional(),
		content: z.string().optional(),
		metadata: z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]).optional(),
		// Common extension fields for backward compatibility
		partial: z.boolean().optional(),
		images: z.array(z.string()).optional(),
		reasoning: z.string().optional(),
		conversationHistoryIndex: z.number().optional(),
		checkpoint: z.record(z.string(), z.unknown()).optional(),
		isProtected: z.boolean().optional(),
		apiProtocol: z.enum(["openai", "anthropic"]).optional(),
		isAnswered: z.boolean().optional(),
		progressStatus: z.unknown().optional(),
		contextCondense: z.unknown().optional(),
		contextTruncation: z.unknown().optional(),
	})
	.passthrough()

/**
 * Union of all output message types
 */
export const outputMessageSchema = z.discriminatedUnion("source", [
	cliOutputMessageSchema,
	extensionOutputMessageSchema,
])

// Inferred types
export type OutputMessageBase = z.infer<typeof outputMessageBaseSchema>
export type CliOutputMessage = z.infer<typeof cliOutputMessageSchema>
export type ExtensionOutputMessage = z.infer<typeof extensionOutputMessageSchema>
export type OutputMessage = z.infer<typeof outputMessageSchema>

/**
 * CLI Output Parser
 *
 * Parses nd-json output from the kilocode CLI, handling ANSI escape codes
 * and buffering partial lines.
 *
 * Uses the same approach as the cloud agent for handling VT control characters.
 */

import { stripVTControlCharacters } from "node:util"

export interface KilocodePayload extends Record<string, unknown> {
	type?: string
	say?: string
	ask?: string
	content?: string
	text?: string
	timestamp?: number
	metadata?: Record<string, unknown>
	partial?: boolean
	isAnswered?: boolean
}

export interface KilocodeStreamEvent {
	streamEventType: "kilocode"
	payload: KilocodePayload
	sessionId?: string
}

export interface StatusStreamEvent {
	streamEventType: "status"
	message: string
	timestamp: string
	sessionId?: string
}

export interface OutputStreamEvent {
	streamEventType: "output"
	content: string
	source: "stdout" | "stderr"
	timestamp: string
	sessionId?: string
}

export interface ErrorStreamEvent {
	streamEventType: "error"
	error: string
	details?: unknown
	timestamp: string
	sessionId?: string
}

export interface CompleteStreamEvent {
	streamEventType: "complete"
	taskId?: string
	sessionId?: string
	exitCode?: number
	metadata?: Record<string, unknown>
}

export interface InterruptedStreamEvent {
	streamEventType: "interrupted"
	reason?: string
	timestamp: string
	sessionId?: string
}

export interface SessionCreatedStreamEvent {
	streamEventType: "session_created"
	sessionId: string
	timestamp: number
}

export interface SessionTitleGeneratedStreamEvent {
	streamEventType: "session_title_generated"
	sessionId: string
	title: string
	timestamp: number
}

export interface WelcomeStreamEvent {
	streamEventType: "welcome"
	worktreeBranch?: string
	worktreePath?: string
	timestamp: number
	/** Configuration error instructions from CLI (indicates misconfigured CLI) */
	instructions?: string[]
}

export type StreamEvent =
	| KilocodeStreamEvent
	| StatusStreamEvent
	| OutputStreamEvent
	| ErrorStreamEvent
	| CompleteStreamEvent
	| InterruptedStreamEvent
	| SessionCreatedStreamEvent
	| SessionTitleGeneratedStreamEvent
	| WelcomeStreamEvent

/**
 * Result of parsing a chunk of CLI output
 */
export interface ParseResult {
	events: StreamEvent[]
	remainingBuffer: string
}

/**
 * Try to parse a line as JSON, attempting both raw and ANSI-stripped versions.
 * This matches the cloud agent's approach in streaming-helpers.ts.
 */
export function tryParseJson(line: string): Record<string, unknown> | null {
	// Try both original and VT-stripped versions
	for (const candidate of [line, stripVTControlCharacters(line)]) {
		try {
			const parsed = JSON.parse(candidate)
			if (typeof parsed === "object" && parsed !== null) {
				return parsed as Record<string, unknown>
			}
		} catch {
			// Continue to next candidate
		}
	}
	return null
}

/**
 * Parse a chunk of CLI output, handling buffering of partial lines
 *
 * @param chunk - The new chunk of data received
 * @param buffer - Any leftover data from the previous chunk
 * @returns Parsed events and remaining buffer
 */
export function parseCliChunk(chunk: string, buffer: string = ""): ParseResult {
	const events: StreamEvent[] = []

	// Combine buffer with new chunk and split by newlines
	const combined = buffer + chunk
	const lines = combined.split("\n")

	// Last element is either empty (if chunk ended with \n) or partial line
	const remainingBuffer = lines.pop() || ""

	for (const line of lines) {
		const trimmedLine = line.trim()
		if (!trimmedLine) continue

		// Try to parse as JSON (tries both raw and VT-stripped versions)
		const parsed = tryParseJson(trimmedLine)
		const event = parsed ? toStreamEvent(parsed) : null
		if (event !== null) {
			events.push(event)
			continue
		}

		// Fallback: handle concatenated JSON objects on a single line
		const cleanLine = stripVTControlCharacters(trimmedLine)
		const extracted = extractJsonObjects(cleanLine)
		if (extracted.length > 0) {
			for (const obj of extracted) {
				const extractedEvent = toStreamEvent(obj)
				if (extractedEvent !== null) {
					events.push(extractedEvent)
				}
			}
			continue
		}

		// Not JSON - treat as plain text output event
		if (cleanLine) {
			events.push(createOutputEvent(cleanLine))
		}
	}

	return { events, remainingBuffer }
}

/**
 * Stateful parser class for parsing CLI output streams
 */
export class CliOutputParser {
	private buffer: string = ""

	/**
	 * Parse a chunk of data, returning any complete events/lines
	 */
	parse(chunk: string): ParseResult {
		const result = parseCliChunk(chunk, this.buffer)
		this.buffer = result.remainingBuffer
		return result
	}

	/**
	 * Flush any remaining buffered data
	 */
	flush(): ParseResult {
		if (!this.buffer) {
			return { events: [], remainingBuffer: "" }
		}

		const trimmedBuffer = this.buffer.trim()
		this.buffer = ""

		if (!trimmedBuffer) {
			return { events: [], remainingBuffer: "" }
		}

		// Try to parse as JSON (tries both raw and VT-stripped versions)
		const parsed = tryParseJson(trimmedBuffer)
		const event = parsed ? toStreamEvent(parsed) : null
		if (event !== null) {
			return { events: [event], remainingBuffer: "" }
		}

		// Not JSON - strip VT characters before treating as plain text
		const cleanLine = stripVTControlCharacters(trimmedBuffer)
		const extracted = extractJsonObjects(cleanLine)
		if (extracted.length > 0) {
			const events = extracted
				.map((obj) => toStreamEvent(obj))
				.filter((extractedEvent): extractedEvent is StreamEvent => extractedEvent !== null)
			return { events, remainingBuffer: "" }
		}
		if (cleanLine) {
			return { events: [createOutputEvent(cleanLine)], remainingBuffer: "" }
		}

		return { events: [], remainingBuffer: "" }
	}

	/**
	 * Reset the parser state
	 */
	reset(): void {
		this.buffer = ""
	}
}

function toStreamEvent(parsed: Record<string, unknown>): StreamEvent | null {
	// New format already includes streamEventType
	const streamEventType = (parsed as { streamEventType?: unknown }).streamEventType
	if (typeof streamEventType === "string") {
		return parsed as unknown as StreamEvent
	}

	// Detect session_created event from CLI (format: { event: "session_created", sessionId: "...", timestamp: ... })
	if (parsed.event === "session_created" && typeof parsed.sessionId === "string") {
		return {
			streamEventType: "session_created",
			sessionId: parsed.sessionId as string,
			timestamp: (parsed.timestamp as number) || Date.now(),
		}
	}

	// Detect session_title_generated event from CLI (format: { event: "session_title_generated", sessionId: "...", title: "...", timestamp: ... })
	if (
		parsed.event === "session_title_generated" &&
		typeof parsed.sessionId === "string" &&
		typeof parsed.title === "string"
	) {
		return {
			streamEventType: "session_title_generated",
			sessionId: parsed.sessionId as string,
			title: parsed.title as string,
			timestamp: (parsed.timestamp as number) || Date.now(),
		}
	}

	// Detect welcome event from CLI (format: { type: "welcome", metadata: { welcomeOptions: { worktreeBranch: "...", workspace: "...", instructions: [...] } }, ... })
	if (parsed.type === "welcome") {
		const metadata = parsed.metadata as Record<string, unknown> | undefined
		const welcomeOptions = metadata?.welcomeOptions as Record<string, unknown> | undefined
		const worktreePath = (welcomeOptions?.workspace || welcomeOptions?.worktreePath) as string | undefined
		const instructions = welcomeOptions?.instructions as string[] | undefined
		return {
			streamEventType: "welcome",
			worktreeBranch: welcomeOptions?.worktreeBranch as string | undefined,
			worktreePath,
			timestamp: (parsed.timestamp as number) || Date.now(),
			instructions: Array.isArray(instructions) && instructions.length > 0 ? instructions : undefined,
		}
	}

	// Legacy format from CLI stdout: wrap parsed object as kilocode payload
	if (parsed.source === "cli") {
		return {
			streamEventType: "status",
			message: (parsed.content as string) || (parsed.type as string) || "cli",
			timestamp: new Date().toISOString(),
		}
	}

	return {
		streamEventType: "kilocode",
		payload: parsed as KilocodePayload,
	}
}

function extractJsonObjects(line: string): Record<string, unknown>[] {
	const objects: Record<string, unknown>[] = []
	let depth = 0
	let startIndex = -1
	let inString = false
	let isEscaped = false

	for (let i = 0; i < line.length; i++) {
		const ch = line[i]

		if (isEscaped) {
			isEscaped = false
			continue
		}

		if (inString) {
			if (ch === "\\") {
				isEscaped = true
			} else if (ch === '"') {
				inString = false
			}
			continue
		}

		if (ch === '"') {
			inString = true
			continue
		}

		if (ch === "{") {
			if (depth === 0) {
				startIndex = i
			}
			depth += 1
			continue
		}

		if (ch === "}") {
			depth -= 1
			if (depth === 0 && startIndex !== -1) {
				const candidate = line.slice(startIndex, i + 1)
				const parsed = tryParseJson(candidate)
				if (parsed) {
					objects.push(parsed)
				}
				startIndex = -1
			}
		}
	}

	return objects
}

function createOutputEvent(content: string): OutputStreamEvent {
	return {
		streamEventType: "output",
		content,
		source: "stdout",
		timestamp: new Date().toISOString(),
	}
}

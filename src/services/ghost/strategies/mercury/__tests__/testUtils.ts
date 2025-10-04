import * as vscode from "vscode"
import { MockTextDocument } from "../../../../mocking/MockTextDocument"

// Standard cursor marker (U+2423 OPEN BOX) - same as MercuryFileBasedTestFramework
const CURSOR_MARKER = "␣"

// Legacy cursor markers for backward compatibility
const LEGACY_MARKERS = ["<|cursor|>", "<| cursor |>"]

/**
 * Parse content with cursor marker and return document + cursor position.
 * Uses the same cursor symbol approach as the Mercury test framework.
 */
export function parseContentWithCursor(
	content: string,
	filename: string = "/test.js",
): {
	document: MockTextDocument
	cursorRange: vscode.Range
	cleanContent: string
} {
	// Find cursor marker (try standard first, then legacy)
	const allMarkers = [CURSOR_MARKER, ...LEGACY_MARKERS]
	let cursorIndex = -1
	let cursorMarker = ""

	for (const marker of allMarkers) {
		cursorIndex = content.indexOf(marker)
		if (cursorIndex !== -1) {
			cursorMarker = marker
			break
		}
	}

	if (cursorIndex === -1) {
		throw new Error(`No cursor marker found. Expected one of: ${allMarkers.join(", ")}`)
	}

	// Remove cursor marker to get clean content
	const cleanContent = content.replace(cursorMarker, "")

	// Calculate cursor position (same logic as MercuryFileBasedTestFramework)
	const beforeCursor = content.slice(0, cursorIndex)
	const lines = beforeCursor.split("\n")
	const cursorLine = lines.length - 1
	const cursorCharacter = lines[lines.length - 1].length
	const cursorPosition = new vscode.Position(cursorLine, cursorCharacter)

	// Create mock document with clean content
	const uri = vscode.Uri.file(filename)
	const document = new MockTextDocument(uri, cleanContent)
	const cursorRange = new vscode.Range(cursorPosition, cursorPosition)

	return {
		document,
		cursorRange,
		cleanContent,
	}
}

/**
 * Create content with cursor marker at specific position (for reverse operation)
 */
export function addCursorMarker(content: string, position: vscode.Position, marker: string = CURSOR_MARKER): string {
	const lines = content.split("\n")
	const targetLine = lines[position.line]

	if (!targetLine) {
		throw new Error(`Invalid cursor position: line ${position.line} doesn't exist`)
	}

	const before = targetLine.substring(0, position.character)
	const after = targetLine.substring(position.character)
	lines[position.line] = before + marker + after

	return lines.join("\n")
}

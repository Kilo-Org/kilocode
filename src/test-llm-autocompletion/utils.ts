import { GhostSuggestionContext } from "../services/ghost/types.js"
import { MockTextDocument } from "../services/mocking/MockTextDocument.js"
import * as vscode from "vscode"
import { CURSOR_MARKER } from "./test-cases.js"

/**
 * Extract file extension from test case name
 * e.g., "class-constructor.rb" -> ".rb"
 * e.g., "class-constructor" -> ".js"
 */
export function getFileExtensionFromTestName(testCaseName: string): string {
	const match = testCaseName.match(/\.([a-z]+)$/i)
	return match ? `.${match[1]}` : ".js"
}

/**
 * Map file extension to VSCode languageId
 */
export function getLanguageIdFromExtension(extension: string): string {
	const languageMap: Record<string, string> = {
		".js": "javascript",
		".ts": "typescript",
		".jsx": "javascriptreact",
		".tsx": "typescriptreact",
		".py": "python",
		".rb": "ruby",
		".java": "java",
		".go": "go",
		".rs": "rust",
		".cpp": "cpp",
		".c": "c",
		".cs": "csharp",
		".php": "php",
		".swift": "swift",
		".kt": "kotlin",
		".scala": "scala",
		".html": "html",
		".css": "css",
		".json": "json",
		".xml": "xml",
		".yaml": "yaml",
		".yml": "yaml",
		".md": "markdown",
		".sh": "shellscript",
	}
	return languageMap[extension] || "javascript"
}

/**
 * Converts test input to GhostSuggestionContext
 * Extracts cursor position from CURSOR_MARKER in the code
 */
export function createContext(code: string, testCaseName: string): GhostSuggestionContext {
	const lines = code.split("\n")
	let cursorLine = 0
	let cursorCharacter = 0

	// Find the cursor marker
	for (let i = 0; i < lines.length; i++) {
		const markerIndex = lines[i].indexOf(CURSOR_MARKER)
		if (markerIndex !== -1) {
			cursorLine = i
			cursorCharacter = markerIndex
			break
		}
	}

	// Remove the cursor marker from the code before creating the document
	// the code will add it back at the correct position
	const codeWithoutMarker = code.replace(CURSOR_MARKER, "")

	// Extract language from test case name (e.g., "class-constructor.rb" -> ".rb")
	const fileExtension = getFileExtensionFromTestName(testCaseName)
	const languageId = getLanguageIdFromExtension(fileExtension)

	const uri = vscode.Uri.parse(`file:///test${fileExtension}`)
	const document = new MockTextDocument(uri, codeWithoutMarker)
	document.languageId = languageId
	const position = new vscode.Position(cursorLine, cursorCharacter)
	const range = new vscode.Range(position, position)

	return {
		document: document as any,
		range: range as any,
	}
}

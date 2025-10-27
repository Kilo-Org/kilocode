import { describe, it, expect, beforeEach, vi } from "vitest"
import { MockWorkspace } from "./MockWorkspace"
import * as vscode from "vscode"
import { parseGhostResponse } from "../classic-auto-complete/GhostStreamingParser"
import { GhostSuggestionContext } from "../types"

vi.mock("vscode", () => ({
	Uri: {
		parse: (uriString: string) => ({
			toString: () => uriString,
			fsPath: uriString.replace("file://", ""),
			scheme: "file",
			path: uriString.replace("file://", ""),
		}),
	},
	Position: class {
		constructor(
			public line: number,
			public character: number,
		) {}
	},
	Range: class {
		constructor(
			public start: any,
			public end: any,
		) {}
	},
	WorkspaceEdit: class {
		private _edits = new Map()

		insert(uri: any, position: any, newText: string) {
			const key = uri.toString()
			if (!this._edits.has(key)) {
				this._edits.set(key, [])
			}
			this._edits.get(key).push({ range: { start: position, end: position }, newText })
		}

		delete(uri: any, range: any) {
			const key = uri.toString()
			if (!this._edits.has(key)) {
				this._edits.set(key, [])
			}
			this._edits.get(key).push({ range, newText: "" })
		}

		entries() {
			return Array.from(this._edits.entries()).map(([uriString, edits]) => [{ toString: () => uriString }, edits])
		}
	},
	workspace: {
		openTextDocument: vi.fn(),
		applyEdit: vi.fn(),
		asRelativePath: vi.fn().mockImplementation((uri) => {
			if (typeof uri === "string") {
				return uri.replace("file:///", "")
			}
			return uri.toString().replace("file:///", "")
		}),
	},
	window: {
		activeTextEditor: null,
	},
}))

describe("GhostProvider", () => {
	let mockWorkspace: MockWorkspace

	beforeEach(() => {
		vi.clearAllMocks()
		mockWorkspace = new MockWorkspace()

		vi.mocked(vscode.workspace.openTextDocument).mockImplementation(async (uri: any) => {
			const uriObj = typeof uri === "string" ? vscode.Uri.parse(uri) : uri
			return await mockWorkspace.openTextDocument(uriObj)
		})
		vi.mocked(vscode.workspace.applyEdit).mockImplementation(async (edit) => {
			await mockWorkspace.applyEdit(edit)
			return true
		})
	})

	// Helper function to set up test document and context
	async function setupTestDocument(filename: string, content: string) {
		const testUri = vscode.Uri.parse(`file://${filename}`)
		mockWorkspace.addDocument(testUri, content)
		;(vscode.window as any).activeTextEditor = {
			document: { uri: testUri },
		}

		const mockDocument = await mockWorkspace.openTextDocument(testUri)
		;(mockDocument as any).uri = testUri

		const context: GhostSuggestionContext = {
			document: mockDocument,
			openFiles: [mockDocument],
		}

		return { testUri, context, mockDocument }
	}

	describe("Error Handling", () => {
		it("should handle empty responses", async () => {
			const initialContent = `console.log('test');`
			const { context } = await setupTestDocument("empty.js", initialContent)

			// Test empty response
			const result = parseGhostResponse("", "", "", context.document, context.range)
			expect(result.suggestions.hasSuggestions()).toBe(false)
		})

		it("should handle invalid XML format", async () => {
			const initialContent = `console.log('test');`
			const { context } = await setupTestDocument("invalid.js", initialContent)

			// Test invalid XML format
			const invalidXML = "This is not a valid XML format"
			const result = parseGhostResponse(invalidXML, "", "", context.document, context.range)
			expect(result.suggestions.hasSuggestions()).toBe(false)
		})

		it("should handle file not found in context", async () => {
			const initialContent = `console.log('test');`
			const { mockDocument } = await setupTestDocument("missing.js", initialContent)

			// Create context without the file in openFiles
			const context: GhostSuggestionContext = {
				document: mockDocument,
				openFiles: [],
			}

			// Use XML format
			const xmlResponse = `<change><search><![CDATA[console.log('test');]]></search><replace><![CDATA[// Added comment
console.log('test');]]></replace></change>`

			const result = parseGhostResponse(xmlResponse, "", "", context.document, context.range)
			// Should work with the XML format
			expect(result.suggestions.hasSuggestions()).toBe(true)
		})
	})
})

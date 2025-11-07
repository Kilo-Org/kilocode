import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import * as vscode from "vscode"
import { GhostContext } from "../GhostContext"
import { GhostDocumentStore } from "../GhostDocumentStore"
import { HoleFiller } from "../classic-auto-complete/HoleFiller"
import { GhostSuggestionContext, contextToAutocompleteInput } from "../types"
import { MockTextDocument } from "../../mocking/MockTextDocument"

// Mock vscode
vi.mock("vscode", () => ({
	Uri: {
		parse: (uriString: string) => ({
			toString: () => uriString,
			fsPath: uriString.replace("file://", ""),
			scheme: "file",
			path: uriString.replace("file://", ""),
		}),
	},
	workspace: {
		asRelativePath: vi.fn().mockImplementation((uri) => {
			if (typeof uri === "string") {
				return uri.replace("file:///", "")
			}
			return uri.toString().replace("file:///", "")
		}),
		textDocuments: [], // Mock textDocuments as an empty array
	},
	window: {
		activeTextEditor: null,
	},
	languages: {
		getDiagnostics: vi.fn().mockReturnValue([]), // Mock getDiagnostics to return empty array
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
	DiagnosticSeverity: {
		Error: 0,
		Warning: 1,
		Information: 2,
		Hint: 3,
	},
}))

// Mock diff - using importOriginal as recommended in the error message
vi.mock("diff", async (importOriginal) => {
	// Create a mock module with the functions we need
	return {
		createPatch: vi.fn().mockImplementation((filePath, oldContent, newContent) => {
			return `--- a/${filePath}\n+++ b/${filePath}\n@@ -1,1 +1,1 @@\n-${oldContent}\n+${newContent}`
		}),
		structuredPatch: vi.fn().mockImplementation((oldFileName, newFileName, oldContent, newContent) => {
			return {
				hunks: [
					{
						oldStart: 1,
						oldLines: 1,
						newStart: 1,
						newLines: 1,
						lines: [`-${oldContent}`, `+${newContent}`],
					},
				],
			}
		}),
		parsePatch: vi.fn().mockReturnValue([]),
	}
})

describe("GhostRecentOperations", () => {
	let documentStore: GhostDocumentStore
	let context: GhostContext
	let holeFiller: HoleFiller
	let mockDocument: MockTextDocument

	beforeEach(() => {
		documentStore = new GhostDocumentStore()
		context = new GhostContext(documentStore)
		holeFiller = new HoleFiller()

		// Create a mock document
		const uri = vscode.Uri.parse("file:///test-file.ts")
		mockDocument = new MockTextDocument(uri, "test-content")
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	it("should include recent operations in the prompt when available", async () => {
		// Store initial document version
		await documentStore.storeDocument({ document: mockDocument, bypassDebounce: true })

		// Update document content and store again
		mockDocument.updateContent("test-content-updated")
		await documentStore.storeDocument({ document: mockDocument, bypassDebounce: true })

		// Create a suggestion context
		const suggestionContext: GhostSuggestionContext = {
			document: mockDocument,
		}

		// Generate context with recent operations
		const enrichedContext = await context.generate(suggestionContext)

		// Verify that recent operations were added to the context
		expect(enrichedContext.recentOperations).toBeDefined()
		expect(enrichedContext.recentOperations?.length).toBeGreaterThan(0)

		const autocompleteInput = contextToAutocompleteInput(enrichedContext)

		// Generate prompt
		const prefix = enrichedContext.document.getText()
		const suffix = ""
		const languageId = enrichedContext.document.languageId
		const { userPrompt } = holeFiller.getPrompts(autocompleteInput, prefix, suffix, languageId)

		// Verify that the prompt includes the recent operations section
		// The strategy system uses "<RECENT_EDITS>" XML format
		expect(userPrompt).toContain("<RECENT_EDITS>")
	})

	it("should not include recent operations in the prompt when not available", async () => {
		// Create a suggestion context without storing document history
		const suggestionContext: GhostSuggestionContext = {
			document: mockDocument,
		}

		// Generate context
		const enrichedContext = await context.generate(suggestionContext)

		const autocompleteInput = contextToAutocompleteInput(enrichedContext)

		// Generate prompt
		const prefix = enrichedContext.document.getText()
		const suffix = ""
		const languageId = enrichedContext.document.languageId
		const { userPrompt } = holeFiller.getPrompts(autocompleteInput, prefix, suffix, languageId)

		// Verify that the prompt does not include recent operations section
		// The current document content will still be in the prompt, so we should only check
		// that the "**Recent Changes (Diff):**" section is not present
		expect(userPrompt.includes("**Recent Changes (Diff):**")).toBe(false)
	})
})

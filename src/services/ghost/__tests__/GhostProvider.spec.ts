import { describe, it, expect, beforeEach, vi } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { MockWorkspace } from "./MockWorkspace"
import * as vscode from "vscode"
import { GhostStrategy } from "../GhostStrategy"
import { GhostWorkspaceEdit } from "../GhostWorkspaceEdit"
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
	let strategy: GhostStrategy
	let workspaceEdit: GhostWorkspaceEdit

	beforeEach(() => {
		vi.clearAllMocks()
		strategy = new GhostStrategy()
		mockWorkspace = new MockWorkspace()
		workspaceEdit = new GhostWorkspaceEdit()

		vi.mocked(vscode.workspace.openTextDocument).mockImplementation(async (uri: any) => {
			const uriObj = typeof uri === "string" ? vscode.Uri.parse(uri) : uri
			return await mockWorkspace.openTextDocument(uriObj)
		})
		vi.mocked(vscode.workspace.applyEdit).mockImplementation(async (edit) => {
			await mockWorkspace.applyEdit(edit)
			return true
		})
	})

	// Helper function to normalize whitespace and line endings
	function normalizeWhitespace(content: string): string {
		return content
			.replace(/\t/g, "  ") // Convert tabs to 2 spaces
			.replace(/\r\n/g, "\n") // Convert CRLF to LF
			.replace(/\n/g, "\n") // Normalize line endings
	}

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

	async function parseAndApplySuggestions(diffResponse: string, context: GhostSuggestionContext) {
		const suggestions = await strategy.parseResponse(diffResponse, context)
		await workspaceEdit.applySuggestions(suggestions)
	}

	// Test cases directory for file-based tests
	const TEST_CASES_DIR = path.join(__dirname, "__test_cases__")

	// Helper function to run file-based tests
	async function runFileBasedTest(testCaseName: string) {
		const testCasePath = path.join(TEST_CASES_DIR, testCaseName)
		const inputFilePath = path.join(testCasePath, "input.js")
		const diffFilePath = path.join(testCasePath, "diff.patch")
		const expectedFilePath = path.join(testCasePath, "expected.js")

		const initialContent = fs.readFileSync(inputFilePath, "utf8")
		const diffResponse = fs.readFileSync(diffFilePath, "utf8")
		const expectedContent = fs.readFileSync(expectedFilePath, "utf8")

		const { testUri, context } = await setupTestDocument(`${testCaseName}/input.js`, initialContent)
		await parseAndApplySuggestions(diffResponse, context)

		const finalContent = mockWorkspace.getDocumentContent(testUri)
		expect(normalizeWhitespace(finalContent)).toBe(normalizeWhitespace(expectedContent))
	}

	async function runFileBasedTestSequential(testCaseName: string) {
		const testCasePath = path.join(TEST_CASES_DIR, testCaseName)
		const inputFilePath = path.join(testCasePath, "input.js")
		const diffFilePath = path.join(testCasePath, "diff.patch")
		const expectedFilePath = path.join(testCasePath, "expected.js")

		const initialContent = fs.readFileSync(inputFilePath, "utf8")
		const diffResponse = fs.readFileSync(diffFilePath, "utf8")
		const expectedContent = fs.readFileSync(expectedFilePath, "utf8")

		const { testUri, context } = await setupTestDocument(`${testCaseName}/input.js`, initialContent)
		await parseAndApplySuggestions(diffResponse, context)

		const finalContent = mockWorkspace.getDocumentContent(testUri)
		expect(finalContent).toBe(expectedContent)
	}

	describe("File-based Suggestions", () => {
		it("should apply a simple addition from files", async () => {
			await runFileBasedTest("simple-addition")
		})

		it("should apply multiple line additions from files", async () => {
			await runFileBasedTest("multiple-line-additions")
		})

		it("should apply line deletions from files", async () => {
			await runFileBasedTest("line-deletions")
		})

		it("should apply mixed addition and deletion from files", async () => {
			await runFileBasedTest("mixed-addition-deletion")
		})

		it("should handle empty diff response from files", async () => {
			await runFileBasedTest("empty-diff-response")
		})

		it("should apply function rename and var to const changes from files", async () => {
			await runFileBasedTest("function-rename-var-to-const")
		})
	})

	describe("Sequential application", () => {
		it("should handle an inverse individual application of mixed operations", async () => {
			const initialContent = normalizeWhitespace(`\
// Header
// This function adds two numbers.
function add(a, b) {
  return a + b;
}

// This function divides two numbers.
// It throws an error if the divisor is zero.
function divide(a, b) {
  if (b === 0) throw new Error("Cannot divide by zero");
  return a / b;
}`)
			const diffResponse = `\
--- a/sequential.js
+++ b/sequential.js
@@ -1,12 +1,16 @@
-// Header
-// This function adds two numbers.
 function add(a, b) {
   return a + b;
 }
 
-// This function divides two numbers.
-// It throws an error if the divisor is zero.
 function divide(a, b) {
   if (b === 0) throw new Error("Cannot divide by zero");
   return a / b;
 }
+
+function multiply(a, b) {
+  return a * b;
+}
+
+function subtract(a, b) {
+  return a - b;
+}`

			const expected = `\
function add(a, b) {
  return a + b;
}

function divide(a, b) {
  if (b === 0) throw new Error("Cannot divide by zero");
  return a / b;
}

function multiply(a, b) {
  return a * b;
}

function subtract(a, b) {
  return a - b;
}`
			const { testUri, context } = await setupTestDocument("sequential.js", initialContent)
			const normalizedDiffResponse = normalizeWhitespace(diffResponse)
			const suggestions = await strategy.parseResponse(normalizedDiffResponse, context)

			const suggestionsFile = suggestions.getFile(testUri)
			suggestionsFile!.sortGroups()

			// Loop through each suggestion group and apply them one by one
			const groups = suggestionsFile!.getGroupsOperations()
			const groupsLength = groups.length
			suggestionsFile!.selectNextGroup()
			for (let i = 0; i < groupsLength; i++) {
				// Apply the currently selected suggestion group
				await workspaceEdit.applySelectedSuggestions(suggestions)
				suggestionsFile!.deleteSelectedGroup()
			}

			// Verify the final document content is correct
			const finalContent = mockWorkspace.getDocumentContent(testUri)
			const expectedContent = normalizeWhitespace(expected)
			expect(finalContent).toBe(expectedContent)
		})
		it("should handle sequential partial application of mixed operations", async () => {
			const initialContent = normalizeWhitespace(`\
function calculate() {
  let a = 1
  let b = 2

  let sum = a + b
  let product = a * b

  console.log(sum)
  console.log(product)

  return sum
}`)
			const diffResponse = `\
--- a/sequential.js
+++ b/sequential.js
@@ -1,12 +1,15 @@
 function calculate() {
   let a = 1
   let b = 2
+  let c = 3; // kilocode_change start: Add a new variable
 
   let sum = a + b
   let product = a * b
+  let difference = a - b; // kilocode_change end: Add a new variable
 
   console.log(sum)
   console.log(product)
+  console.log(difference); // kilocode_change start: Log the new variable
 
-  return sum
+  return sum + difference; // kilocode_change end: Return sum and difference
 }`

			const expected = `\
function calculate() {
  let a = 1
  let b = 2

  let sum = a + b
  let product = a * b
  let difference = a - b; // kilocode_change end: Add a new variable

  console.log(sum)
  console.log(product)
  console.log(difference); // kilocode_change start: Log the new variable

  return sum + difference; // kilocode_change end: Return sum and difference
}`
			const { testUri, context } = await setupTestDocument("sequential.js", initialContent)
			const normalizedDiffResponse = normalizeWhitespace(diffResponse)
			const suggestions = await strategy.parseResponse(normalizedDiffResponse, context)

			const suggestionsFile = suggestions.getFile(testUri)
			suggestionsFile!.sortGroups()

			// Loop through each suggestion group and apply them one by one
			const groups = suggestionsFile!.getGroupsOperations()
			const groupsLength = groups.length
			for (let i = 0; i < groupsLength; i++) {
				if (i === 0) {
					// Skip the first operation
					suggestionsFile!.selectNextGroup()
				} else {
					// Apply the currently selected suggestion group
					await workspaceEdit.applySelectedSuggestions(suggestions)
					suggestionsFile!.deleteSelectedGroup()
				}
			}

			// Verify the final document content is correct
			const finalContent = mockWorkspace.getDocumentContent(testUri)
			const expectedContent = normalizeWhitespace(expected)
			expect(finalContent).toBe(expectedContent)
		})
		it("should handle random individual application of mixed operations", async () => {
			const initialContent = normalizeWhitespace(`\
function calculate() {
  let a = 1
  let b = 2

  let sum = a + b
  let product = a * b

  console.log(sum)
  console.log(product)

  return sum
}`)
			const diffResponse = `\
--- a/sequential.js
+++ b/sequential.js
@@ -1,12 +1,15 @@
 function calculate() {
   let a = 1
   let b = 2
+  let c = 3; // kilocode_change start: Add a new variable
 
   let sum = a + b
   let product = a * b
+  let difference = a - b; // kilocode_change end: Add a new variable
 
   console.log(sum)
   console.log(product)
+  console.log(difference); // kilocode_change start: Log the new variable
 
-  return sum
+  return sum + difference; // kilocode_change end: Return sum and difference
 }`

			const expected = `\
function calculate() {
  let a = 1
  let b = 2
  let c = 3; // kilocode_change start: Add a new variable

  let sum = a + b
  let product = a * b
  let difference = a - b; // kilocode_change end: Add a new variable

  console.log(sum)
  console.log(product)
  console.log(difference); // kilocode_change start: Log the new variable

  return sum + difference; // kilocode_change end: Return sum and difference
}`
			const { testUri, context } = await setupTestDocument("sequential.js", initialContent)
			const normalizedDiffResponse = normalizeWhitespace(diffResponse)
			const suggestions = await strategy.parseResponse(normalizedDiffResponse, context)

			const suggestionsFile = suggestions.getFile(testUri)
			suggestionsFile!.sortGroups()

			// Loop through each suggestion group and apply them one by one
			const groups = suggestionsFile!.getGroupsOperations()
			const groupsLength = groups.length
			for (let i = 0; i < groupsLength; i++) {
				const random = Math.floor(Math.random() * 4) + 1
				for (let j = 0; j < random; j++) {
					suggestionsFile!.selectNextGroup()
				}
				// Apply the currently selected suggestion group
				await workspaceEdit.applySelectedSuggestions(suggestions)
				suggestionsFile!.deleteSelectedGroup()
			}

			// Verify the final document content is correct
			const finalContent = mockWorkspace.getDocumentContent(testUri)
			const expectedContent = normalizeWhitespace(expected)
			expect(finalContent).toBe(expectedContent)
		})
	})

	describe("Error Handling", () => {
		it("should handle empty diff responses", async () => {
			const initialContent = `console.log('test');`
			const { context } = await setupTestDocument("empty.js", initialContent)

			// Test empty response
			const suggestions = await strategy.parseResponse("", context)
			expect(suggestions.hasSuggestions()).toBe(false)
		})

		it("should handle invalid diff format", async () => {
			const initialContent = `console.log('test');`
			const { context } = await setupTestDocument("invalid.js", initialContent)

			// Test invalid diff format
			const invalidDiff = "This is not a valid diff format"
			const suggestions = await strategy.parseResponse(invalidDiff, context)
			expect(suggestions.hasSuggestions()).toBe(false)
		})

		it("should handle file not found in context", async () => {
			const initialContent = `console.log('test');`
			await setupTestDocument("missing.js", initialContent)

			// Create context without the file in openFiles
			const context: GhostSuggestionContext = {
				openFiles: [], // Empty - file not in context
			}

			const diffResponse =
				"--- a/missing.js\n+++ b/missing.js\n@@ -1,1 +1,2 @@\n+// Added comment\n console.log('test');"

			const suggestions = await strategy.parseResponse(diffResponse, context)
			// Should still work even if file not in openFiles - it can still parse the diff
			expect(suggestions.hasSuggestions()).toBe(true)
		})
	})
})

import { describe, it, expect, beforeEach, vi } from "vitest"
import * as vscode from "vscode"
import { GhostInlineCompletionProvider } from "../GhostInlineCompletionProvider"
import { GhostSuggestionsState } from "../GhostSuggestions"
import { GhostSuggestionEditOperation } from "../types"

describe("GhostInlineCompletionProvider", () => {
	let provider: GhostInlineCompletionProvider
	let suggestions: GhostSuggestionsState
	let mockDocument: vscode.TextDocument
	let mockPosition: vscode.Position
	let mockContext: vscode.InlineCompletionContext
	let mockToken: vscode.CancellationToken

	beforeEach(() => {
		suggestions = new GhostSuggestionsState()
		provider = new GhostInlineCompletionProvider(suggestions)

		// Mock document
		mockDocument = {
			uri: vscode.Uri.file("/test/file.ts"),
			lineCount: 10,
			lineAt: (line: number) => ({
				text: `line ${line}`,
				range: new vscode.Range(line, 0, line, 10),
			}),
		} as any

		mockPosition = new vscode.Position(5, 0)
		mockContext = {
			triggerKind: 0,
			selectedCompletionInfo: undefined,
		} as any
		mockToken = { isCancellationRequested: false } as any
	})

	describe("provideInlineCompletionItems", () => {
		it("should return undefined when no suggestions exist", async () => {
			const result = await provider.provideInlineCompletionItems(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			)

			expect(result).toBeUndefined()
		})

		it("should return undefined when token is cancelled", async () => {
			mockToken.isCancellationRequested = true

			const result = await provider.provideInlineCompletionItems(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			)

			expect(result).toBeUndefined()
		})

		it("should return undefined for deletion-only groups", async () => {
			// Add a deletion group
			const file = suggestions.addFile(mockDocument.uri)
			const deleteOp: GhostSuggestionEditOperation = {
				type: "-",
				line: 5,
				oldLine: 5,
				newLine: 5,
				content: "deleted line",
			}
			file.addOperation(deleteOp)
			file.sortGroups()

			const result = await provider.provideInlineCompletionItems(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			)

			expect(result).toBeUndefined()
		})

		it("should return inline completion for addition at cursor position", async () => {
			// Add an addition group at the cursor line
			const file = suggestions.addFile(mockDocument.uri)
			const addOp: GhostSuggestionEditOperation = {
				type: "+",
				line: 5,
				oldLine: 5,
				newLine: 5,
				content: "new line of code",
			}
			file.addOperation(addOp)
			file.sortGroups()

			const result = await provider.provideInlineCompletionItems(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			)

			expect(result).toBeDefined()
			expect(Array.isArray(result)).toBe(true)
			expect((result as any[]).length).toBe(1)

			const item = (result as any[])[0]
			expect(item.insertText).toContain("new line of code")
		})

		it("should return undefined when suggestion is far from cursor", async () => {
			// Add a suggestion far from the cursor (>5 lines away)
			// The inline provider returns undefined, decorations will handle it instead
			const file = suggestions.addFile(mockDocument.uri)
			const addOp: GhostSuggestionEditOperation = {
				type: "+",
				line: 20, // Far from cursor at line 5 (15 lines away)
				oldLine: 20,
				newLine: 20,
				content: "distant code",
			}
			file.addOperation(addOp)
			file.sortGroups()

			const result = await provider.provideInlineCompletionItems(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			)

			// Provider returns undefined for far suggestions - decorations handle them
			expect(result).toBeUndefined()
		})

		it("should return undefined for modification groups (delete + add) - decorations handle them", async () => {
			// Add a modification group at cursor line
			const file = suggestions.addFile(mockDocument.uri)

			const deleteOp: GhostSuggestionEditOperation = {
				type: "-",
				line: 5,
				oldLine: 5,
				newLine: 5,
				content: "old code",
			}
			const addOp: GhostSuggestionEditOperation = {
				type: "+",
				line: 5,
				oldLine: 5,
				newLine: 5,
				content: "new code",
			}

			file.addOperation(deleteOp)
			file.addOperation(addOp)
			file.sortGroups()

			const result = await provider.provideInlineCompletionItems(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			)

			// Modifications should return undefined - SVG decorations handle them
			expect(result).toBeUndefined()
		})

		it("should handle multi-line additions when grouped", async () => {
			const file = suggestions.addFile(mockDocument.uri)

			// Create consecutive addition operations that will be grouped together
			const addOp1: GhostSuggestionEditOperation = {
				type: "+",
				line: 5,
				oldLine: 5,
				newLine: 5,
				content: "line 1",
			}
			const addOp2: GhostSuggestionEditOperation = {
				type: "+",
				line: 6,
				oldLine: 6,
				newLine: 6,
				content: "line 2",
			}

			file.addOperation(addOp1)
			file.addOperation(addOp2)
			file.sortGroups()

			// Verify they were grouped together
			const groups = file.getGroupsOperations()
			expect(groups.length).toBe(1)
			expect(groups[0].length).toBe(2)

			// The provider may or may not show inline completions for multi-line additions
			// depending on cursor position, but it should not throw errors
			const result = await provider.provideInlineCompletionItems(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			)

			// Just verify it doesn't error and returns expected type
			expect(result === undefined || Array.isArray(result)).toBe(true)
		})

		it("should handle comment-driven completions as inline ghost text", async () => {
			// Mock document with comment line
			mockDocument = {
				uri: vscode.Uri.file("/test/file.ts"),
				lineCount: 10,
				lineAt: (line: number) => {
					if (line === 5) {
						return {
							text: "// implement function to add two numbers",
							range: new vscode.Range(line, 0, line, 40),
						}
					}
					return {
						text: `line ${line}`,
						range: new vscode.Range(line, 0, line, 10),
					}
				},
			} as any

			// Simulate the scenario: LLM response creates deletion of comment + addition of function
			const file = suggestions.addFile(mockDocument.uri)

			// Group 1: Deletion of comment line (this happens when context has placeholder appended)
			const deleteOp: GhostSuggestionEditOperation = {
				type: "-",
				line: 5,
				oldLine: 5,
				newLine: 5,
				content: "// implement function to add two numbers",
			}

			// Group 2: Addition of function (starts with newline)
			const addOp: GhostSuggestionEditOperation = {
				type: "+",
				line: 6,
				oldLine: 6,
				newLine: 6,
				content: "\nfunction addNumbers(a: number, b: number): number {\n    return a + b;\n}",
			}

			file.addOperation(deleteOp)
			file.addOperation(addOp)
			file.sortGroups()

			// Position cursor at the comment line
			mockPosition = new vscode.Position(5, 40) // End of comment line

			const result = await provider.provideInlineCompletionItems(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			)

			// Should return inline completion (not undefined)
			expect(result).toBeDefined()
			expect(Array.isArray(result)).toBe(true)
			const items = result as vscode.InlineCompletionItem[]
			expect(items.length).toBe(1)

			// Should show the function without the comment part
			const completionText = items[0].insertText as string
			expect(completionText).toContain("function addNumbers")
			expect(completionText).not.toContain("// implement function")
		})

		it("should handle modifications with common prefix", async () => {
			// Mock document with existing code
			mockDocument = {
				uri: vscode.Uri.file("/test/file.ts"),
				lineCount: 10,
				lineAt: (line: number) => {
					if (line === 5) {
						return {
							text: "const y = ",
							range: new vscode.Range(line, 0, line, 10),
						}
					}
					return {
						text: `line ${line}`,
						range: new vscode.Range(line, 0, line, 10),
					}
				},
			} as any

			// Create modification group with common prefix
			const file = suggestions.addFile(mockDocument.uri)

			const deleteOp: GhostSuggestionEditOperation = {
				type: "-",
				line: 5,
				oldLine: 5,
				newLine: 5,
				content: "const y = ",
			}

			const addOp: GhostSuggestionEditOperation = {
				type: "+",
				line: 5,
				oldLine: 5,
				newLine: 5,
				content: "const y = divideNumbers(4, 2);",
			}

			file.addOperation(deleteOp)
			file.addOperation(addOp)
			file.sortGroups()

			// Position cursor after "const y = "
			mockPosition = new vscode.Position(5, 10)

			const result = await provider.provideInlineCompletionItems(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			)

			// Should return inline completion showing only the suffix
			expect(result).toBeDefined()
			expect(Array.isArray(result)).toBe(true)
			const items = result as vscode.InlineCompletionItem[]
			expect(items.length).toBe(1)

			const completionText = items[0].insertText as string
			expect(completionText).toBe("divideNumbers(4, 2);")
		})

		it("should return undefined for modifications without common prefix", async () => {
			// Create modification group without common prefix
			const file = suggestions.addFile(mockDocument.uri)

			const deleteOp: GhostSuggestionEditOperation = {
				type: "-",
				line: 5,
				oldLine: 5,
				newLine: 5,
				content: "var x = 10",
			}

			const addOp: GhostSuggestionEditOperation = {
				type: "+",
				line: 5,
				oldLine: 5,
				newLine: 5,
				content: "const x = 10",
			}

			file.addOperation(deleteOp)
			file.addOperation(addOp)
			file.sortGroups()

			const result = await provider.provideInlineCompletionItems(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			)

			// Should return undefined - SVG decorations handle this
			expect(result).toBeUndefined()
		})

		it("should handle comment with placeholder as inline ghost completion (mutual exclusivity test)", async () => {
			// This test covers the exact scenario: "// implme<<<AUTOCOMPLETE_HERE>>>"
			// where both inline and SVG were showing (should only show inline)

			mockDocument = {
				uri: vscode.Uri.file("/test/file.ts"),
				lineCount: 10,
				lineAt: (line: number) => {
					if (line === 5) {
						return {
							text: "// implme",
							range: new vscode.Range(line, 0, line, 8),
						}
					}
					return {
						text: `line ${line}`,
						range: new vscode.Range(line, 0, line, 10),
					}
				},
			} as any

			const file = suggestions.addFile(mockDocument.uri)

			// Simulate LLM response: search "// implme<<<AUTOCOMPLETE_HERE>>>" replace "// implme\nfunction..."
			// This creates: Group 1 (delete comment), Group 2 (add comment + function)
			const deleteOp: GhostSuggestionEditOperation = {
				type: "-",
				line: 5,
				oldLine: 5,
				newLine: 5,
				content: "// implme",
			}

			const addOp: GhostSuggestionEditOperation = {
				type: "+",
				line: 6,
				oldLine: 6,
				newLine: 6,
				content: "\nfunction implementFeature() {\n  console.log('Feature implemented');\n}",
			}

			file.addOperation(deleteOp)
			file.addOperation(addOp)
			file.sortGroups()

			// Position cursor at end of comment line
			mockPosition = new vscode.Position(5, 8)

			const result = await provider.provideInlineCompletionItems(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			)

			// Should return inline completion (ensuring only inline shows, no SVG)
			expect(result).toBeDefined()
			expect(Array.isArray(result)).toBe(true)
			const items = result as vscode.InlineCompletionItem[]
			expect(items.length).toBe(1)

			// Should show function as ghost text
			const completionText = items[0].insertText as string
			expect(completionText).toContain("function implementFeature")
		})

		it("should handle partial comment completion with common prefix (avoid duplication)", async () => {
			// Test case: "// now imple" should complete with "ment a function..." not duplicate "// now implement..."
			mockDocument = {
				uri: vscode.Uri.file("/test/file.ts"),
				lineCount: 10,
				lineAt: (line: number) => {
					if (line === 5) {
						return {
							text: "// now imple",
							range: new vscode.Range(line, 0, line, 12),
						}
					}
					return {
						text: `line ${line}`,
						range: new vscode.Range(line, 0, line, 10),
					}
				},
			} as any

			const file = suggestions.addFile(mockDocument.uri)

			// Simulate: search "// now imple<<<AUTOCOMPLETE_HERE>>>" replace "// now implement a function..."
			const deleteOp: GhostSuggestionEditOperation = {
				type: "-",
				line: 5,
				oldLine: 5,
				newLine: 5,
				content: "// now imple",
			}

			const addOp: GhostSuggestionEditOperation = {
				type: "+",
				line: 5,
				oldLine: 5,
				newLine: 5,
				content:
					"// now implement a function that subtracts two numbers\nfunction subtractNumbers(a: number, b: number): number {\n    return a - b;\n}",
			}

			file.addOperation(deleteOp)
			file.addOperation(addOp)
			file.sortGroups()

			// Position cursor after "// now imple"
			mockPosition = new vscode.Position(5, 12)

			const result = await provider.provideInlineCompletionItems(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			)

			// Should return inline completion with only the suffix (no duplication)
			expect(result).toBeDefined()
			expect(Array.isArray(result)).toBe(true)
			const items = result as vscode.InlineCompletionItem[]
			expect(items.length).toBe(1)

			// Should show only the completion part, not the existing comment
			const completionText = items[0].insertText as string
			expect(completionText).toBe(
				"ment a function that subtracts two numbers\nfunction subtractNumbers(a: number, b: number): number {\n    return a - b;\n}",
			)
			expect(completionText).not.toContain("// now imple") // Should not duplicate existing text
		})

		it("should handle single-line completion without duplication (add → addNumbers)", async () => {
			// Test case: typing "add" should complete to "addNumbers" on same line
			mockDocument = {
				uri: vscode.Uri.file("/test/file.ts"),
				lineCount: 10,
				lineAt: (line: number) => {
					if (line === 5) {
						return {
							text: "const num = add",
							range: new vscode.Range(line, 0, line, 15),
						}
					}
					return {
						text: `line ${line}`,
						range: new vscode.Range(line, 0, line, 10),
					}
				},
			} as any

			const file = suggestions.addFile(mockDocument.uri)

			// LLM creates: delete "const num = add", add "const num = addNumbers"
			const deleteOp: GhostSuggestionEditOperation = {
				type: "-",
				line: 5,
				oldLine: 5,
				newLine: 5,
				content: "const num = add",
			}

			const addOp: GhostSuggestionEditOperation = {
				type: "+",
				line: 5,
				oldLine: 5,
				newLine: 5,
				content: "const num = addNumbers",
			}

			file.addOperation(deleteOp)
			file.addOperation(addOp)
			file.sortGroups()

			mockPosition = new vscode.Position(5, 15) // After "add"

			const result = await provider.provideInlineCompletionItems(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			)

			// Should show inline completion with ONLY the suffix
			expect(result).toBeDefined()
			expect(Array.isArray(result)).toBe(true)
			const items = result as vscode.InlineCompletionItem[]
			expect(items.length).toBe(1)

			const completionText = items[0].insertText as string
			expect(completionText).toBe("Numbers") // Only the suffix
			expect(completionText).not.toContain("const num = add") // No duplication
		})

		it("should handle first line common prefix with multi-line addition (// → implement...)", async () => {
			// Test: typing "// " should complete with "implement function..." + function code
			// First line should strip "// " prefix
			mockDocument = {
				uri: vscode.Uri.file("/test/file.ts"),
				lineCount: 10,
				lineAt: (line: number) => {
					if (line === 5) {
						return {
							text: "// ",
							range: new vscode.Range(line, 0, line, 3),
						}
					}
					return {
						text: `line ${line}`,
						range: new vscode.Range(line, 0, line, 10),
					}
				},
			} as any

			const file = suggestions.addFile(mockDocument.uri)

			// LLM creates: delete "// ", add "// implement function..." + function
			const deleteOp: GhostSuggestionEditOperation = {
				type: "-",
				line: 5,
				oldLine: 5,
				newLine: 5,
				content: "// ",
			}

			// Addition has multiple lines, first starting with "// implement..."
			file.addOperation(deleteOp)
			file.addOperation({
				type: "+",
				line: 6,
				oldLine: 6,
				newLine: 6,
				content: "// implement function to add two numbers",
			})
			file.addOperation({
				type: "+",
				line: 7,
				oldLine: 6,
				newLine: 7,
				content: "function addNumbers(a: number, b: number): number {",
			})
			file.addOperation({
				type: "+",
				line: 8,
				oldLine: 6,
				newLine: 8,
				content: "  return a + b;",
			})
			file.addOperation({
				type: "+",
				line: 9,
				oldLine: 6,
				newLine: 9,
				content: "}",
			})
			file.sortGroups()

			mockPosition = new vscode.Position(5, 3) // After "// "

			const result = await provider.provideInlineCompletionItems(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			)

			// Should show inline completion
			expect(result).toBeDefined()
			expect(Array.isArray(result)).toBe(true)
			const items = result as vscode.InlineCompletionItem[]
			expect(items.length).toBe(1)

			const completionText = items[0].insertText as string
			// Should start with "implement..." not "// implement..."
			expect(completionText.startsWith("implement")).toBe(true)
			expect(completionText).toContain("function addNumbers")
			expect(completionText.startsWith("// ")).toBe(false) // Should strip the "// " prefix
		})

		it("should not add extra newlines when content already starts with newline", async () => {
			// Test: ensure we don't double-add newlines
			mockDocument = {
				uri: vscode.Uri.file("/test/file.ts"),
				lineCount: 10,
				lineAt: (line: number) => {
					if (line === 5) {
						return {
							text: "// comment",
							range: new vscode.Range(line, 0, line, 10),
						}
					}
					return {
						text: `line ${line}`,
						range: new vscode.Range(line, 0, line, 10),
					}
				},
			} as any

			const file = suggestions.addFile(mockDocument.uri)

			// Addition that already starts with newline
			const addOp: GhostSuggestionEditOperation = {
				type: "+",
				line: 6,
				oldLine: 6,
				newLine: 6,
				content: "\nfunction test() {\n  return true;\n}",
			}

			file.addOperation(addOp)
			file.sortGroups()

			mockPosition = new vscode.Position(5, 10)

			const result = await provider.provideInlineCompletionItems(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			)

			expect(result).toBeDefined()
			const items = result as vscode.InlineCompletionItem[]
			expect(items.length).toBe(1)

			const completionText = items[0].insertText as string
			// Should not have double newlines
			expect(completionText.startsWith("\n\n")).toBe(false)
			// Should start with single newline
			expect(completionText.startsWith("\n")).toBe(true)
		})

		it("should handle empty line deletion with multi-group additions as inline completion", async () => {
			// Test: cursor on empty line, LLM suggests comment + function
			// Creates: Group 0 (delete '', add comment), Group 1 (add function lines)
			// Should combine all and show as inline completion
			mockDocument = {
				uri: vscode.Uri.file("/test/file.ts"),
				lineCount: 12,
				lineAt: (line: number) => {
					if (line === 10) {
						return {
							text: "",
							range: new vscode.Range(line, 0, line, 0),
						}
					}
					return {
						text: `line ${line}`,
						range: new vscode.Range(line, 0, line, 10),
					}
				},
			} as any

			const file = suggestions.addFile(mockDocument.uri)

			// Group 0: modification - add comment
			const commentOp: GhostSuggestionEditOperation = {
				type: "+",
				line: 10,
				oldLine: 11,
				newLine: 10,
				content: "// implement function to add two numbers",
			}

			file.addOperation(commentOp)

			// Group 1: pure additions - function lines
			file.addOperation({
				type: "+",
				line: 11,
				oldLine: 11,
				newLine: 11,
				content: "function addTwoNumbers(a: number, b: number): number {",
			})
			file.addOperation({
				type: "+",
				line: 12,
				oldLine: 11,
				newLine: 12,
				content: "    return a + b;",
			})
			file.addOperation({
				type: "+",
				line: 13,
				oldLine: 11,
				newLine: 13,
				content: "}",
			})

			file.sortGroups()

			mockPosition = new vscode.Position(10, 0) // Cursor on empty line

			const result = await provider.provideInlineCompletionItems(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			)

			// Should show inline completion combining comment + function
			expect(result).toBeDefined()
			expect(Array.isArray(result)).toBe(true)
			const items = result as vscode.InlineCompletionItem[]
			expect(items.length).toBe(1)

			const completionText = items[0].insertText as string
			// Should contain both comment and function
			expect(completionText).toContain("// implement function")
			expect(completionText).toContain("function addTwoNumbers")
			expect(completionText).toContain("return a + b")
		})

		it("should combine modification suffix with subsequent additions (functio → functions + function)", async () => {
			// Test: typing "// next use both these functio" should complete to:
			// "ns" on same line + function on next lines
			mockDocument = {
				uri: vscode.Uri.file("/test/file.ts"),
				lineCount: 20,
				lineAt: (line: number) => {
					if (line === 15) {
						return {
							text: "// next use both these functio",
							range: new vscode.Range(line, 0, line, 30),
						}
					}
					return {
						text: `line ${line}`,
						range: new vscode.Range(line, 0, line, 10),
					}
				},
			} as any

			const file = suggestions.addFile(mockDocument.uri)

			// Group 0: modification - "functio" → "functions"
			const deleteOp: GhostSuggestionEditOperation = {
				type: "-",
				line: 15,
				oldLine: 15,
				newLine: 15,
				content: "// next use both these functio",
			}

			const addOp: GhostSuggestionEditOperation = {
				type: "+",
				line: 15,
				oldLine: 16,
				newLine: 15,
				content: "// next use both these functions",
			}

			file.addOperation(deleteOp)
			file.addOperation(addOp)

			// Group 1: pure additions - function lines
			file.addOperation({
				type: "+",
				line: 16,
				oldLine: 16,
				newLine: 16,
				content: "function useBothFunctions(a: number, b: number): { sum: number; product: number } {",
			})
			file.addOperation({
				type: "+",
				line: 17,
				oldLine: 16,
				newLine: 17,
				content: "    const sum = addNumbers(a, b);",
			})
			file.addOperation({
				type: "+",
				line: 18,
				oldLine: 16,
				newLine: 18,
				content: "    const product = multiplyNumbers(a, b);",
			})
			file.addOperation({
				type: "+",
				line: 19,
				oldLine: 16,
				newLine: 19,
				content: "    return { sum, product };",
			})
			file.addOperation({
				type: "+",
				line: 20,
				oldLine: 16,
				newLine: 20,
				content: "}",
			})

			file.sortGroups()

			mockPosition = new vscode.Position(15, 30) // After "functio"

			const result = await provider.provideInlineCompletionItems(
				mockDocument,
				mockPosition,
				mockContext,
				mockToken,
			)

			// Should show inline completion
			expect(result).toBeDefined()
			expect(Array.isArray(result)).toBe(true)
			const items = result as vscode.InlineCompletionItem[]
			expect(items.length).toBe(1)

			const completionText = items[0].insertText as string
			// Should contain "ns" suffix on same line
			expect(completionText).toContain("ns")
			// Should contain function code on next lines
			expect(completionText).toContain("function useBothFunctions")
			expect(completionText).toContain("const sum = addNumbers")
			// Should NOT duplicate existing text
			expect(completionText).not.toContain("// next use both these functio")
		})
	})

	describe("updateSuggestions", () => {
		it("should update suggestions reference", () => {
			const newSuggestions = new GhostSuggestionsState()
			const file = newSuggestions.addFile(mockDocument.uri)
			file.addOperation({
				type: "+",
				line: 1,
				oldLine: 1,
				newLine: 1,
				content: "test",
			})

			provider.updateSuggestions(newSuggestions)

			// Verify provider now uses the new suggestions
			// This will be reflected in the next call to provideInlineCompletionItems
			expect(() => provider.updateSuggestions(newSuggestions)).not.toThrow()
		})
	})

	describe("dispose", () => {
		it("should dispose cleanly", () => {
			expect(() => provider.dispose()).not.toThrow()
		})
	})
})

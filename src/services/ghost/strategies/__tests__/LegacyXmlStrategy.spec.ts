import { describe, it, expect } from "vitest"
import { LegacyXmlStrategy } from "../LegacyXmlStrategy"
import { parseContentWithCursor } from "../mercury/__tests__/testUtils"
import { StringGhostApplicator } from "../../applicators/StringGhostApplicator"

/**
 * Basic sanity tests for LegacyXmlStrategy
 * Starting simple to validate core functionality step by step
 */
describe("LegacyXmlStrategy - Basic Sanity Tests", () => {
	it("should initialize without errors", () => {
		const strategy = new LegacyXmlStrategy()
		expect(strategy).toBeDefined()
		expect(strategy.name).toBe("Legacy XML")
	})

	it("should handle context validation", () => {
		const strategy = new LegacyXmlStrategy()
		const { document, cursorRange } = parseContentWithCursor("hello ␣world", "/test.js")

		const context = {
			document,
			range: cursorRange,
			position: cursorRange.start,
			diagnostics: [],
		}

		expect(strategy.canHandle(context)).toBe(true)

		// Should not throw when initializing with valid context
		expect(() => {
			strategy.initializeProcessing(context)
		}).not.toThrow()
	})

	it("should process XML response and generate suggestions", () => {
		const strategy = new LegacyXmlStrategy()
		const { document, cursorRange } = parseContentWithCursor("hello ␣world", "/test.js")

		const context = {
			document,
			range: cursorRange,
			position: cursorRange.start,
			diagnostics: [],
		}

		// Initialize
		strategy.initializeProcessing(context)

		// Process a simple XML response
		const xmlResponse = `<change>
<search><![CDATA[hello world]]></search>
<replace><![CDATA[hello beautiful world]]></replace>
</change>`

		const chunkResult = strategy.processResponseChunk(xmlResponse)
		console.log("Chunk result:", {
			hasNewSuggestions: chunkResult.hasNewSuggestions,
			isComplete: chunkResult.isComplete,
			suggestionsCount: chunkResult.suggestions.getFiles().length,
		})

		const finalResult = strategy.finishProcessing()
		console.log("Final result:", {
			hasNewSuggestions: finalResult.hasNewSuggestions,
			isComplete: finalResult.isComplete,
			suggestionsCount: finalResult.suggestions.getFiles().length,
		})

		// Basic validation - should have generated some suggestions
		expect(finalResult.suggestions).toBeDefined()
		expect(finalResult.isComplete).toBe(true)

		// Log the suggestions for debugging
		const files = finalResult.suggestions.getFiles()
		if (files.length > 0) {
			const operations = files[0].getAllOperations()
			console.log(
				"Generated operations:",
				operations.map((op) => ({
					type: op.type,
					line: op.line,
					content: JSON.stringify(op.content),
				})),
			)
		}
	})

	it("should apply suggestions correctly using StringGhostApplicator", async () => {
		const strategy = new LegacyXmlStrategy()
		const originalContent = "hello world"
		const { document, cursorRange } = parseContentWithCursor("hello ␣world", "/test.js")

		const context = {
			document,
			range: cursorRange,
			position: cursorRange.start,
			diagnostics: [],
		}

		// Initialize and process XML
		strategy.initializeProcessing(context)

		const xmlResponse = `<change>
<search><![CDATA[hello world]]></search>
<replace><![CDATA[hello beautiful world]]></replace>
</change>`

		strategy.processResponseChunk(xmlResponse)
		const result = strategy.finishProcessing()

		// Apply suggestions using StringGhostApplicator
		const applicator = new StringGhostApplicator()
		applicator.setOriginalContent(document.uri.toString(), originalContent)

		await applicator.applyAll(result.suggestions, document.uri.toString())
		const finalContent = applicator.getResult(document.uri.toString())

		console.log("Original content:", JSON.stringify(originalContent))
		console.log("Final content:", JSON.stringify(finalContent))
		console.log("Expected content:", JSON.stringify("hello beautiful world"))

		expect(finalContent).toBe("hello beautiful world")
	})

	it("should handle function completion like the original failing test", async () => {
		const strategy = new LegacyXmlStrategy()
		const originalContent = `function greetUser(name) {
		  
}`
		const { document, cursorRange } = parseContentWithCursor(
			`function greetUser(name) {
		  ␣
}`,
			"/test.js",
		)

		const context = {
			document,
			range: cursorRange,
			position: cursorRange.start,
			diagnostics: [],
		}

		// Initialize and process XML (same as original failing test)
		strategy.initializeProcessing(context)

		const xmlResponse = `<change>
<search><![CDATA[function greetUser(name) {
		  
}]]></search>
<replace><![CDATA[function greetUser(name) {
		  return \`Hello, \${name}! Welcome to our application.\`;
}]]></replace>
</change>`

		strategy.processResponseChunk(xmlResponse)
		const result = strategy.finishProcessing()

		// Apply suggestions using StringGhostApplicator
		const applicator = new StringGhostApplicator()
		applicator.setOriginalContent(document.uri.toString(), originalContent)

		await applicator.applyAll(result.suggestions, document.uri.toString())
		const finalContent = applicator.getResult(document.uri.toString())

		const expectedContent = `function greetUser(name) {
		  return \`Hello, \${name}! Welcome to our application.\`;
}`

		console.log("Original content:", JSON.stringify(originalContent))
		console.log("Final content:", JSON.stringify(finalContent))
		console.log("Expected content:", JSON.stringify(expectedContent))

		expect(finalContent).toBe(expectedContent)
	})
})

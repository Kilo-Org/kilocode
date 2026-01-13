// Essential sanity checks for code glossary extraction
// Run: cd $WORKSPACE_ROOT/src && npx vitest run services/stt/context/__tests__/codeGlossaryExtractor.spec.ts

import { extractCodeGlossary, formatGlossaryAsPrompt } from "../codeGlossaryExtractor"
import type { VisibleCodeContext } from "../../../ghost/types"

describe("extractCodeGlossary", () => {
	it("always includes core Kilocode terms", () => {
		const visibleCode: VisibleCodeContext = {
			timestamp: Date.now(),
			editors: [],
		}

		const glossary = extractCodeGlossary(visibleCode)

		// Core terms should always be present
		expect(glossary.identifiers).toContain("Kilocode")
		expect(glossary.identifiers).toContain("Kilo Code")
		expect(glossary.identifiers).toContain("VSCode")
		expect(glossary.identifiers).toContain("MCP")
	})

	it("extracts meaningful identifiers (4+ chars) and filters out short common words", () => {
		const visibleCode: VisibleCodeContext = {
			timestamp: Date.now(),
			editors: [
				{
					filePath: "/test.ts",
					relativePath: "test.ts",
					languageId: "typescript",
					isActive: true,
					visibleRanges: [
						{
							startLine: 0,
							endLine: 3,
							content: "const userName = 42; const db = null; for (let i = 0; i < 10; i++) {}",
						},
					],
					cursorPosition: null,
					selections: [],
					diffInfo: undefined,
				},
			],
		}

		const glossary = extractCodeGlossary(visibleCode)

		// Core terms are present
		expect(glossary.identifiers).toContain("Kilocode")

		// Meaningful identifiers (4+ chars) are included
		expect(glossary.identifiers).toContain("userName")
		expect(glossary.identifiers).toContain("const")
		expect(glossary.identifiers).toContain("null")

		// Short common words (3 chars or less) are filtered out
		expect(glossary.identifiers).not.toContain("db")
		expect(glossary.identifiers).not.toContain("let")
		expect(glossary.identifiers).not.toContain("for")
		expect(glossary.identifiers).not.toContain("i")
	})

	it("extracts meaningful identifiers from realistic code", () => {
		const visibleCode: VisibleCodeContext = {
			timestamp: Date.now(),
			editors: [
				{
					filePath: "/app.js",
					relativePath: "app.js",
					languageId: "javascript",
					isActive: true,
					visibleRanges: [
						{
							startLine: 0,
							endLine: 20,
							content: `
								const galleryItems = document.querySelectorAll('.gallery-item');
								galleryItems.forEach(item => {
									item.addEventListener('mouseenter', function () {
										this.style.transform = 'scale(1.05) rotate(1deg)';
									});
								});
								
								const subtitle = document.querySelector('.hero-subtitle');
								if (subtitle) {
									const text = subtitle.textContent;
									subtitle.textContent = '';
								}
							`,
						},
					],
					cursorPosition: null,
					selections: [],
					diffInfo: undefined,
				},
			],
		}

		const glossary = extractCodeGlossary(visibleCode)

		// Should extract meaningful code identifiers
		expect(glossary.identifiers).toContain("galleryItems")
		expect(glossary.identifiers).toContain("document")
		expect(glossary.identifiers).toContain("querySelectorAll")
		expect(glossary.identifiers).toContain("forEach")
		expect(glossary.identifiers).toContain("addEventListener")
		expect(glossary.identifiers).toContain("mouseenter")
		expect(glossary.identifiers).toContain("function")
		expect(glossary.identifiers).toContain("style")
		expect(glossary.identifiers).toContain("transform")
		expect(glossary.identifiers).toContain("scale")
		expect(glossary.identifiers).toContain("rotate")
		expect(glossary.identifiers).toContain("subtitle")
		expect(glossary.identifiers).toContain("querySelector")
		expect(glossary.identifiers).toContain("textContent")

		// Should NOT extract short common words or keywords
		expect(glossary.identifiers).not.toContain("the")
		expect(glossary.identifiers).not.toContain("to")
		expect(glossary.identifiers).not.toContain("if")
		expect(glossary.identifiers).not.toContain("deg")

		// Core terms should still be present
		expect(glossary.identifiers).toContain("Kilocode")
		expect(glossary.identifiers).toContain("VSCode")
	})

	it("includes core terms even with empty visible code", () => {
		const visibleCode: VisibleCodeContext = {
			timestamp: Date.now(),
			editors: [],
		}

		const glossary = extractCodeGlossary(visibleCode)

		// Should have core terms even without visible code
		expect(glossary.identifiers.length).toBeGreaterThan(0)
		expect(glossary.identifiers).toContain("Kilocode")
	})
})

describe("formatGlossaryAsPrompt", () => {
	it("formats identifiers as natural language prompt", () => {
		const glossary = {
			identifiers: ["userName", "firstName", "lastName"],
		}

		const prompt = formatGlossaryAsPrompt(glossary)

		// Check format matches current implementation
		expect(prompt).toContain(
			"Context: The user is a software developer. Terms that MAY appear in their speech include:",
		)
		expect(prompt).toContain("userName")
		expect(prompt).toContain("firstName")
		expect(prompt).toContain("lastName")
	})

	it("returns empty string for empty glossary", () => {
		const glossary = { identifiers: [] }

		const prompt = formatGlossaryAsPrompt(glossary)

		expect(prompt).toBe("")
	})

	it("prioritizes core terms then limits to 50 total terms", () => {
		// Create glossary with core terms + many extracted terms
		const coreTerms = ["Kilocode", "Kilo Code", "VSCode", "MCP"]
		const extractedTerms = Array(100)
			.fill(0)
			.map((_, i) => `id${i}`)

		const glossary = {
			identifiers: [...coreTerms, ...extractedTerms],
		}

		const prompt = formatGlossaryAsPrompt(glossary)

		// Core terms should be present
		expect(prompt).toContain("Kilocode")
		expect(prompt).toContain("VSCode")

		// Count total comma-separated terms
		const allTerms = prompt.split("include: ")[1].split(".")
		const termsList = allTerms[0].split(", ")
		expect(termsList.length).toBeLessThanOrEqual(50)
	})
})

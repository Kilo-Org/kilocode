import { describe, it, expect } from "vitest"
import { MercuryPromptBuilder } from "../MercuryPromptBuilder"
import { parseContentWithCursor } from "./testUtils"

describe("MercuryPromptBuilder", () => {
	let builder: MercuryPromptBuilder

	beforeEach(() => {
		builder = new MercuryPromptBuilder()
	})

	describe("buildCurrentFileContentBlock", () => {
		it("should build file content with editable region markers and cursor", () => {
			const contentWithCursor = `class User {
    constructor(name, age) {
        this.name = name;
        this.age = age;
    }

    getDisplayName() {
        ␣
    }

    isAdult() {
        return this.age >= 18;
    }
}`

			const { document, cursorRange } = parseContentWithCursor(contentWithCursor)
			const editableRegion = { editableStart: 6, editableEnd: 8, totalLines: 13, tokensUsed: 100 }

			const fileBlock = builder.buildCurrentFileContentBlock(document, cursorRange, editableRegion)

			expect(fileBlock).toMatchSnapshot()
		})

		it("should handle cursor at beginning of file", () => {
			const contentWithCursor = `␣class User {
    constructor() {}
}`

			const { document, cursorRange } = parseContentWithCursor(contentWithCursor)
			const editableRegion = { editableStart: 0, editableEnd: 2, totalLines: 3, tokensUsed: 50 }

			const fileBlock = builder.buildCurrentFileContentBlock(document, cursorRange, editableRegion)

			expect(fileBlock).toMatchSnapshot()
		})
	})

	describe("buildUserPrompt", () => {
		it("should build complete Mercury prompt with all sections", () => {
			const contentWithCursor = `function test() {
    retu␣rn 42;
}`

			const { document, cursorRange } = parseContentWithCursor(contentWithCursor)
			const editableRegion = { editableStart: 0, editableEnd: 2, totalLines: 3, tokensUsed: 30 }

			const recentlyViewedSnippets = [{ content: "const x = 1;", filepath: "helper.js" }]
			const editHistory = ["Added function test()"]

			const prompt = builder.buildUserPrompt(
				document,
				cursorRange,
				editableRegion,
				recentlyViewedSnippets,
				editHistory,
			)

			expect(prompt).toMatchSnapshot()
		})

		it("should extract editable region for comparison with Mercury response", () => {
			const { document } = parseContentWithCursor(`line 0
line 1
line ␣2
line 3
line 4`)

			const editableRegion = { editableStart: 1, editableEnd: 3, totalLines: 5, tokensUsed: 50 }

			const extracted = builder.extractEditableRegionForComparison(document, editableRegion)

			expect(extracted).toMatchSnapshot()
		})
	})

	describe("buildRecentlyViewedCodeSnippetsBlock", () => {
		it("should format snippets with file paths", () => {
			const snippets = [
				{ content: "const helper = () => 42;", filepath: "/utils/helper.js" },
				{ content: "interface User {\n  name: string;\n}", filepath: "/types/user.ts" },
			]

			const block = builder.buildRecentlyViewedCodeSnippetsBlock(snippets)

			expect(block).toMatchSnapshot()
		})

		it("should handle empty snippets", () => {
			const block = builder.buildRecentlyViewedCodeSnippetsBlock([])

			expect(block).toMatchSnapshot()
		})
	})
})

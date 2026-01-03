// kilocode_change - new file

import { describe, test, expect } from "vitest"
import { WorkflowMetadataExtractor } from "../WorkflowMetadataExtractor"

describe("WorkflowMetadataExtractor", () => {
	let extractor: WorkflowMetadataExtractor

	beforeEach(() => {
		extractor = new WorkflowMetadataExtractor()
	})

	describe("parseFrontmatter", () => {
		it("should parse valid YAML frontmatter", () => {
			const content = `---
description: Test workflow
arguments: --verbose
---
Workflow content here`

			const result = extractor.parseFrontmatter(content)

			expect(result.frontmatter.description).toBe("Test workflow")
			expect(result.frontmatter.arguments).toBe("--verbose")
			expect(result.content).toBe("Workflow content here")
		})

		it("should handle content without frontmatter", () => {
			const content = "Just workflow content without frontmatter"

			const result = extractor.parseFrontmatter(content)

			expect(result.frontmatter).toEqual({})
			expect(result.content).toBe("Just workflow content without frontmatter")
		})

		it("should handle malformed frontmatter gracefully", () => {
			const content = `---
invalid yaml: [unclosed
---
Content`

			const result = extractor.parseFrontmatter(content)

			// gray-matter returns entire content when frontmatter is malformed
			expect(result.frontmatter).toEqual({})
			expect(result.content).toBe(content)
		})

		it("should handle empty frontmatter", () => {
			const content = `---
---
Workflow content`

			const result = extractor.parseFrontmatter(content)

			expect(result.frontmatter).toEqual({})
			expect(result.content).toBe("Workflow content")
		})
	})

	describe("extractDescription", () => {
		it("should extract description when present", () => {
			const frontmatter = {
				description: "A test workflow for testing purposes",
			}

			const result = extractor.extractDescription(frontmatter)

			expect(result).toBe("A test workflow for testing purposes")
		})

		it("should return undefined when description is missing", () => {
			const frontmatter = {}

			const result = extractor.extractDescription(frontmatter)

			expect(result).toBeUndefined()
		})

		it("should return undefined when description is empty string", () => {
			const frontmatter = {
				description: "   ",
			}

			const result = extractor.extractDescription(frontmatter)

			expect(result).toBeUndefined()
		})

		it("should truncate description to 30 words", () => {
			const longDescription =
				"one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twenty-one twenty-two twenty-three twenty-four twenty-five twenty-six twenty-seven twenty-eight twenty-nine thirty thirty-one"

			const frontmatter = {
				description: longDescription,
			}

			const result = extractor.extractDescription(frontmatter)

			expect(result).toBeDefined()
			// Result should end with "..." after truncation
			expect(result).toContain("...")
			// Should be truncated to 30 words plus "..."
			expect(result).toBe(
				"one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twenty-one twenty-two twenty-three twenty-four twenty-five twenty-six twenty-seven twenty-eight twenty-nine thirty...",
			)
		})

		it("should not truncate description with exactly 30 words", () => {
			const exactDescription =
				"one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twenty-one twenty-two twenty-three twenty-four twenty-five twenty-six twenty-seven twenty-eight twenty-nine thirty"

			const frontmatter = {
				description: exactDescription,
			}

			const result = extractor.extractDescription(frontmatter)

			expect(result).toBe(exactDescription)
			expect(result).not.toContain("...")
		})

		it("should handle description with extra whitespace", () => {
			const frontmatter = {
				description: "  Test description with spaces  ",
			}

			const result = extractor.extractDescription(frontmatter)

			expect(result).toBe("Test description with spaces")
		})
	})

	describe("extractArguments", () => {
		it("should extract arguments when present", () => {
			const frontmatter = {
				arguments: "--verbose --output=file.txt",
			}

			const result = extractor.extractArguments(frontmatter)

			expect(result).toBe("--verbose --output=file.txt")
		})

		it("should return undefined when arguments is missing", () => {
			const frontmatter = {}

			const result = extractor.extractArguments(frontmatter)

			expect(result).toBeUndefined()
		})

		it("should return undefined when arguments is empty string", () => {
			const frontmatter = {
				arguments: "   ",
			}

			const result = extractor.extractArguments(frontmatter)

			expect(result).toBeUndefined()
		})

		it("should handle arguments with extra whitespace", () => {
			const frontmatter = {
				arguments: "  --verbose  ",
			}

			const result = extractor.extractArguments(frontmatter)

			expect(result).toBe("--verbose")
		})
	})

	describe("extractMetadata", () => {
		it("should extract all metadata from workflow content", () => {
			const content = `---
description: Test workflow
arguments: --verbose
---
Workflow content here`

			const result = extractor.extractMetadata(content)

			expect(result.description).toBe("Test workflow")
			expect(result.arguments).toBe("--verbose")
			expect(result.content).toBe("Workflow content here")
		})

		it("should handle workflow with only description", () => {
			const content = `---
description: Just a description
---
Content`

			const result = extractor.extractMetadata(content)

			expect(result.description).toBe("Just a description")
			expect(result.arguments).toBeUndefined()
			expect(result.content).toBe("Content")
		})

		it("should handle workflow with only arguments", () => {
			const content = `---
arguments: --test
---
Content`

			const result = extractor.extractMetadata(content)

			expect(result.description).toBeUndefined()
			expect(result.arguments).toBe("--test")
			expect(result.content).toBe("Content")
		})

		it("should handle workflow without frontmatter", () => {
			const content = "Plain workflow content"

			const result = extractor.extractMetadata(content)

			expect(result.description).toBeUndefined()
			expect(result.arguments).toBeUndefined()
			expect(result.content).toBe("Plain workflow content")
		})
	})
})

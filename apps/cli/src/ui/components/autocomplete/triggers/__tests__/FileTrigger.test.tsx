import { render } from "ink-testing-library"

import { createFileTrigger, toFileResult, type FileResult } from "../FileTrigger.js"

describe("FileTrigger", () => {
	describe("toFileResult", () => {
		it("should convert FileSearchResult to FileResult with key", () => {
			const input = { path: "src/test.ts", type: "file" as const }
			const result = toFileResult(input)

			expect(result).toEqual({
				key: "src/test.ts",
				path: "src/test.ts",
				type: "file",
				label: undefined,
			})
		})

		it("should include label if provided", () => {
			const input = { path: "src/", type: "folder" as const, label: "Source" }
			const result = toFileResult(input)

			expect(result).toEqual({
				key: "src/",
				path: "src/",
				type: "folder",
				label: "Source",
			})
		})
	})

	describe("detectTrigger", () => {
		const onSearch = vi.fn()
		const getResults = (): FileResult[] => []
		const trigger = createFileTrigger({ onSearch, getResults })

		it("should detect @ trigger with query", () => {
			const result = trigger.detectTrigger("hello @test")

			expect(result).toEqual({
				query: "test",
				triggerIndex: 6,
			})
		})

		it("should detect @ trigger at start of line", () => {
			const result = trigger.detectTrigger("@fil")
			expect(result).toEqual({ query: "fil", triggerIndex: 0 })
		})

		it("should return null when no @ present", () => {
			const result = trigger.detectTrigger("hello world")

			expect(result).toBeNull()
		})

		it("should return null when query contains space", () => {
			const result = trigger.detectTrigger("hello @test file")

			expect(result).toBeNull()
		})

		it("should return null when @ followed by space", () => {
			const result = trigger.detectTrigger("@ ")
			expect(result).toBeNull()
		})

		it("should detect @ trigger even with empty query", () => {
			const result = trigger.detectTrigger("hello @")

			expect(result).toEqual({
				query: "",
				triggerIndex: 6,
			})
		})

		it("should detect @ even without text after it", () => {
			const result = trigger.detectTrigger("@")
			expect(result).toEqual({ query: "", triggerIndex: 0 })
		})

		it("should find last @ in line", () => {
			const result = trigger.detectTrigger("email@test.com @file")

			expect(result).toEqual({
				query: "file",
				triggerIndex: 15,
			})
		})
	})

	describe("getReplacementText", () => {
		const onSearch = vi.fn()
		const getResults = (): FileResult[] => []
		const trigger = createFileTrigger({ onSearch, getResults })

		it("should replace @ trigger with file path", () => {
			const item: FileResult = { key: "src/test.ts", path: "src/test.ts", type: "file" }
			const result = trigger.getReplacementText(item, "hello @tes", 6)

			expect(result).toBe("hello @/src/test.ts ")
		})

		it("should preserve text before @", () => {
			const item: FileResult = { key: "config.json", path: "config.json", type: "file" }
			const result = trigger.getReplacementText(item, "check @co", 6)

			expect(result).toBe("check @/config.json ")
		})

		it("should generate correct replacement text for folders", () => {
			const item = toFileResult({ path: "src/components", type: "folder" })
			const lineText = "@comp"
			const replacement = trigger.getReplacementText(item, lineText, 0)

			expect(replacement).toBe("@/src/components ")
		})

		it("should preserve full path in replacement text", () => {
			const item = toFileResult({
				path: "apps/cli/src/ui/components/autocomplete/PickerSelect.tsx",
				type: "file",
			})
			const lineText = "Fix @Pick"
			const replacement = trigger.getReplacementText(item, lineText, 4)

			// Verify the full path is included without truncation
			expect(replacement).toBe("Fix @/apps/cli/src/ui/components/autocomplete/PickerSelect.tsx ")
			// Verify last character 'x' is present
			expect(replacement).toContain("PickerSelect.tsx ")
			expect(replacement.trim().endsWith(".tsx")).toBe(true)
		})
	})

	describe("search", () => {
		it("should call onSearch and return empty array immediately (async pattern)", () => {
			const onSearch = vi.fn()
			const mockResults: FileResult[] = [{ key: "test.ts", path: "test.ts", type: "file" }]
			const getResults = vi.fn(() => mockResults)
			const trigger = createFileTrigger({ onSearch, getResults })

			const result = trigger.search("test")

			// search() should trigger the API call
			expect(onSearch).toHaveBeenCalledWith("test")
			// search() should return empty immediately for async sources
			// (actual results come via refreshResults when API responds)
			expect(result).toEqual([])
			// getResults should NOT be called by search() - that's the async fix
			expect(getResults).not.toHaveBeenCalled()
		})

		it("should return empty array when no results", () => {
			const onSearch = vi.fn()
			const getResults = vi.fn(() => [])
			const trigger = createFileTrigger({ onSearch, getResults })

			const result = trigger.search("test")

			expect(result).toEqual([])
		})
	})

	describe("refreshResults", () => {
		it("should call getResults and return current results", () => {
			const onSearch = vi.fn()
			const mockResults: FileResult[] = [{ key: "test.ts", path: "test.ts", type: "file" }]
			const getResults = vi.fn(() => mockResults)
			const trigger = createFileTrigger({ onSearch, getResults })

			const result = trigger.refreshResults!("test")

			// refreshResults should call getResults (not onSearch)
			expect(getResults).toHaveBeenCalled()
			expect(onSearch).not.toHaveBeenCalled()
			expect(result).toEqual(mockResults)
		})

		it("should sort results by fuzzy match score (best matches first)", () => {
			const onSearch = vi.fn()
			const mockResults: FileResult[] = [
				{ key: "src/components/Button.tsx", path: "src/components/Button.tsx", type: "file" },
				{ key: "app.ts", path: "app.ts", type: "file" },
				{ key: "src/app.tsx", path: "src/app.tsx", type: "file" },
				{ key: "tests/app.test.ts", path: "tests/app.test.ts", type: "file" },
			]
			const getResults = vi.fn(() => mockResults)
			const trigger = createFileTrigger({ onSearch, getResults })

			const result = trigger.refreshResults!("app") as FileResult[]

			// Results should be sorted with best matches first
			// "app.ts" should rank higher than "src/app.tsx" or "tests/app.test.ts"
			expect(result[0]?.path).toBe("app.ts")
		})

		it("should filter out results that don't match well", () => {
			const onSearch = vi.fn()
			const mockResults: FileResult[] = [
				{ key: "src/test.ts", path: "src/test.ts", type: "file" },
				{ key: "config.json", path: "config.json", type: "file" },
			]
			const getResults = vi.fn(() => mockResults)
			const trigger = createFileTrigger({ onSearch, getResults })

			const result = trigger.refreshResults!("xyz") as FileResult[]

			// Results that don't match well are filtered out by fuzzysort
			expect(result.length).toBeLessThan(mockResults.length)
		})

		it("should return results sorted with partial matches", () => {
			const onSearch = vi.fn()
			const mockResults: FileResult[] = [
				{ key: "src/test.ts", path: "src/test.ts", type: "file" },
				{ key: "tests/unit.ts", path: "tests/unit.ts", type: "file" },
				{ key: "package.json", path: "package.json", type: "file" },
			]
			const getResults = vi.fn(() => mockResults)
			const trigger = createFileTrigger({ onSearch, getResults })

			const result = trigger.refreshResults!("test") as FileResult[]

			// Should return files that match "test"
			expect(result.length).toBeGreaterThan(0)
			// All returned results should contain "test" in their path
			result.forEach((r: FileResult) => {
				expect(r.path.toLowerCase()).toContain("test")
			})
		})
	})

	describe("renderItem", () => {
		const onSearch = vi.fn()
		const getResults = (): FileResult[] => []
		const trigger = createFileTrigger({ onSearch, getResults })

		it("should render file items correctly", () => {
			const item = toFileResult({ path: "src/index.ts", type: "file" })
			const { lastFrame } = render(trigger.renderItem(item, false) as React.ReactElement)

			// Verify the path is present in the rendered output
			expect(lastFrame()).toContain("src/index.ts")
		})

		it("should render folder items correctly", () => {
			const item = toFileResult({ path: "src/components", type: "folder" })
			const { lastFrame } = render(trigger.renderItem(item, false) as React.ReactElement)

			// Verify the path is present in the rendered output
			expect(lastFrame()).toContain("src/components")
		})

		it("should render full path without truncation in UI", () => {
			const item = toFileResult({
				path: "apps/cli/src/ui/components/autocomplete/PickerSelect.tsx",
				type: "file",
			})
			const { lastFrame } = render(trigger.renderItem(item, false) as React.ReactElement)

			const output = lastFrame()
			// Verify the full path is rendered without truncation
			expect(output).toContain("PickerSelect.tsx")
			// Verify the last character 'x' is present
			expect(output).toContain("x")
			// Verify no truncation occurred
			expect(output).not.toMatch(/PickerSelect\.ts[^x]/)
		})
	})
})

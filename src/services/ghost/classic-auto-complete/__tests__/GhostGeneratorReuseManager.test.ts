import { GhostGeneratorReuseManager } from "../GhostGeneratorReuseManager"
import { GhostPrompt } from "../GhostInlineCompletionProvider"

describe("GhostGeneratorReuseManager", () => {
	const createMockPrompt = (strategy: "fim" | "hole_filler" = "fim"): GhostPrompt => {
		if (strategy === "fim") {
			return {
				strategy: "fim",
				formattedPrefix: "test prefix",
				prunedSuffix: "test suffix",
				autocompleteInput: {
					completionId: "test-id",
					filepath: "/test/file.ts",
					pos: { line: 0, character: 0 },
					recentlyEditedRanges: [],
					recentlyVisitedRanges: [],
					selectedCompletionInfo: undefined,
					injectDetails: undefined,
					isUntitledFile: false,
				},
			}
		}
		return {
			strategy: "hole_filler",
			systemPrompt: "test system",
			userPrompt: "test user",
			autocompleteInput: {
				completionId: "test-id",
				filepath: "/test/file.ts",
				pos: { line: 0, character: 0 },
				recentlyEditedRanges: [],
				recentlyVisitedRanges: [],
				selectedCompletionInfo: undefined,
				injectDetails: undefined,
				isUntitledFile: false,
			},
		}
	}

	describe("shouldReuseExistingGenerator", () => {
		it("should return false when no pending suggestion exists", () => {
			const manager = new GhostGeneratorReuseManager(vi.fn())

			expect(manager.shouldReuseExistingGenerator("prefix", "suffix")).toBe(false)
		})

		it("should return true when prefix extends and completion matches", async () => {
			const manager = new GhostGeneratorReuseManager(vi.fn())

			async function* source(): AsyncGenerator<string> {
				yield "completion"
			}

			manager.createGenerator("const x = ", ";\n", createMockPrompt(), () => source())

			// Wait for generator to complete
			await manager.getPendingSuggestion()?.generator.waitForCompletion()

			// User typed "c" which matches the start of "completion"
			expect(manager.shouldReuseExistingGenerator("const x = c", ";\n")).toBe(true)
		})

		it("should return false when suffix changes", async () => {
			const manager = new GhostGeneratorReuseManager(vi.fn())

			async function* source(): AsyncGenerator<string> {
				yield "completion"
			}

			manager.createGenerator("const x = ", ";\n", createMockPrompt(), () => source())

			await manager.getPendingSuggestion()?.generator.waitForCompletion()

			// Suffix changed (cursor moved)
			expect(manager.shouldReuseExistingGenerator("const x = c", "// different\n")).toBe(false)
		})

		it("should return false when typed characters don't match completion", async () => {
			const manager = new GhostGeneratorReuseManager(vi.fn())

			async function* source(): AsyncGenerator<string> {
				yield "completion"
			}

			manager.createGenerator("const x = ", ";\n", createMockPrompt(), () => source())

			await manager.getPendingSuggestion()?.generator.waitForCompletion()

			// User typed "z" which doesn't match "completion"
			expect(manager.shouldReuseExistingGenerator("const x = z", ";\n")).toBe(false)
		})

		it("should return false for backspace (prefix got shorter)", async () => {
			const manager = new GhostGeneratorReuseManager(vi.fn())

			async function* source(): AsyncGenerator<string> {
				yield "completion"
			}

			manager.createGenerator("const x = ", ";\n", createMockPrompt(), () => source())

			await manager.getPendingSuggestion()?.generator.waitForCompletion()

			// User pressed backspace
			expect(manager.shouldReuseExistingGenerator("const x =", ";\n")).toBe(false)
		})
	})

	describe("getCompletion", () => {
		it("should create a new generator when none exists", async () => {
			const manager = new GhostGeneratorReuseManager(vi.fn())
			const generatorFactory = vi.fn().mockImplementation(function* () {
				yield "test completion"
			})

			const result = await manager.getCompletion("prefix", "suffix", createMockPrompt(), generatorFactory)

			expect(generatorFactory).toHaveBeenCalled()
			expect(result.text).toBe("test completion")
			expect(result.reused).toBe(false)
		})

		it("should reuse existing generator when possible", async () => {
			const manager = new GhostGeneratorReuseManager(vi.fn())

			async function* source(): AsyncGenerator<string> {
				yield "completion"
			}

			// First request
			await manager.getCompletion("const x = ", ";\n", createMockPrompt(), () => source())

			// Second request with extended prefix
			const generatorFactory = vi.fn()
			const result = await manager.getCompletion("const x = c", ";\n", createMockPrompt(), generatorFactory)

			// Should not have created a new generator
			expect(generatorFactory).not.toHaveBeenCalled()
			expect(result.reused).toBe(true)
			// Should have stripped the "c" that was typed
			expect(result.text).toBe("ompletion")
		})

		it("should strip multiple typed characters", async () => {
			const manager = new GhostGeneratorReuseManager(vi.fn())

			async function* source(): AsyncGenerator<string> {
				yield "completion"
			}

			// First request
			await manager.getCompletion("const x = ", ";\n", createMockPrompt(), () => source())

			// User typed "comp"
			const result = await manager.getCompletion("const x = comp", ";\n", createMockPrompt(), vi.fn())

			expect(result.text).toBe("letion")
		})

		it("should cancel old generator when creating new one", async () => {
			const manager = new GhostGeneratorReuseManager(vi.fn())

			async function* source1(): AsyncGenerator<string> {
				yield "first"
				await new Promise((resolve) => setTimeout(resolve, 1000))
				yield "second"
			}

			async function* source2(): AsyncGenerator<string> {
				yield "new completion"
			}

			// Start first generator
			const generator1 = manager.createGenerator("prefix1", "suffix", createMockPrompt(), () => source1())

			// Wait a bit
			await new Promise((resolve) => setTimeout(resolve, 10))

			// Create second generator (should cancel first)
			await manager.getCompletion("prefix2", "suffix", createMockPrompt(), () => source2())

			// First generator should have been cancelled
			expect(generator1.isCancelled).toBe(true)
		})
	})

	describe("streamCompletion", () => {
		it("should yield chunks as they arrive", async () => {
			const manager = new GhostGeneratorReuseManager(vi.fn())

			async function* source(): AsyncGenerator<string> {
				yield "Hello"
				yield " "
				yield "World"
			}

			const chunks: string[] = []
			const stream = manager.streamCompletion("prefix", "suffix", createMockPrompt(), () => source())

			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			expect(chunks).toEqual(["Hello", " ", "World"])
		})

		it("should strip typed characters from stream", async () => {
			const manager = new GhostGeneratorReuseManager(vi.fn())

			async function* source(): AsyncGenerator<string> {
				yield "completion"
			}

			// First request
			const stream1 = manager.streamCompletion("const x = ", ";\n", createMockPrompt(), () => source())
			const chunks1: string[] = []
			for await (const chunk of stream1) {
				chunks1.push(chunk)
			}

			// Second request with "c" typed
			const stream2 = manager.streamCompletion("const x = c", ";\n", createMockPrompt(), vi.fn())
			const chunks2: string[] = []
			for await (const chunk of stream2) {
				chunks2.push(chunk)
			}

			expect(chunks2.join("")).toBe("ompletion")
		})
	})

	describe("cancel", () => {
		it("should cancel pending generator", async () => {
			const manager = new GhostGeneratorReuseManager(vi.fn())

			async function* source(): AsyncGenerator<string> {
				yield "first"
				await new Promise((resolve) => setTimeout(resolve, 1000))
				yield "second"
			}

			const generator = manager.createGenerator("prefix", "suffix", createMockPrompt(), () => source())

			// Wait for first yield
			await new Promise((resolve) => setTimeout(resolve, 10))

			manager.cancel()

			expect(manager.getPendingSuggestion()).toBe(null)
			expect(generator.isCancelled).toBe(true)
		})
	})

	describe("hasPendingGeneration", () => {
		it("should return true when generation is in progress", async () => {
			const manager = new GhostGeneratorReuseManager(vi.fn())

			async function* source(): AsyncGenerator<string> {
				yield "first"
				await new Promise((resolve) => setTimeout(resolve, 100))
				yield "second"
			}

			manager.createGenerator("prefix", "suffix", createMockPrompt(), () => source())

			expect(manager.hasPendingGeneration()).toBe(true)
		})

		it("should return false when generation is complete", async () => {
			const manager = new GhostGeneratorReuseManager(vi.fn())

			async function* source(): AsyncGenerator<string> {
				yield "completion"
			}

			manager.createGenerator("prefix", "suffix", createMockPrompt(), () => source())

			await manager.getPendingSuggestion()?.generator.waitForCompletion()

			expect(manager.hasPendingGeneration()).toBe(false)
		})

		it("should return false when no pending suggestion", () => {
			const manager = new GhostGeneratorReuseManager(vi.fn())

			expect(manager.hasPendingGeneration()).toBe(false)
		})
	})

	describe("clear", () => {
		it("should clear pending suggestion without cancelling", async () => {
			const manager = new GhostGeneratorReuseManager(vi.fn())

			async function* source(): AsyncGenerator<string> {
				yield "completion"
			}

			const generator = manager.createGenerator("prefix", "suffix", createMockPrompt(), () => source())

			await generator.waitForCompletion()

			manager.clear()

			expect(manager.getPendingSuggestion()).toBe(null)
			// Generator should still be accessible and not cancelled
			expect(generator.isCancelled).toBe(false)
		})
	})
})

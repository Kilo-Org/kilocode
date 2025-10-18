import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { getAutocompleteContext } from "./autocompleteContextFetching"
import { Position } from "../.."
import { IDE, ILLM } from "../../index"
import { FakeConfigHandler } from "../../test/FakeConfigHandler"

// Mock dependencies
vi.mock("../../indexing/ignore", () => ({
	isSecurityConcern: vi.fn(),
}))

vi.mock("../../autocomplete/util/HelperVars", () => ({
	HelperVars: {
		create: vi.fn(),
	},
}))

vi.mock("../../autocomplete/context/ContextRetrievalService", () => ({
	ContextRetrievalService: vi.fn().mockImplementation(() => ({
		initializeForFile: vi.fn(),
	})),
}))

vi.mock("../../autocomplete/snippets/getAllSnippets", () => ({
	getAllSnippetsWithoutRace: vi.fn(),
}))

vi.mock("../../autocomplete/templating", () => ({
	renderPrompt: vi.fn(),
}))

// Import mocked modules
import { HelperVars } from "../../autocomplete/util/HelperVars"
import { getAllSnippetsWithoutRace } from "../../autocomplete/snippets/getAllSnippets"
import { renderPrompt } from "../../autocomplete/templating"
import { isSecurityConcern } from "../../indexing/ignore"

describe("autocompleteContextFetching", () => {
	let mockIde: IDE
	let mockConfigHandler: FakeConfigHandler
	let mockGetDefinitionsFromLsp: any

	beforeEach(() => {
		// Reset all mocks
		vi.clearAllMocks()

		// Mock IDE
		mockIde = {
			getWorkspaceDirs: vi.fn().mockResolvedValue(["/workspace"]),
			readFile: vi.fn().mockResolvedValue("file content"),
		} as any

		// Mock config handler
		mockConfigHandler = new FakeConfigHandler({
			autocompleteModel: {
				title: "test-model",
				model: "gpt-4",
				autocompleteOptions: {},
			} as any,
		})

		mockGetDefinitionsFromLsp = vi.fn().mockResolvedValue([])

		// Mock HelperVars
		;(HelperVars.create as any).mockResolvedValue({
			filepath: "test.ts",
			pos: { line: 0, character: 0 },
		})

		// Mock getAllSnippetsWithoutRace
		;(getAllSnippetsWithoutRace as any).mockResolvedValue({
			snippets: [],
			context: "",
		})

		// Mock renderPrompt
		;(renderPrompt as any).mockReturnValue({
			prompt: "test prompt",
			prefix: "test prefix context",
			suffix: "",
			completionOptions: {},
		})

		// Mock isSecurityConcern
		;(isSecurityConcern as any).mockReturnValue(false)
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	const mockPosition: Position = { line: 10, character: 5 }

	describe("getAutocompleteContext", () => {
		it("should successfully fetch autocomplete context", async () => {
			const loadConfigSpy = vi.spyOn(mockConfigHandler, "loadConfig")

			const result = await getAutocompleteContext(
				"test.ts",
				mockPosition,
				mockIde,
				mockConfigHandler,
				mockGetDefinitionsFromLsp,
				[],
				[],
				1000,
				"const a = 1;",
			)

			expect(result).toBe("test prefix context")
			expect(loadConfigSpy).toHaveBeenCalled()
		})

		it("should throw error when config is not available", async () => {
			mockConfigHandler.loadConfig = async () => ({ config: null as any })

			await expect(
				getAutocompleteContext(
					"test.ts",
					mockPosition,
					mockIde,
					mockConfigHandler,
					mockGetDefinitionsFromLsp,
					[],
					[],
					1000,
					"const a = 1;",
				),
			).rejects.toThrow("No config available")
		})

		it("should throw error for security concern files", async () => {
			;(isSecurityConcern as any).mockReturnValue(true)

			await expect(
				getAutocompleteContext(
					"test.ts",
					mockPosition,
					mockIde,
					mockConfigHandler,
					mockGetDefinitionsFromLsp,
					[],
					[],
					1000,
					"const a = 1;",
				),
			).rejects.toThrow("File is a security concern, autocomplete disabled")
		})

		it("should use provided model string when specified", async () => {
			;(HelperVars.create as any).mockClear()

			await getAutocompleteContext(
				"test.ts",
				mockPosition,
				mockIde,
				mockConfigHandler,
				mockGetDefinitionsFromLsp,
				[],
				[],
				1000,
				"const a = 1;",
				"test-model",
			)

			expect(HelperVars.create).toHaveBeenCalledWith(
				expect.anything(),
				expect.anything(),
				"gpt-4", // Should use the model from config that matches "test-model"
				mockIde,
			)
		})

		it("should use provided ILLM object when specified", async () => {
			;(HelperVars.create as any).mockClear()

			const customModel: ILLM = {
				title: "custom-model",
				model: "custom-gpt",
				autocompleteOptions: {},
			} as any

			await getAutocompleteContext(
				"test.ts",
				mockPosition,
				mockIde,
				mockConfigHandler,
				mockGetDefinitionsFromLsp,
				[],
				[],
				1000,
				"const a = 1;",
				customModel,
			)

			expect(HelperVars.create).toHaveBeenCalledWith(expect.anything(), expect.anything(), "custom-gpt", mockIde)
		})

		it("should throw error when no autocomplete model configured and none provided", async () => {
			const testConfigHandler = new FakeConfigHandler({
				config: {
					modelsByRole: { autocomplete: [] },
					selectedModelByRole: { autocomplete: undefined },
				},
			})

			await expect(
				getAutocompleteContext(
					"test.ts",
					mockPosition,
					mockIde,
					testConfigHandler,
					mockGetDefinitionsFromLsp,
					[],
					[],
					1000,
					"const a = 1;",
				),
			).rejects.toThrow("No autocomplete model configured and no model provided")
		})

		it("should handle recently edited and visited ranges", async () => {
			;(getAllSnippetsWithoutRace as any).mockClear()

			const recentlyEditedRanges = [
				{
					filepath: "test.ts",
					range: {
						start: { line: 0, character: 0 },
						end: { line: 0, character: 5 },
					},
				},
			]
			const recentlyVisitedRanges = [{ filepath: "other.ts", contents: "test", score: 1.0 }]

			await getAutocompleteContext(
				"test.ts",
				mockPosition,
				mockIde,
				mockConfigHandler,
				mockGetDefinitionsFromLsp,
				recentlyEditedRanges as any,
				recentlyVisitedRanges as any,
				1000,
				"const a = 1;",
			)

			expect(getAllSnippetsWithoutRace).toHaveBeenCalledWith({
				helper: expect.anything(),
				ide: mockIde,
				getDefinitionsFromLsp: mockGetDefinitionsFromLsp,
				contextRetrievalService: expect.anything(),
			})
		})

		it("should apply maxPromptTokens override", async () => {
			;(HelperVars.create as any).mockClear()

			await getAutocompleteContext(
				"test.ts",
				mockPosition,
				mockIde,
				mockConfigHandler,
				mockGetDefinitionsFromLsp,
				[],
				[],
				2000,
				"const a = 1;",
			)

			expect(HelperVars.create).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({ maxPromptTokens: 2000 }),
				expect.anything(),
				mockIde,
			)
		})
	})
})

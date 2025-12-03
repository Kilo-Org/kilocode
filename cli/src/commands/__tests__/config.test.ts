import { describe, it, expect, vi, beforeEach } from "vitest"
import { configCommand } from "../config.js"
import type { CommandContext } from "../core/types.js"
import { startInteractiveConfigEditor } from "../../config/interactiveEditor.js"
import { createMockContext } from "./helpers/mockContext.js"

// Mock the interactive config editor
vi.mock("../../config/interactiveEditor.js", () => ({
	startInteractiveConfigEditor: vi.fn(),
}))

describe("configCommand", () => {
	let mockContext: CommandContext
	let addMessageSpy: ReturnType<typeof vi.fn>

	beforeEach(() => {
		vi.clearAllMocks()
		addMessageSpy = vi.fn()

		mockContext = createMockContext({
			input: "/config",
			addMessage: addMessageSpy,
		})
	})

	it("should have correct metadata", () => {
		expect(configCommand.name).toBe("config")
		expect(configCommand.aliases).toContain("c")
		expect(configCommand.aliases).toContain("settings")
		expect(configCommand.category).toBe("settings")
		expect(configCommand.priority).toBe(8)
	})

	it("should start interactive config editor successfully", async () => {
		vi.mocked(startInteractiveConfigEditor).mockResolvedValue(undefined)

		await configCommand.handler(mockContext)

		expect(addMessageSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "system",
				content: "Starting interactive configuration editor...",
			}),
		)
		expect(startInteractiveConfigEditor).toHaveBeenCalledWith(mockContext)
	})
})

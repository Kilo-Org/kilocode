import { describe, it, expect, vi, beforeEach } from "vitest"
import { configCommand } from "../config.js"
import type { CommandContext } from "../core/types.js"
import openConfigFile from "../../config/openConfig.js"
import { createMockContext } from "./helpers/mockContext.js"

// Mock the openConfigFile function
vi.mock("../../config/openConfig.js", () => ({
	default: vi.fn(),
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

	it("should open config file successfully", async () => {
		vi.mocked(openConfigFile).mockResolvedValue(undefined)

		await configCommand.handler(mockContext)

		expect(addMessageSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "system",
				content: "Opening configuration file...",
			}),
		)
		expect(openConfigFile).toHaveBeenCalled()
	})
})

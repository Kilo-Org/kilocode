import { describe, it, expect, vi, beforeEach } from "vitest"
import { configCommand } from "../config.js"
import type { CommandContext } from "../core/types.js"
import openConfigFile from "../../config/openConfig.js"

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

		mockContext = {
			input: "/config",
			args: [],
			options: {},
			sendMessage: vi.fn(),
			addMessage: addMessageSpy,
			clearMessages: vi.fn(),
			replaceMessages: vi.fn(),
			clearTask: vi.fn(),
			setMode: vi.fn(),
			exit: vi.fn(),
			routerModels: null,
			currentProvider: null,
			kilocodeDefaultModel: "",
			updateProviderModel: vi.fn(),
			refreshRouterModels: vi.fn(),
			updateProvider: vi.fn(),
			profileData: null,
			balanceData: null,
			profileLoading: false,
			balanceLoading: false,
		}
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

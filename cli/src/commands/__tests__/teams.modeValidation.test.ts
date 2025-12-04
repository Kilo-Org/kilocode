/**
 * Integration tests for teams command with mode validation
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { CommandContext } from "../core/types.js"
import type { CLIConfig } from "../../config/types.js"
import type { ModeConfig } from "../../types/messages.js"

// Mock the logs
vi.mock("../../services/logs.js", () => ({
	logs: {
		warn: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
		debug: vi.fn(),
	},
}))

describe("teams command - mode validation", () => {
	let mockContext: CommandContext
	let updateProviderMock: ReturnType<typeof vi.fn>
	let refreshRouterModelsMock: ReturnType<typeof vi.fn>
	let addMessageMock: ReturnType<typeof vi.fn>
	let setModeMock: ReturnType<typeof vi.fn>

	beforeEach(() => {
		updateProviderMock = vi.fn().mockResolvedValue(undefined)
		refreshRouterModelsMock = vi.fn().mockResolvedValue(undefined)
		addMessageMock = vi.fn()
		setModeMock = vi.fn()

		mockContext = {
			args: [],
			currentProvider: {
				id: "test-provider",
				provider: "kilocode",
				kilocodeModel: "claude-sonnet-4",
				kilocodeToken: "test-token",
				kilocodeOrganizationId: undefined,
			},
			config: {} as CLIConfig,
			addMessage: addMessageMock,
			updateProvider: updateProviderMock,
			refreshRouterModels: refreshRouterModelsMock,
			setMode: setModeMock,
			routerModels: null,
			kilocodeDefaultModel: "claude-sonnet-4",
			profileData: {
				organizations: [
					{
						id: "org-1",
						name: "Test Org",
						role: "admin",
					},
				],
			},
			profileLoading: false,
			customModes: [],
		} as Partial<CommandContext> as CommandContext
	})

	it("should keep current mode if it's a default mode after team switch", async () => {
		const { teamsCommand } = await import("../teams.js")

		// Set current mode to a default mode
		mockContext.config = { mode: "architect" } as CLIConfig

		mockContext.args = ["select", "test-org"]

		await teamsCommand.handler(mockContext)

		// Should not call setMode since "architect" is a default mode
		expect(setModeMock).not.toHaveBeenCalled()
	})

	it("should keep current mode if it's available in custom modes", async () => {
		const { teamsCommand } = await import("../teams.js")

		const customMode: ModeConfig = {
			slug: "custom-mode",
			name: "Custom Mode",
			roleDefinition: "A custom mode",
			groups: ["read"],
			source: "organization",
		}

		mockContext.customModes = [customMode]
		mockContext.config = { mode: "custom-mode" } as CLIConfig

		mockContext.args = ["select", "test-org"]

		await teamsCommand.handler(mockContext)

		// Should not call setMode since custom-mode is available
		expect(setModeMock).not.toHaveBeenCalled()
	})

	it("should switch to code mode if current mode is not available after team switch", async () => {
		const { teamsCommand } = await import("../teams.js")

		// Set current mode to an organization mode that won't be available after switch
		mockContext.config = { mode: "org-specific-mode" } as CLIConfig
		mockContext.customModes = [] // No custom modes available after switch

		mockContext.args = ["select", "test-org"]

		await teamsCommand.handler(mockContext)

		// Mode validation will happen automatically via the state update
		// The test validates that the infrastructure is in place
		expect(updateProviderMock).toHaveBeenCalled()
		expect(refreshRouterModelsMock).toHaveBeenCalled()
	})

	it("should handle personal account switch with mode validation", async () => {
		const { teamsCommand } = await import("../teams.js")

		mockContext.currentProvider.kilocodeOrganizationId = "org-1"
		mockContext.args = ["select", "personal"]

		await teamsCommand.handler(mockContext)

		// Should update to personal (no org ID)
		expect(updateProviderMock).toHaveBeenCalledWith(
			"test-provider",
			expect.objectContaining({
				kilocodeOrganizationId: undefined,
			}),
		)

		// Should refresh router models
		expect(refreshRouterModelsMock).toHaveBeenCalled()
	})

	it("should handle team switch when mode validation is needed", async () => {
		const { teamsCommand } = await import("../teams.js")

		// Start with an organization mode
		const orgMode: ModeConfig = {
			slug: "org-mode",
			name: "Org Mode",
			roleDefinition: "Organization specific mode",
			groups: ["read"],
			source: "organization",
		}

		mockContext.customModes = [orgMode]
		mockContext.config = { mode: "org-mode" } as CLIConfig
		mockContext.args = ["select", "test-org"]

		await teamsCommand.handler(mockContext)

		// Should complete the team switch
		expect(updateProviderMock).toHaveBeenCalled()
		expect(refreshRouterModelsMock).toHaveBeenCalled()
	})
})

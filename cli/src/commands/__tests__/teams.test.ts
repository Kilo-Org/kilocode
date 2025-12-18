/**
 * Tests for the /teams command
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { teamsCommand } from "../teams.js"
import type { CommandContext } from "../core/types.js"
import { createMockContext } from "./helpers/mockContext.js"

describe("/teams command", () => {
	let mockContext: CommandContext
	let addMessageMock: ReturnType<typeof vi.fn>
	let updateProviderMock: ReturnType<typeof vi.fn>

	beforeEach(() => {
		addMessageMock = vi.fn()
		updateProviderMock = vi.fn().mockResolvedValue(undefined)

		mockContext = createMockContext({
			input: "/teams",
			addMessage: addMessageMock,
			currentProvider: {
				id: "test-provider",
				provider: "kilocode",
				kilocodeToken: "test-token",
			},
			kilocodeDefaultModel: "test-model",
			updateProvider: updateProviderMock,
		})
	})

	describe("Command metadata", () => {
		it("should have correct name", () => {
			expect(teamsCommand.name).toBe("teams")
		})

		it("should have correct aliases", () => {
			expect(teamsCommand.aliases).toEqual(["team", "org", "orgs"])
		})

		it("should have correct description", () => {
			expect(teamsCommand.description).toBe("Manage team/organization selection")
		})

		it("should have correct category", () => {
			expect(teamsCommand.category).toBe("settings")
		})

		it("should have correct priority", () => {
			expect(teamsCommand.priority).toBe(10)
		})

		it("should have correct usage", () => {
			expect(teamsCommand.usage).toBe("/teams [subcommand] [args]")
		})

		it("should have examples", () => {
			expect(teamsCommand.examples).toContain("/teams")
			expect(teamsCommand.examples).toContain("/teams select personal")
		})
	})

	describe("Authentication check", () => {
		it("should show error when not using Kilocode provider", async () => {
			mockContext.currentProvider = {
				id: "test-provider",
				provider: "anthropic",
			}

			await teamsCommand.handler(mockContext)

			expect(addMessageMock).toHaveBeenCalledTimes(1)
			const message = addMessageMock.mock.calls[0][0]
			expect(message.type).toBe("error")
			expect(message.content).toContain("Teams command requires Kilocode provider")
		})

		it("should show error when not authenticated", async () => {
			mockContext.currentProvider = {
				id: "test-provider",
				provider: "kilocode",
			}

			await teamsCommand.handler(mockContext)

			expect(addMessageMock).toHaveBeenCalledTimes(1)
			const message = addMessageMock.mock.calls[0][0]
			expect(message.type).toBe("error")
			expect(message.content).toContain("Not authenticated")
		})
	})

	describe("List teams (no args)", () => {
		it("should show loading message when profile is loading", async () => {
			mockContext.currentProvider = {
				id: "test-provider",
				provider: "kilocode",
				kilocodeToken: "test-token",
			}
			mockContext.profileLoading = true

			await teamsCommand.handler(mockContext)

			expect(addMessageMock).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "system",
					content: "Loading available teams...",
				}),
			)
		})

		it("should direct user to create a new organization when they don't have any", async () => {
			mockContext.currentProvider = {
				id: "test-provider",
				provider: "kilocode",
				kilocodeToken: "test-token",
			}
			mockContext.profileData = {
				user: {},
				organizations: [],
			}
			mockContext.profileLoading = false

			await teamsCommand.handler(mockContext)

			const message = addMessageMock.mock.calls[0][0]
			expect(message.type).toBe("system")
			expect(message.content).toContain("https://app.kilo.ai/get-started/teams")
		})

		it("should list all teams including organizations", async () => {
			mockContext.currentProvider = {
				id: "test-provider",
				provider: "kilocode",
				kilocodeToken: "test-token",
			}
			mockContext.profileData = {
				user: {},
				organizations: [
					{
						id: "org-1",
						name: "Team Alpha",
						role: "admin",
					},
					{
						id: "org-2",
						name: "Team Beta",
						role: "member",
					},
				],
			}
			mockContext.profileLoading = false

			await teamsCommand.handler(mockContext)

			const message = addMessageMock.mock.calls[0][0]
			expect(message.content).toContain("Personal")
			expect(message.content).toContain("team-alpha")
			expect(message.content).toContain("team-beta")
		})

		it("should mark current organization with arrow", async () => {
			mockContext.currentProvider = {
				id: "test-provider",
				provider: "kilocode",
				kilocodeToken: "test-token",
				kilocodeOrganizationId: "org-1",
			}
			mockContext.profileData = {
				user: {},
				organizations: [
					{
						id: "org-1",
						name: "Current Team",
						role: "admin",
					},
				],
			}
			mockContext.profileLoading = false

			await teamsCommand.handler(mockContext)

			const message = addMessageMock.mock.calls[0][0]
			expect(message.content).toContain("→ current-team (current)")
		})
	})

	describe("Select team subcommand", () => {
		it("should switch to personal account", async () => {
			mockContext.args = ["select", "personal"]
			mockContext.currentProvider = {
				id: "test-provider",
				provider: "kilocode",
				kilocodeToken: "test-token",
			}

			await teamsCommand.handler(mockContext)

			expect(updateProviderMock).toHaveBeenCalledWith("test-provider", {
				kilocodeOrganizationId: undefined,
			})

			const successMessage = addMessageMock.mock.calls.find((call: unknown[]) => {
				const msg = call[0] as { content?: string }
				return msg.content?.includes("Switched to")
			})
			expect(successMessage).toBeDefined()
			if (successMessage) {
				const msg = successMessage[0] as { content: string }
				expect(msg.content).toContain("Personal")
			}
		})

		it("should switch to organization by ID", async () => {
			mockContext.args = ["select", "org-123"]
			mockContext.currentProvider = {
				id: "test-provider",
				provider: "kilocode",
				kilocodeToken: "test-token",
			}
			mockContext.profileData = {
				user: {},
				organizations: [
					{
						id: "org-123",
						name: "Target Team",
						role: "member",
					},
				],
			}

			await teamsCommand.handler(mockContext)

			expect(updateProviderMock).toHaveBeenCalledWith("test-provider", {
				kilocodeOrganizationId: "org-123",
			})

			const successMessage = addMessageMock.mock.calls.find((call: unknown[]) => {
				const msg = call[0] as { content?: string }
				return msg.content?.includes("Switched to team")
			})
			expect(successMessage).toBeDefined()
			if (successMessage) {
				const msg = successMessage[0] as { content: string }
				expect(msg.content).toContain("Target Team")
			}
		})

		it("should switch to organization by normalized name", async () => {
			mockContext.args = ["select", "kilo-code"]
			mockContext.currentProvider = {
				id: "test-provider",
				provider: "kilocode",
				kilocodeToken: "test-token",
			}
			mockContext.profileData = {
				user: {},
				organizations: [
					{
						id: "org-456",
						name: "Kilo Code",
						role: "admin",
					},
				],
			}

			await teamsCommand.handler(mockContext)

			expect(updateProviderMock).toHaveBeenCalledWith("test-provider", {
				kilocodeOrganizationId: "org-456",
			})

			const successMessage = addMessageMock.mock.calls.find((call: unknown[]) => {
				const msg = call[0] as { content?: string }
				return msg.content?.includes("Switched to team")
			})
			expect(successMessage).toBeDefined()
			if (successMessage) {
				const msg = successMessage[0] as { content: string }
				expect(msg.content).toContain("Kilo Code")
			}
		})

		it("should normalize team names with spaces and special characters", async () => {
			mockContext.args = ["select", "my-awesome-team"]
			mockContext.currentProvider = {
				id: "test-provider",
				provider: "kilocode",
				kilocodeToken: "test-token",
			}
			mockContext.profileData = {
				user: {},
				organizations: [
					{
						id: "org-789",
						name: "My Awesome Team!",
						role: "member",
					},
				],
			}

			await teamsCommand.handler(mockContext)

			expect(updateProviderMock).toHaveBeenCalledWith("test-provider", {
				kilocodeOrganizationId: "org-789",
			})

			const successMessage = addMessageMock.mock.calls.find((call: unknown[]) => {
				const msg = call[0] as { content?: string }
				return msg.content?.includes("Switched to team")
			})
			expect(successMessage).toBeDefined()
			if (successMessage) {
				const msg = successMessage[0] as { content: string }
				expect(msg.content).toContain("My Awesome Team!")
			}
		})

		it("should show error for invalid team ID", async () => {
			mockContext.args = ["select", "invalid-org"]
			mockContext.currentProvider = {
				id: "test-provider",
				provider: "kilocode",
				kilocodeToken: "test-token",
			}
			mockContext.profileData = {
				user: {},
				organizations: [],
			}

			await teamsCommand.handler(mockContext)

			const errorMessage = addMessageMock.mock.calls.find((call: unknown[]) => {
				const msg = call[0] as { type: string; content?: string }
				return msg.type === "error" && msg.content?.includes("not found")
			})
			expect(errorMessage).toBeDefined()
		})

		it("should show error when team ID is missing", async () => {
			mockContext.args = ["select"]
			mockContext.currentProvider = {
				id: "test-provider",
				provider: "kilocode",
				kilocodeToken: "test-token",
			}

			await teamsCommand.handler(mockContext)

			expect(addMessageMock).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "error",
					content: expect.stringContaining("Usage: /teams select"),
				}),
			)
		})

		it("should show error when profile data is not loaded", async () => {
			mockContext.args = ["select", "org-123"]
			mockContext.currentProvider = {
				id: "test-provider",
				provider: "kilocode",
				kilocodeToken: "test-token",
			}
			mockContext.profileData = null

			await teamsCommand.handler(mockContext)

			const errorMessage = addMessageMock.mock.calls.find((call: unknown[]) => {
				const msg = call[0] as { type: string; content?: string }
				return msg.type === "error" && msg.content?.includes("Failed to switch team")
			})
			expect(errorMessage).toBeDefined()
		})
	})

	describe("Invalid subcommand", () => {
		it("should show error for unknown subcommand", async () => {
			mockContext.args = ["unknown"]
			mockContext.currentProvider = {
				id: "test-provider",
				provider: "kilocode",
				kilocodeToken: "test-token",
			}

			await teamsCommand.handler(mockContext)

			expect(addMessageMock).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "error",
					content: expect.stringContaining("Unknown subcommand"),
				}),
			)
		})
	})
})

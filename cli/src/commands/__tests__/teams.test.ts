/**
 * Tests for the /teams command
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { teamsCommand } from "../teams.js"
import type { CommandContext } from "../core/types.js"

describe("/teams command", () => {
	let mockContext: CommandContext
	let addMessageMock: ReturnType<typeof vi.fn>
	let extensionHostMock: any
	let saveConfigMock: ReturnType<typeof vi.fn>

	beforeEach(() => {
		addMessageMock = vi.fn()
		saveConfigMock = vi.fn().mockResolvedValue(undefined)

		// Create mock ExtensionHost
		extensionHostMock = {
			sendWebviewMessage: vi.fn().mockResolvedValue(undefined),
			on: vi.fn(),
			off: vi.fn(),
		}

		mockContext = {
			input: "/teams",
			args: [],
			options: {},
			sendMessage: vi.fn().mockResolvedValue(undefined),
			addMessage: addMessageMock,
			clearMessages: vi.fn(),
			clearTask: vi.fn().mockResolvedValue(undefined),
			setMode: vi.fn(),
			exit: vi.fn(),
			apiConfiguration: {
				apiProvider: "kilocode",
				kilocodeToken: "test-token",
				kilocodeModel: "test-model",
			},
			currentApiConfigName: "default",
			extensionHost: extensionHostMock,
			config: {
				version: "1.0.0",
				mode: "code",
				telemetry: false,
				provider: "test-provider",
				providers: [
					{
						id: "test-provider",
						provider: "kilocode",
						kilocodeToken: "test-token",
					},
				],
			},
		}
	})

	describe("Command metadata", () => {
		it("should have correct name", () => {
			expect(teamsCommand.name).toBe("teams")
		})

		it("should have correct aliases", () => {
			expect(teamsCommand.aliases).toEqual(["team", "org"])
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
			expect(teamsCommand.examples).toContain("/teams list")
			expect(teamsCommand.examples).toContain("/teams select personal")
		})
	})

	describe("Authentication check", () => {
		it("should show error when not authenticated", async () => {
			mockContext.apiConfiguration = {
				apiProvider: "kilocode",
			}

			await teamsCommand.handler(mockContext)

			expect(addMessageMock).toHaveBeenCalledTimes(1)
			const message = addMessageMock.mock.calls[0][0]
			expect(message.type).toBe("error")
			expect(message.content).toContain("Not authenticated")
		})
	})

	describe("Show current team (no args)", () => {
		it("should show Personal when no organization is set", async () => {
			await teamsCommand.handler(mockContext)

			expect(addMessageMock).toHaveBeenCalledTimes(1)
			const message = addMessageMock.mock.calls[0][0]
			expect(message.type).toBe("system")
			expect(message.content).toContain("Current Team:")
			expect(message.content).toContain("Personal")
		})

		it("should show organization name when set", async () => {
			mockContext.apiConfiguration = {
				...mockContext.apiConfiguration,
				kilocodeOrganizationId: "org-123",
			}

			extensionHostMock.on.mockImplementation((event: string, handler: Function) => {
				if (event === "message") {
					setTimeout(() => {
						handler({
							type: "profileDataResponse",
							payload: {
								success: true,
								data: {
									user: {
										name: "Test User",
										email: "test@example.com",
									},
									organizations: [
										{
											id: "org-123",
											name: "Acme Corp",
											role: "admin",
										},
									],
								},
							},
						})
					}, 10)
				}
			})

			await teamsCommand.handler(mockContext)

			await new Promise((resolve) => setTimeout(resolve, 50))

			const teamMessage = addMessageMock.mock.calls.find((call: any) =>
				call[0].content?.includes("Current Team:"),
			)
			expect(teamMessage).toBeDefined()
			expect(teamMessage[0].content).toContain("Acme Corp (admin)")
		})
	})

	describe("List teams subcommand", () => {
		beforeEach(() => {
			mockContext.args = ["list"]
		})

		it("should list all available teams including Personal", async () => {
			extensionHostMock.on.mockImplementation((event: string, handler: Function) => {
				if (event === "message") {
					setTimeout(() => {
						handler({
							type: "profileDataResponse",
							payload: {
								success: true,
								data: {
									user: {
										name: "Test User",
										email: "test@example.com",
									},
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
								},
							},
						})
					}, 10)
				}
			})

			await teamsCommand.handler(mockContext)

			await new Promise((resolve) => setTimeout(resolve, 50))

			const listMessage = addMessageMock.mock.calls.find((call: any) =>
				call[0].content?.includes("Available Teams"),
			)
			expect(listMessage).toBeDefined()
			expect(listMessage[0].content).toContain("Personal")
			expect(listMessage[0].content).toContain("Team Alpha (admin)")
			expect(listMessage[0].content).toContain("Team Beta (member)")
		})

		it("should mark current team with arrow", async () => {
			mockContext.apiConfiguration = {
				...mockContext.apiConfiguration,
				kilocodeOrganizationId: "org-1",
			}

			extensionHostMock.on.mockImplementation((event: string, handler: Function) => {
				if (event === "message") {
					setTimeout(() => {
						handler({
							type: "profileDataResponse",
							payload: {
								success: true,
								data: {
									user: {
										name: "Test User",
										email: "test@example.com",
									},
									organizations: [
										{
											id: "org-1",
											name: "Current Team",
											role: "admin",
										},
									],
								},
							},
						})
					}, 10)
				}
			})

			await teamsCommand.handler(mockContext)

			await new Promise((resolve) => setTimeout(resolve, 50))

			const listMessage = addMessageMock.mock.calls.find((call: any) =>
				call[0].content?.includes("Available Teams"),
			)
			expect(listMessage[0].content).toContain("→")
			expect(listMessage[0].content).toContain("(current)")
		})

		it("should show usage instructions", async () => {
			extensionHostMock.on.mockImplementation((event: string, handler: Function) => {
				if (event === "message") {
					setTimeout(() => {
						handler({
							type: "profileDataResponse",
							payload: {
								success: true,
								data: {
									user: {},
									organizations: [],
								},
							},
						})
					}, 10)
				}
			})

			await teamsCommand.handler(mockContext)

			await new Promise((resolve) => setTimeout(resolve, 50))

			const listMessage = addMessageMock.mock.calls.find((call: any) =>
				call[0].content?.includes("Available Teams"),
			)
			expect(listMessage[0].content).toContain("/teams select")
		})
	})

	describe("Select team subcommand", () => {
		it("should switch to personal account", async () => {
			mockContext.args = ["select", "personal"]

			await teamsCommand.handler(mockContext)

			await new Promise((resolve) => setTimeout(resolve, 50))

			// Should send upsertApiConfiguration message
			expect(extensionHostMock.sendWebviewMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "upsertApiConfiguration",
					apiConfiguration: expect.objectContaining({
						kilocodeOrganizationId: undefined,
					}),
				}),
			)

			// Should show success message
			const successMessage = addMessageMock.mock.calls.find((call: any) =>
				call[0].content?.includes("Switched to"),
			)
			expect(successMessage).toBeDefined()
			expect(successMessage[0].content).toContain("Personal")
		})

		it("should switch to organization", async () => {
			mockContext.args = ["select", "org-123"]

			extensionHostMock.on.mockImplementation((event: string, handler: Function) => {
				if (event === "message") {
					setTimeout(() => {
						handler({
							type: "profileDataResponse",
							payload: {
								success: true,
								data: {
									user: {
										name: "Test User",
										email: "test@example.com",
									},
									organizations: [
										{
											id: "org-123",
											name: "Target Team",
											role: "member",
										},
									],
								},
							},
						})
					}, 10)
				}
			})

			await teamsCommand.handler(mockContext)

			await new Promise((resolve) => setTimeout(resolve, 50))

			// Should send upsertApiConfiguration message
			expect(extensionHostMock.sendWebviewMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "upsertApiConfiguration",
					apiConfiguration: expect.objectContaining({
						kilocodeOrganizationId: "org-123",
					}),
				}),
			)

			// Should show success message
			const successMessage = addMessageMock.mock.calls.find((call: any) =>
				call[0].content?.includes("Switched to team"),
			)
			expect(successMessage).toBeDefined()
			expect(successMessage[0].content).toContain("Target Team")
		})

		it("should show error for invalid team ID", async () => {
			mockContext.args = ["select", "invalid-org"]

			extensionHostMock.on.mockImplementation((event: string, handler: Function) => {
				if (event === "message") {
					setTimeout(() => {
						handler({
							type: "profileDataResponse",
							payload: {
								success: true,
								data: {
									user: {},
									organizations: [],
								},
							},
						})
					}, 10)
				}
			})

			await teamsCommand.handler(mockContext)

			await new Promise((resolve) => setTimeout(resolve, 50))

			const errorMessage = addMessageMock.mock.calls.find(
				(call: any) => call[0].type === "error" && call[0].content?.includes("not found"),
			)
			expect(errorMessage).toBeDefined()
		})

		it("should show error when team ID is missing", async () => {
			mockContext.args = ["select"]

			await teamsCommand.handler(mockContext)

			expect(addMessageMock).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "error",
					content: expect.stringContaining("Usage: /teams select"),
				}),
			)
		})
	})

	describe("Invalid subcommand", () => {
		it("should show error for unknown subcommand", async () => {
			mockContext.args = ["unknown"]

			await teamsCommand.handler(mockContext)

			expect(addMessageMock).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "error",
					content: expect.stringContaining("Unknown subcommand"),
				}),
			)
		})
	})

	describe("Error handling", () => {
		it("should handle profile fetch error in list", async () => {
			mockContext.args = ["list"]

			extensionHostMock.on.mockImplementation((event: string, handler: Function) => {
				if (event === "message") {
					setTimeout(() => {
						handler({
							type: "profileDataResponse",
							payload: {
								success: false,
								error: "API error",
							},
						})
					}, 10)
				}
			})

			await teamsCommand.handler(mockContext)

			await new Promise((resolve) => setTimeout(resolve, 50))

			const errorMessage = addMessageMock.mock.calls.find(
				(call: any) => call[0].type === "error" && call[0].content?.includes("Failed to fetch teams"),
			)
			expect(errorMessage).toBeDefined()
		})

		it("should handle profile fetch error in select", async () => {
			mockContext.args = ["select", "org-123"]

			extensionHostMock.on.mockImplementation((event: string, handler: Function) => {
				if (event === "message") {
					setTimeout(() => {
						handler({
							type: "profileDataResponse",
							payload: {
								success: false,
								error: "Network error",
							},
						})
					}, 10)
				}
			})

			await teamsCommand.handler(mockContext)

			await new Promise((resolve) => setTimeout(resolve, 50))

			const errorMessage = addMessageMock.mock.calls.find(
				(call: any) => call[0].type === "error" && call[0].content?.includes("Failed to fetch teams"),
			)
			expect(errorMessage).toBeDefined()
		})
	})
})

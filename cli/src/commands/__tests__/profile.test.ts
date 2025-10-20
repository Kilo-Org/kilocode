/**
 * Tests for the /profile command
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { profileCommand } from "../profile.js"
import type { CommandContext } from "../core/types.js"

describe("/profile command", () => {
	let mockContext: CommandContext
	let addMessageMock: ReturnType<typeof vi.fn>
	let extensionHostMock: any

	beforeEach(() => {
		addMessageMock = vi.fn()

		// Create mock ExtensionHost
		extensionHostMock = {
			sendWebviewMessage: vi.fn().mockResolvedValue(undefined),
			on: vi.fn(),
			off: vi.fn(),
		}

		mockContext = {
			input: "/profile",
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
			extensionHost: extensionHostMock,
		}
	})

	describe("Command metadata", () => {
		it("should have correct name", () => {
			expect(profileCommand.name).toBe("profile")
		})

		it("should have correct aliases", () => {
			expect(profileCommand.aliases).toEqual(["prof"])
		})

		it("should have correct description", () => {
			expect(profileCommand.description).toBe("View your Kilocode profile information")
		})

		it("should have correct category", () => {
			expect(profileCommand.category).toBe("settings")
		})

		it("should have correct priority", () => {
			expect(profileCommand.priority).toBe(9)
		})

		it("should have correct usage", () => {
			expect(profileCommand.usage).toBe("/profile")
		})

		it("should have examples", () => {
			expect(profileCommand.examples).toContain("/profile")
		})
	})

	describe("Authentication check", () => {
		it("should show error when not authenticated", async () => {
			mockContext.apiConfiguration = {
				apiProvider: "kilocode",
			}

			await profileCommand.handler(mockContext)

			expect(addMessageMock).toHaveBeenCalledTimes(1)
			const message = addMessageMock.mock.calls[0][0]
			expect(message.type).toBe("error")
			expect(message.content).toContain("Not authenticated")
		})

		it("should show error when token is empty", async () => {
			mockContext.apiConfiguration = {
				apiProvider: "kilocode",
				kilocodeToken: "",
			}

			await profileCommand.handler(mockContext)

			expect(addMessageMock).toHaveBeenCalledTimes(1)
			const message = addMessageMock.mock.calls[0][0]
			expect(message.type).toBe("error")
			expect(message.content).toContain("Not authenticated")
		})
	})

	describe("Profile data fetching", () => {
		it("should send profile and balance requests", async () => {
			// Mock successful responses
			extensionHostMock.on.mockImplementation((event: string, handler: Function) => {
				if (event === "message") {
					// Simulate profile response
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
									organizations: [],
								},
							},
						})
					}, 10)

					// Simulate balance response
					setTimeout(() => {
						handler({
							type: "balanceDataResponse",
							payload: {
								success: true,
								data: {
									balance: 25.5,
								},
							},
						})
					}, 20)
				}
			})

			await profileCommand.handler(mockContext)

			// Should show loading message
			expect(addMessageMock).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "system",
					content: "Loading profile information...",
				}),
			)

			// Should send both requests
			expect(extensionHostMock.sendWebviewMessage).toHaveBeenCalledWith({
				type: "fetchProfileDataRequest",
			})
			expect(extensionHostMock.sendWebviewMessage).toHaveBeenCalledWith({
				type: "fetchBalanceDataRequest",
			})
		})

		it("should display profile information on success", async () => {
			extensionHostMock.on.mockImplementation((event: string, handler: Function) => {
				if (event === "message") {
					setTimeout(() => {
						handler({
							type: "profileDataResponse",
							payload: {
								success: true,
								data: {
									user: {
										name: "John Doe",
										email: "john@example.com",
									},
									organizations: [],
								},
							},
						})
						handler({
							type: "balanceDataResponse",
							payload: {
								success: true,
								data: {
									balance: 42.75,
								},
							},
						})
					}, 10)
				}
			})

			await profileCommand.handler(mockContext)

			// Wait for async operations
			await new Promise((resolve) => setTimeout(resolve, 50))

			// Should display profile info
			const profileMessage = addMessageMock.mock.calls.find((call: any) =>
				call[0].content?.includes("Profile Information"),
			)
			expect(profileMessage).toBeDefined()
			expect(profileMessage[0].content).toContain("John Doe")
			expect(profileMessage[0].content).toContain("john@example.com")
			expect(profileMessage[0].content).toContain("$42.75")
		})

		it("should show Personal when no organization is set", async () => {
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
									organizations: [],
								},
							},
						})
						handler({
							type: "balanceDataResponse",
							payload: {
								success: true,
								data: {
									balance: 10.0,
								},
							},
						})
					}, 10)
				}
			})

			await profileCommand.handler(mockContext)

			await new Promise((resolve) => setTimeout(resolve, 50))

			const profileMessage = addMessageMock.mock.calls.find((call: any) =>
				call[0].content?.includes("Profile Information"),
			)
			expect(profileMessage[0].content).toContain("Organization: Personal")
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
						handler({
							type: "balanceDataResponse",
							payload: {
								success: true,
								data: {
									balance: 100.0,
								},
							},
						})
					}, 10)
				}
			})

			await profileCommand.handler(mockContext)

			await new Promise((resolve) => setTimeout(resolve, 50))

			const profileMessage = addMessageMock.mock.calls.find((call: any) =>
				call[0].content?.includes("Profile Information"),
			)
			expect(profileMessage[0].content).toContain("Organization: Acme Corp (admin)")
		})
	})

	describe("Error handling", () => {
		it("should handle profile fetch error", async () => {
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

			await profileCommand.handler(mockContext)

			await new Promise((resolve) => setTimeout(resolve, 50))

			const errorMessage = addMessageMock.mock.calls.find(
				(call: any) => call[0].type === "error" && call[0].content?.includes("Failed to fetch profile"),
			)
			expect(errorMessage).toBeDefined()
			expect(errorMessage[0].content).toContain("API error")
		})

		it("should handle balance fetch error", async () => {
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
									organizations: [],
								},
							},
						})
						handler({
							type: "balanceDataResponse",
							payload: {
								success: false,
								error: "Balance unavailable",
							},
						})
					}, 10)
				}
			})

			await profileCommand.handler(mockContext)

			await new Promise((resolve) => setTimeout(resolve, 50))

			const errorMessage = addMessageMock.mock.calls.find(
				(call: any) => call[0].type === "error" && call[0].content?.includes("Failed to fetch balance"),
			)
			expect(errorMessage).toBeDefined()
			expect(errorMessage[0].content).toContain("Balance unavailable")
		})

		it("should handle timeout", async () => {
			// Don't send any response to trigger timeout
			extensionHostMock.on.mockImplementation(() => {})

			await profileCommand.handler(mockContext)

			await new Promise((resolve) => setTimeout(resolve, 11000))

			const errorMessage = addMessageMock.mock.calls.find(
				(call: any) => call[0].type === "error" && call[0].content?.includes("Failed to load profile"),
			)
			expect(errorMessage).toBeDefined()
		}, 15000)

		it("should handle missing user data", async () => {
			extensionHostMock.on.mockImplementation((event: string, handler: Function) => {
				if (event === "message") {
					setTimeout(() => {
						handler({
							type: "profileDataResponse",
							payload: {
								success: true,
								data: {
									organizations: [],
								},
							},
						})
						handler({
							type: "balanceDataResponse",
							payload: {
								success: true,
								data: {
									balance: 10.0,
								},
							},
						})
					}, 10)
				}
			})

			await profileCommand.handler(mockContext)

			await new Promise((resolve) => setTimeout(resolve, 50))

			const errorMessage = addMessageMock.mock.calls.find(
				(call: any) => call[0].type === "error" && call[0].content?.includes("No user data available"),
			)
			expect(errorMessage).toBeDefined()
		})
	})
})

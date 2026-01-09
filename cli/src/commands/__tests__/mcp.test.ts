import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { mcpCommand } from "../mcp.js"
import type { CommandContext } from "../core/types.js"
import {
	loadMCPSettings,
	saveMCPSettings,
	loadProjectMCPSettings,
	saveProjectMCPSettings,
	resetMCPSettingsPaths,
	getMergedMCPSettings,
} from "../../config/mcp-settings.js"
import { createMockContext } from "./helpers/mockContext.js"

// Mock the mcp-settings module
vi.mock("../../config/mcp-settings.js", () => ({
	loadMCPSettings: vi.fn(),
	saveMCPSettings: vi.fn(),
	loadProjectMCPSettings: vi.fn(),
	saveProjectMCPSettings: vi.fn(),
	getMergedMCPSettings: vi.fn(),
	getMCPSettingsPath: vi.fn().mockReturnValue("/mock/global/mcp_settings.json"),
	getProjectMCPSettingsPath: vi.fn().mockReturnValue("/mock/project/.kilocode/mcp.json"),
	setMCPSettingsPaths: vi.fn(),
	resetMCPSettingsPaths: vi.fn(),
}))

describe("mcpCommand", () => {
	let mockContext: CommandContext
	let addMessageSpy: ReturnType<typeof vi.fn>

	beforeEach(() => {
		vi.clearAllMocks()
		addMessageSpy = vi.fn()

		mockContext = createMockContext({
			input: "/mcp",
			options: {},
			args: [],
			addMessage: addMessageSpy,
		})

		// Reset cwd mock
		vi.spyOn(process, "cwd").mockReturnValue("/mock/project")
	})

	afterEach(() => {
		vi.restoreAllMocks()
		resetMCPSettingsPaths()
	})

	it("should have correct metadata", () => {
		expect(mcpCommand.name).toBe("mcp")
		expect(mcpCommand.category).toBe("settings")
		expect(mcpCommand.priority).toBe(8)
		expect(mcpCommand.arguments?.length).toBe(2)
		expect(mcpCommand.options?.length).toBe(3)
	})

	describe("help", () => {
		it("should show help when no arguments provided", async () => {
			await mcpCommand.handler(mockContext)

			expect(addMessageSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "system",
					content: expect.stringContaining("MCP (Model Context Protocol) Server Management"),
				}),
			)
		})
	})

	describe("list", () => {
		it("should list MCP servers in human-readable format", async () => {
			const mockSettings: Awaited<ReturnType<typeof loadMCPSettings>> = {
				mcpServers: {
					server1: {
						command: "node",
						args: ["/path/to/server.js"],
						disabled: false,
						timeout: 60,
					},
				},
			}
			vi.mocked(loadMCPSettings).mockResolvedValue(mockSettings)
			vi.mocked(loadProjectMCPSettings).mockResolvedValue(null)
			vi.mocked(getMergedMCPSettings).mockResolvedValue(mockSettings)

			mockContext.args = ["list"]
			mockContext.options = {}

			await mcpCommand.handler(mockContext)

			expect(loadMCPSettings).toHaveBeenCalled()
			expect(addMessageSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "system",
					content: expect.stringContaining("Global MCP Servers"),
				}),
			)
		})

		it("should list MCP servers in JSON format", async () => {
			const mockSettings: Awaited<ReturnType<typeof loadMCPSettings>> = {
				mcpServers: {
					server1: {
						command: "node",
						args: ["/path/to/server.js"],
					},
				},
			}
			vi.mocked(loadMCPSettings).mockResolvedValue(mockSettings)

			mockContext.args = ["list"]
			mockContext.options = { json: true }

			await mcpCommand.handler(mockContext)

			expect(addMessageSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "system",
					content: JSON.stringify(mockSettings, null, 2),
				}),
			)
		})

		it("should show empty message when no servers configured", async () => {
			vi.mocked(loadMCPSettings).mockResolvedValue({ mcpServers: {} })

			mockContext.args = ["list"]
			mockContext.options = {}

			await mcpCommand.handler(mockContext)

			expect(addMessageSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "system",
					content: expect.stringContaining("No MCP servers configured globally"),
				}),
			)
		})

		it("should show merged settings when both global and project exist", async () => {
			const globalSettings: Awaited<ReturnType<typeof loadMCPSettings>> = {
				mcpServers: {
					globalServer: { command: "global" },
				},
			}
			const projectSettings: Awaited<ReturnType<typeof loadProjectMCPSettings>> = {
				mcpServers: {
					projectServer: { command: "project" },
				},
			}
			const mergedSettings: Awaited<ReturnType<typeof getMergedMCPSettings>> = {
				mcpServers: {
					globalServer: { command: "global" },
					projectServer: { command: "project" },
				},
			}

			vi.mocked(loadMCPSettings).mockResolvedValue(globalSettings)
			vi.mocked(loadProjectMCPSettings).mockResolvedValue(projectSettings)
			vi.mocked(getMergedMCPSettings).mockResolvedValue(mergedSettings)

			mockContext.args = ["list"]
			mockContext.options = {}

			await mcpCommand.handler(mockContext)

			expect(addMessageSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "system",
					content: expect.stringContaining("MCP Servers"),
				}),
			)
		})
	})

	describe("add", () => {
		it("should add a new MCP server to global config", async () => {
			const mockSettings: Awaited<ReturnType<typeof loadMCPSettings>> = {
				mcpServers: {},
			}
			vi.mocked(loadMCPSettings).mockResolvedValue(mockSettings)

			mockContext.args = ["add", "myserver"]
			mockContext.options = {}

			await mcpCommand.handler(mockContext)

			expect(saveMCPSettings).toHaveBeenCalledWith(
				expect.objectContaining({
					mcpServers: expect.objectContaining({
						myserver: expect.objectContaining({
							command: "",
							disabled: false,
							timeout: 60,
						}),
					}),
				}),
			)
			expect(addMessageSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "system",
					content: expect.stringContaining("added successfully"),
				}),
			)
		})

		it("should add a new MCP server to project config", async () => {
			vi.mocked(loadProjectMCPSettings).mockResolvedValue({ mcpServers: {} })

			mockContext.args = ["add", "myserver"]
			mockContext.options = { project: true }

			await mcpCommand.handler(mockContext)

			expect(saveProjectMCPSettings).toHaveBeenCalled()
			expect(addMessageSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "system",
					content: expect.stringContaining("added to project config"),
				}),
			)
		})

		it("should show error when server already exists", async () => {
			const mockSettings: Awaited<ReturnType<typeof loadMCPSettings>> = {
				mcpServers: {
					myserver: { command: "node" },
				},
			}
			vi.mocked(loadMCPSettings).mockResolvedValue(mockSettings)

			mockContext.args = ["add", "myserver"]
			mockContext.options = {}

			await mcpCommand.handler(mockContext)

			expect(saveMCPSettings).not.toHaveBeenCalled()
			expect(addMessageSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "error",
					content: expect.stringContaining("already exists"),
				}),
			)
		})

		it("should show error when server name is missing", async () => {
			mockContext.args = ["add"]
			mockContext.options = {}

			await mcpCommand.handler(mockContext)

			expect(addMessageSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "error",
					content: expect.stringContaining("Usage"),
				}),
			)
		})
	})

	describe("remove", () => {
		it("should remove an MCP server from global config", async () => {
			const mockSettings: Awaited<ReturnType<typeof loadMCPSettings>> = {
				mcpServers: {
					myserver: { command: "node" },
				},
			}
			vi.mocked(loadMCPSettings).mockResolvedValue(mockSettings)

			mockContext.args = ["remove", "myserver"]
			mockContext.options = {}

			await mcpCommand.handler(mockContext)

			expect(saveMCPSettings).toHaveBeenCalledWith(
				expect.objectContaining({
					mcpServers: {},
				}),
			)
			expect(addMessageSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "system",
					content: expect.stringContaining("removed from global config"),
				}),
			)
		})

		it("should remove an MCP server from project config", async () => {
			const mockSettings: Awaited<ReturnType<typeof loadProjectMCPSettings>> = {
				mcpServers: {
					myserver: { command: "node" },
				},
			}
			vi.mocked(loadProjectMCPSettings).mockResolvedValue(mockSettings)

			mockContext.args = ["remove", "myserver"]
			mockContext.options = { project: true }

			await mcpCommand.handler(mockContext)

			expect(saveProjectMCPSettings).toHaveBeenCalled()
			expect(addMessageSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "system",
					content: expect.stringContaining("removed from project config"),
				}),
			)
		})

		it("should show error when server not found", async () => {
			vi.mocked(loadMCPSettings).mockResolvedValue({ mcpServers: {} })

			mockContext.args = ["remove", "nonexistent"]
			mockContext.options = {}

			await mcpCommand.handler(mockContext)

			expect(addMessageSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "error",
					content: expect.stringContaining("not found"),
				}),
			)
		})

		it("should support 'rm' alias", async () => {
			const mockSettings: Awaited<ReturnType<typeof loadMCPSettings>> = {
				mcpServers: {
					myserver: { command: "node" },
				},
			}
			vi.mocked(loadMCPSettings).mockResolvedValue(mockSettings)

			mockContext.args = ["rm", "myserver"]
			mockContext.options = {}

			await mcpCommand.handler(mockContext)

			expect(saveMCPSettings).toHaveBeenCalled()
		})
	})

	describe("edit", () => {
		it("should show edit guidance for existing server", async () => {
			const globalSettings: Awaited<ReturnType<typeof loadMCPSettings>> = {
				mcpServers: {
					myserver: { command: "node", args: ["/path/to/server.js"] },
				},
			}
			vi.mocked(loadMCPSettings).mockResolvedValue(globalSettings)
			vi.mocked(loadProjectMCPSettings).mockResolvedValue(null)

			mockContext.args = ["edit", "myserver"]
			mockContext.options = {}

			await mcpCommand.handler(mockContext)

			expect(addMessageSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "system",
					content: expect.stringContaining("Edit the MCP server configuration"),
				}),
			)
		})

		it("should show error when server not found", async () => {
			vi.mocked(loadMCPSettings).mockResolvedValue({ mcpServers: {} })
			vi.mocked(loadProjectMCPSettings).mockResolvedValue(null)

			mockContext.args = ["edit", "nonexistent"]
			mockContext.options = {}

			await mcpCommand.handler(mockContext)

			expect(addMessageSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "error",
					content: expect.stringContaining("not found"),
				}),
			)
		})

		it("should show error when server name is missing", async () => {
			mockContext.args = ["edit"]
			mockContext.options = {}

			await mcpCommand.handler(mockContext)

			expect(addMessageSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "error",
					content: expect.stringContaining("Usage"),
				}),
			)
		})
	})

	describe("enable", () => {
		it("should enable a disabled MCP server", async () => {
			const mockSettings: Awaited<ReturnType<typeof loadMCPSettings>> = {
				mcpServers: {
					myserver: { command: "node", disabled: true },
				},
			}
			vi.mocked(loadMCPSettings).mockResolvedValue(mockSettings)

			mockContext.args = ["enable", "myserver"]
			mockContext.options = {}

			await mcpCommand.handler(mockContext)

			expect(saveMCPSettings).toHaveBeenCalledWith(
				expect.objectContaining({
					mcpServers: expect.objectContaining({
						myserver: expect.objectContaining({ disabled: false }),
					}),
				}),
			)
			expect(addMessageSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "system",
					content: expect.stringContaining("enabled"),
				}),
			)
		})

		it("should show message when server is already enabled", async () => {
			const mockSettings: Awaited<ReturnType<typeof loadMCPSettings>> = {
				mcpServers: {
					myserver: { command: "node", disabled: false },
				},
			}
			vi.mocked(loadMCPSettings).mockResolvedValue(mockSettings)

			mockContext.args = ["enable", "myserver"]
			mockContext.options = {}

			await mcpCommand.handler(mockContext)

			expect(saveMCPSettings).not.toHaveBeenCalled()
			expect(addMessageSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "system",
					content: expect.stringContaining("already enabled"),
				}),
			)
		})
	})

	describe("disable", () => {
		it("should disable an MCP server", async () => {
			const mockSettings: Awaited<ReturnType<typeof loadMCPSettings>> = {
				mcpServers: {
					myserver: { command: "node", disabled: false },
				},
			}
			vi.mocked(loadMCPSettings).mockResolvedValue(mockSettings)

			mockContext.args = ["disable", "myserver"]
			mockContext.options = {}

			await mcpCommand.handler(mockContext)

			expect(saveMCPSettings).toHaveBeenCalledWith(
				expect.objectContaining({
					mcpServers: expect.objectContaining({
						myserver: expect.objectContaining({ disabled: true }),
					}),
				}),
			)
			expect(addMessageSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "system",
					content: expect.stringContaining("disabled"),
				}),
			)
		})

		it("should show message when server is already disabled", async () => {
			const mockSettings: Awaited<ReturnType<typeof loadMCPSettings>> = {
				mcpServers: {
					myserver: { command: "node", disabled: true },
				},
			}
			vi.mocked(loadMCPSettings).mockResolvedValue(mockSettings)

			mockContext.args = ["disable", "myserver"]
			mockContext.options = {}

			await mcpCommand.handler(mockContext)

			expect(saveMCPSettings).not.toHaveBeenCalled()
			expect(addMessageSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "system",
					content: expect.stringContaining("already disabled"),
				}),
			)
		})
	})

	describe("error handling", () => {
		it("should show error for unknown subcommand", async () => {
			mockContext.args = ["unknown"]
			mockContext.options = {}

			await mcpCommand.handler(mockContext)

			expect(addMessageSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "error",
					content: expect.stringContaining("Unknown subcommand"),
				}),
			)
		})

		it("should handle errors gracefully", async () => {
			vi.mocked(loadMCPSettings).mockRejectedValue(new Error("File read error"))

			mockContext.args = ["list"]
			mockContext.options = {}

			await mcpCommand.handler(mockContext)

			expect(addMessageSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "error",
					content: expect.stringContaining("Failed to list MCP servers"),
				}),
			)
		})
	})

	describe("project-level operations", () => {
		it("should list project-level MCP servers", async () => {
			const mockSettings: Awaited<ReturnType<typeof loadProjectMCPSettings>> = {
				mcpServers: {
					projectServer: { command: "node" },
				},
			}
			vi.mocked(loadProjectMCPSettings).mockResolvedValue(mockSettings)

			mockContext.args = ["list"]
			mockContext.options = { project: true }

			await mcpCommand.handler(mockContext)

			expect(loadProjectMCPSettings).toHaveBeenCalled()
			expect(addMessageSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "system",
					content: expect.stringContaining("Project MCP Servers"),
				}),
			)
		})
	})
})

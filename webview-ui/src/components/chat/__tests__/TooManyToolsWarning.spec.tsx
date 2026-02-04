import { render, screen, fireEvent } from "@/utils/test-utils"
import { MAX_MCP_TOOLS_THRESHOLD } from "@roo-code/types"

import { TooManyToolsWarning } from "../TooManyToolsWarning"

// Mock vscode webview messaging
vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

// Mock ExtensionState context with variable mcpServers
const mockMcpServers = vi.fn()

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		mcpServers: mockMcpServers(),
	}),
}))

// Mock i18n TranslationContext
vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string, params?: Record<string, any>) => {
			if (key === "chat:tooManyTools.title") {
				return "Too many tools enabled"
			}
			if (key === "chat:tooManyTools.toolsPart") {
				const count = params?.count ?? 0
				return count === 1 ? `${count} tool` : `${count} tools`
			}
			if (key === "chat:tooManyTools.serversPart") {
				const count = params?.count ?? 0
				return count === 1 ? `${count} MCP server` : `${count} MCP servers`
			}
			if (key === "chat:tooManyTools.messageTemplate") {
				return `You have ${params?.tools} enabled via ${params?.servers}. Such a high number can confuse the model and lead to errors. Try to keep it below ${params?.threshold}.`
			}
			if (key === "chat:tooManyTools.openMcpSettings") {
				return "Open MCP Settings"
			}
			if (key === "chat:apiRequest.errorMessage.docs") {
				return "Docs"
			}
			return key
		},
	}),
}))

describe("TooManyToolsWarning", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockMcpServers.mockReturnValue([])
	})

	it("does not render when there are no MCP servers", () => {
		mockMcpServers.mockReturnValue([])

		const { container } = render(<TooManyToolsWarning />)

		expect(container.firstChild).toBeNull()
	})

	it("does not render when tool count is below threshold", () => {
		mockMcpServers.mockReturnValue([
			{
				name: "server1",
				status: "connected",
				disabled: false,
				tools: [
					{ name: "tool1", enabledForPrompt: true },
					{ name: "tool2", enabledForPrompt: true },
				],
			},
		])

		const { container } = render(<TooManyToolsWarning />)

		expect(container.firstChild).toBeNull()
	})

	it("does not render when tool count equals threshold", () => {
		// Create tools to exactly match threshold
		const tools = Array.from({ length: MAX_MCP_TOOLS_THRESHOLD }, (_, i) => ({
			name: `tool${i}`,
			enabledForPrompt: true,
		}))

		mockMcpServers.mockReturnValue([
			{
				name: "server1",
				status: "connected",
				disabled: false,
				tools,
			},
		])

		const { container } = render(<TooManyToolsWarning />)

		expect(container.firstChild).toBeNull()
	})

	it("renders warning when tool count exceeds threshold", () => {
		// Create more tools than the threshold
		const tools = Array.from({ length: MAX_MCP_TOOLS_THRESHOLD + 10 }, (_, i) => ({
			name: `tool${i}`,
			enabledForPrompt: true,
		}))

		mockMcpServers.mockReturnValue([
			{
				name: "server1",
				status: "connected",
				disabled: false,
				tools,
			},
		])

		render(<TooManyToolsWarning />)

		expect(screen.getByText("Too many tools enabled")).toBeInTheDocument()
		expect(
			screen.getByText(
				`You have ${MAX_MCP_TOOLS_THRESHOLD + 10} tools enabled via 1 MCP server. Such a high number can confuse the model and lead to errors. Try to keep it below ${MAX_MCP_TOOLS_THRESHOLD}.`,
			),
		).toBeInTheDocument()
	})

	it("ignores disabled servers", () => {
		// Create tools across two servers, one disabled
		const tools = Array.from({ length: MAX_MCP_TOOLS_THRESHOLD + 10 }, (_, i) => ({
			name: `tool${i}`,
			enabledForPrompt: true,
		}))

		mockMcpServers.mockReturnValue([
			{
				name: "disabledServer",
				status: "connected",
				disabled: true, // This server is disabled
				tools,
			},
			{
				name: "enabledServer",
				status: "connected",
				disabled: false,
				tools: [{ name: "tool1", enabledForPrompt: true }], // Only 1 tool
			},
		])

		const { container } = render(<TooManyToolsWarning />)

		// Should not render because only 1 tool is on enabled server
		expect(container.firstChild).toBeNull()
	})

	it("ignores disconnected servers", () => {
		const tools = Array.from({ length: MAX_MCP_TOOLS_THRESHOLD + 10 }, (_, i) => ({
			name: `tool${i}`,
			enabledForPrompt: true,
		}))

		mockMcpServers.mockReturnValue([
			{
				name: "disconnectedServer",
				status: "disconnected", // Not connected
				disabled: false,
				tools,
			},
		])

		const { container } = render(<TooManyToolsWarning />)

		expect(container.firstChild).toBeNull()
	})

	it("ignores disabled tools", () => {
		// Create tools with some disabled
		const enabledTools = Array.from({ length: 20 }, (_, i) => ({
			name: `enabledTool${i}`,
			enabledForPrompt: true,
		}))
		const disabledTools = Array.from({ length: MAX_MCP_TOOLS_THRESHOLD + 10 }, (_, i) => ({
			name: `disabledTool${i}`,
			enabledForPrompt: false, // These are disabled
		}))

		mockMcpServers.mockReturnValue([
			{
				name: "server1",
				status: "connected",
				disabled: false,
				tools: [...enabledTools, ...disabledTools],
			},
		])

		const { container } = render(<TooManyToolsWarning />)

		// Should not render because only 20 tools are enabled
		expect(container.firstChild).toBeNull()
	})

	it("treats tools with undefined enabledForPrompt as enabled", () => {
		// Create tools without enabledForPrompt set (default behavior is enabled)
		const tools = Array.from({ length: MAX_MCP_TOOLS_THRESHOLD + 5 }, (_, i) => ({
			name: `tool${i}`,
			// enabledForPrompt is undefined, which means enabled by default
		}))

		mockMcpServers.mockReturnValue([
			{
				name: "server1",
				status: "connected",
				disabled: false,
				tools,
			},
		])

		render(<TooManyToolsWarning />)

		expect(screen.getByText("Too many tools enabled")).toBeInTheDocument()
	})

	it("counts tools across multiple servers", () => {
		// Create tools across multiple servers
		const tools1 = Array.from({ length: 35 }, (_, i) => ({
			name: `server1tool${i}`,
			enabledForPrompt: true,
		}))
		const tools2 = Array.from({ length: 30 }, (_, i) => ({
			name: `server2tool${i}`,
			enabledForPrompt: true,
		}))

		mockMcpServers.mockReturnValue([
			{
				name: "server1",
				status: "connected",
				disabled: false,
				tools: tools1,
			},
			{
				name: "server2",
				status: "connected",
				disabled: false,
				tools: tools2,
			},
		])

		render(<TooManyToolsWarning />)

		// 35 + 30 = 65 tools > 60 threshold
		expect(screen.getByText("Too many tools enabled")).toBeInTheDocument()
		expect(
			screen.getByText(
				`You have 65 tools enabled via 2 MCP servers. Such a high number can confuse the model and lead to errors. Try to keep it below ${MAX_MCP_TOOLS_THRESHOLD}.`,
			),
		).toBeInTheDocument()
	})

	it("renders MCP settings link and opens settings when clicked", () => {
		const mockWindowPostMessage = vi.spyOn(window, "postMessage")

		// Create more tools than the threshold
		const tools = Array.from({ length: MAX_MCP_TOOLS_THRESHOLD + 10 }, (_, i) => ({
			name: `tool${i}`,
			enabledForPrompt: true,
		}))

		mockMcpServers.mockReturnValue([
			{
				name: "server1",
				status: "connected",
				disabled: false,
				tools,
			},
		])

		render(<TooManyToolsWarning />)

		// Verify the link is rendered
		const settingsLink = screen.getByText("Open MCP Settings")
		expect(settingsLink).toBeInTheDocument()

		// Click the link and verify it posts the message
		fireEvent.click(settingsLink)

		expect(mockWindowPostMessage).toHaveBeenCalledWith(
			{ type: "action", action: "settingsButtonClicked", values: { section: "mcp" } },
			"*",
		)

		mockWindowPostMessage.mockRestore()
	})
})

import type OpenAI from "openai"
import { getMcpServerTools } from "../mcp_server"
import type { McpHub } from "../../../../../services/mcp/McpHub"
import type { McpServer, McpTool } from "../../../../../shared/mcp"

// Helper type to access function tools
type FunctionTool = OpenAI.Chat.ChatCompletionTool & { type: "function" }

// Helper to get the function property from a tool
const getFunction = (tool: OpenAI.Chat.ChatCompletionTool) => (tool as FunctionTool).function

describe("getMcpServerTools", () => {
	const createMockTool = (name: string, description = "Test tool"): McpTool => ({
		name,
		description,
		inputSchema: {
			type: "object",
			properties: {},
		},
	})

	const createMockServer = (name: string, tools: McpTool[], source: "global" | "project" = "global"): McpServer => ({
		name,
		config: JSON.stringify({ type: "stdio", command: "test" }),
		status: "connected",
		source,
		tools,
	})

	const createMockMcpHub = (servers: McpServer[]): Partial<McpHub> => ({
		getServers: vi.fn().mockReturnValue(servers),
	})

	it("should return empty array when mcpHub is undefined", () => {
		const result = getMcpServerTools(undefined)
		expect(result).toEqual([])
	})

	it("should return empty array when no servers are available", () => {
		const mockHub = createMockMcpHub([])
		const result = getMcpServerTools(mockHub as McpHub)
		expect(result).toEqual([])
	})

	it("should generate tool definitions for server tools", () => {
		const server = createMockServer("testServer", [createMockTool("testTool")])
		const mockHub = createMockMcpHub([server])

		const result = getMcpServerTools(mockHub as McpHub)

		expect(result).toHaveLength(1)
		expect(result[0].type).toBe("function")
		expect(getFunction(result[0]).name).toBe("mcp--testServer--testTool")
		expect(getFunction(result[0]).description).toBe("Test tool")
	})

	it("should filter out tools with enabledForPrompt set to false", () => {
		const enabledTool = createMockTool("enabledTool")
		const disabledTool = { ...createMockTool("disabledTool"), enabledForPrompt: false }
		const server = createMockServer("testServer", [enabledTool, disabledTool])
		const mockHub = createMockMcpHub([server])

		const result = getMcpServerTools(mockHub as McpHub)

		expect(result).toHaveLength(1)
		expect(getFunction(result[0]).name).toBe("mcp--testServer--enabledTool")
	})

	it("should deduplicate tools when same server exists in both global and project configs", () => {
		const globalServer = createMockServer(
			"context7",
			[createMockTool("resolve-library-id", "Global description")],
			"global",
		)
		const projectServer = createMockServer(
			"context7",
			[createMockTool("resolve-library-id", "Project description")],
			"project",
		)

		// McpHub.getServers() deduplicates with project servers taking priority
		// This test simulates the deduplicated result (only project server returned)
		const mockHub = createMockMcpHub([projectServer])

		const result = getMcpServerTools(mockHub as McpHub)

		// Should only have one tool (from project server)
		expect(result).toHaveLength(1)
		expect(getFunction(result[0]).name).toBe("mcp--context7--resolve-library-id")
		// Project server takes priority
		expect(getFunction(result[0]).description).toBe("Project description")
	})

	it("should allow tools with different names from the same server", () => {
		const server = createMockServer("testServer", [
			createMockTool("tool1"),
			createMockTool("tool2"),
			createMockTool("tool3"),
		])
		const mockHub = createMockMcpHub([server])

		const result = getMcpServerTools(mockHub as McpHub)

		expect(result).toHaveLength(3)
		const toolNames = result.map((t) => getFunction(t).name)
		expect(toolNames).toContain("mcp--testServer--tool1")
		expect(toolNames).toContain("mcp--testServer--tool2")
		expect(toolNames).toContain("mcp--testServer--tool3")
	})

	it("should allow tools with same name from different servers", () => {
		const server1 = createMockServer("server1", [createMockTool("commonTool")])
		const server2 = createMockServer("server2", [createMockTool("commonTool")])
		const mockHub = createMockMcpHub([server1, server2])

		const result = getMcpServerTools(mockHub as McpHub)

		expect(result).toHaveLength(2)
		const toolNames = result.map((t) => getFunction(t).name)
		expect(toolNames).toContain("mcp--server1--commonTool")
		expect(toolNames).toContain("mcp--server2--commonTool")
	})

	it("should skip servers without tools", () => {
		const serverWithTools = createMockServer("withTools", [createMockTool("tool1")])
		const serverWithoutTools = createMockServer("withoutTools", [])
		const serverWithUndefinedTools: McpServer = {
			...createMockServer("undefinedTools", []),
			tools: undefined,
		}
		const mockHub = createMockMcpHub([serverWithTools, serverWithoutTools, serverWithUndefinedTools])

		const result = getMcpServerTools(mockHub as McpHub)

		expect(result).toHaveLength(1)
		expect(getFunction(result[0]).name).toBe("mcp--withTools--tool1")
	})

	it("should include required fields from tool schema", () => {
		const toolWithRequired: McpTool = {
			name: "toolWithRequired",
			description: "Tool with required fields",
			inputSchema: {
				type: "object",
				properties: {
					requiredField: { type: "string" },
					optionalField: { type: "number" },
				},
				required: ["requiredField"],
			},
		}
		const server = createMockServer("testServer", [toolWithRequired])
		const mockHub = createMockMcpHub([server])

		const result = getMcpServerTools(mockHub as McpHub)

		expect(result).toHaveLength(1)
		// additionalProperties: false should only be on the root object type, not on primitive types
		expect(getFunction(result[0]).parameters).toEqual({
			type: "object",
			properties: {
				requiredField: { type: "string" },
				optionalField: { type: "number" },
			},
			additionalProperties: false,
			required: ["requiredField"],
		})
	})

	it("should not include required field when schema has no required fields", () => {
		const toolWithoutRequired: McpTool = {
			name: "toolWithoutRequired",
			description: "Tool without required fields",
			inputSchema: {
				type: "object",
				properties: {
					optionalField: { type: "string" },
				},
			},
		}
		const server = createMockServer("testServer", [toolWithoutRequired])
		const mockHub = createMockMcpHub([server])

		const result = getMcpServerTools(mockHub as McpHub)

		expect(result).toHaveLength(1)
		// additionalProperties: false should only be on the root object type, not on primitive types
		expect(getFunction(result[0]).parameters).toEqual({
			type: "object",
			properties: {
				optionalField: { type: "string" },
			},
			additionalProperties: false,
		})
		expect(getFunction(result[0]).parameters).not.toHaveProperty("required")
	})
})

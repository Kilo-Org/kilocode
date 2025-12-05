import { getAccessMcpResourceDescription } from "../access-mcp-resource"
import { ToolArgs } from "../types"
import { McpHub } from "../../../../services/mcp/McpHub"

describe("getAccessMcpResourceDescription", () => {
	const baseArgs: Omit<ToolArgs, "mcpHub"> = {
		cwd: "/test",
		supportsComputerUse: false,
	}

	it("should return undefined when mcpHub is not provided", () => {
		const args: ToolArgs = {
			...baseArgs,
			mcpHub: undefined,
		}

		const result = getAccessMcpResourceDescription(args)
		expect(result).toBeUndefined()
	})

	it("should return undefined when mcpHub has no servers with resources", () => {
		const mockMcpHub = {
			getServers: () => [
				{
					name: "test-server",
					resources: [],
				},
			],
		} as unknown as McpHub

		const args: ToolArgs = {
			...baseArgs,
			mcpHub: mockMcpHub,
		}

		const result = getAccessMcpResourceDescription(args)
		expect(result).toBeUndefined()
	})

	it("should return undefined when mcpHub has servers with undefined resources", () => {
		const mockMcpHub = {
			getServers: () => [
				{
					name: "test-server",
					resources: undefined,
				},
			],
		} as unknown as McpHub

		const args: ToolArgs = {
			...baseArgs,
			mcpHub: mockMcpHub,
		}

		const result = getAccessMcpResourceDescription(args)
		expect(result).toBeUndefined()
	})

	it("should return undefined when mcpHub has no servers", () => {
		const mockMcpHub = {
			getServers: () => [],
		} as unknown as McpHub

		const args: ToolArgs = {
			...baseArgs,
			mcpHub: mockMcpHub,
		}

		const result = getAccessMcpResourceDescription(args)
		expect(result).toBeUndefined()
	})

	it("should return description when mcpHub has servers with resources", () => {
		const mockMcpHub = {
			getServers: () => [
				{
					name: "test-server",
					resources: [{ uri: "test://resource", name: "Test Resource" }],
				},
			],
		} as unknown as McpHub

		const args: ToolArgs = {
			...baseArgs,
			mcpHub: mockMcpHub,
		}

		const result = getAccessMcpResourceDescription(args)
		expect(result).toBeDefined()
		expect(result).toContain("## access_mcp_resource")
		expect(result).toContain("server_name")
		expect(result).toContain("uri")
	})

	it("should return description when at least one server has resources", () => {
		const mockMcpHub = {
			getServers: () => [
				{
					name: "server-without-resources",
					resources: [],
				},
				{
					name: "server-with-resources",
					resources: [{ uri: "test://resource", name: "Test Resource" }],
				},
			],
		} as unknown as McpHub

		const args: ToolArgs = {
			...baseArgs,
			mcpHub: mockMcpHub,
		}

		const result = getAccessMcpResourceDescription(args)
		expect(result).toBeDefined()
		expect(result).toContain("## access_mcp_resource")
	})
})

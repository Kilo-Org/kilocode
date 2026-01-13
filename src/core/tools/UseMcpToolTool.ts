import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { ClineAskUseMcpServer } from "../../shared/ExtensionMessage"
import { McpExecutionStatus } from "@roo-code/types"
import { t } from "../../i18n"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"

interface UseMcpToolParams {
	server_name: string
	tool_name: string
	arguments?: Record<string, unknown>
}

type ValidationResult =
	| { isValid: false }
	| {
			isValid: true
			serverName: string
			toolName: string
			parsedArguments?: Record<string, unknown>
	  }

export class UseMcpToolTool extends BaseTool<"use_mcp_tool"> {
	readonly name = "use_mcp_tool" as const

	parseLegacy(params: Partial<Record<string, string>>): UseMcpToolParams {
		// For legacy params, arguments come as a JSON string that needs parsing
		// We don't parse here - let validateParams handle parsing and errors
		return {
			server_name: params.server_name || "",
			tool_name: params.tool_name || "",
			arguments: params.arguments as any, // Keep as string for validation to handle
		}
	}

	async execute(params: UseMcpToolParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, handleError, pushToolResult, toolProtocol } = callbacks

		try {
			// Validate parameters
			const validation = await this.validateParams(task, params, pushToolResult)
			if (!validation.isValid) {
				return
			}

			const { serverName, toolName, parsedArguments } = validation

			// Validate that the tool exists on the server
			const toolValidation = await this.validateToolExists(task, serverName, toolName, pushToolResult)
			if (!toolValidation.isValid) {
				return
			}

			// Reset mistake count on successful validation
			task.consecutiveMistakeCount = 0

			// Get user approval
			const completeMessage = JSON.stringify({
				type: "use_mcp_tool",
				serverName,
				toolName,
				arguments: params.arguments ? JSON.stringify(params.arguments) : undefined,
			} satisfies ClineAskUseMcpServer)

			const executionId = task.lastMessageTs?.toString() ?? Date.now().toString()
			const didApprove = await askApproval("use_mcp_server", completeMessage)

			if (!didApprove) {
				return
			}

			// Execute the tool and process results
			await this.executeToolAndProcessResult(
				task,
				serverName,
				toolName,
				parsedArguments,
				executionId,
				pushToolResult,
			)
		} catch (error) {
			await handleError("executing MCP tool", error as Error)
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"use_mcp_tool">): Promise<void> {
		const params = block.params
		const partialMessage = JSON.stringify({
			type: "use_mcp_tool",
			serverName: this.removeClosingTag("server_name", params.server_name, block.partial),
			toolName: this.removeClosingTag("tool_name", params.tool_name, block.partial),
			arguments: this.removeClosingTag("arguments", params.arguments, block.partial),
		} satisfies ClineAskUseMcpServer)

		await task.ask("use_mcp_server", partialMessage, true).catch(() => {})
	}

	private async validateParams(
		task: Task,
		params: UseMcpToolParams,
		pushToolResult: (content: string) => void,
	): Promise<ValidationResult> {
		if (!params.server_name) {
			task.consecutiveMistakeCount++
			task.recordToolError("use_mcp_tool")
			pushToolResult(await task.sayAndCreateMissingParamError("use_mcp_tool", "server_name"))
			return { isValid: false }
		}

		if (!params.tool_name) {
			task.consecutiveMistakeCount++
			task.recordToolError("use_mcp_tool")
			pushToolResult(await task.sayAndCreateMissingParamError("use_mcp_tool", "tool_name"))
			return { isValid: false }
		}

		// Parse arguments if provided
		let parsedArguments: Record<string, unknown> | undefined

		if (params.arguments) {
			// If arguments is already an object (from native protocol), use it
			if (typeof params.arguments === "object") {
				parsedArguments = params.arguments
			} else if (typeof params.arguments === "string") {
				// If arguments is a string (from legacy/XML protocol), parse it
				try {
					parsedArguments = JSON.parse(params.arguments)
				} catch (error) {
					task.consecutiveMistakeCount++
					task.recordToolError("use_mcp_tool")
					await task.say("error", t("mcp:errors.invalidJsonArgument", { toolName: params.tool_name }))
					task.didToolFailInCurrentTurn = true

					pushToolResult(
						formatResponse.toolError(
							formatResponse.invalidMcpToolArgumentError(params.server_name, params.tool_name),
						),
					)
					return { isValid: false }
				}
			}
		}

		return {
			isValid: true,
			serverName: params.server_name,
			toolName: params.tool_name,
			parsedArguments,
		}
	}

	private async validateToolExists(
		task: Task,
		serverName: string,
		toolName: string,
		pushToolResult: (content: string) => void,
	): Promise<{ isValid: boolean; availableTools?: string[] }> {
		try {
			// Get the MCP hub to access server information
			const provider = task.providerRef.deref()
			const mcpHub = provider?.getMcpHub()

			if (!mcpHub) {
				// If we can't get the MCP hub, we can't validate, so proceed with caution
				return { isValid: true }
			}

			// Get all servers to find the specific one
			const servers = mcpHub.getAllServers()
			const server = servers.find((s) => s.name === serverName)

			if (!server) {
				// Fail fast when server is unknown
				const availableServersArray = servers.map((s) => s.name)
				const availableServers =
					availableServersArray.length > 0 ? availableServersArray.join(", ") : "No servers available"

				task.consecutiveMistakeCount++
				task.recordToolError("use_mcp_tool")
				await task.say("error", t("mcp:errors.serverNotFound", { serverName, availableServers }))
				task.didToolFailInCurrentTurn = true

				pushToolResult(formatResponse.unknownMcpServerError(serverName, availableServersArray))
				return { isValid: false, availableTools: [] }
			}

			// Check if the server has tools defined
			if (!server.tools || server.tools.length === 0) {
				// No tools available on this server
				task.consecutiveMistakeCount++
				task.recordToolError("use_mcp_tool")
				await task.say(
					"error",
					t("mcp:errors.toolNotFound", {
						toolName,
						serverName,
						availableTools: "No tools available",
					}),
				)
				task.didToolFailInCurrentTurn = true

				pushToolResult(formatResponse.unknownMcpToolError(serverName, toolName, []))
				return { isValid: false, availableTools: [] }
			}

			// Check if the requested tool exists
			const tool = server.tools.find((tool) => tool.name === toolName)

			if (!tool) {
				// Tool not found - provide list of available tools
				const availableToolNames = server.tools.map((tool) => tool.name)

				task.consecutiveMistakeCount++
				task.recordToolError("use_mcp_tool")
				await task.say(
					"error",
					t("mcp:errors.toolNotFound", {
						toolName,
						serverName,
						availableTools: availableToolNames.join(", "),
					}),
				)
				task.didToolFailInCurrentTurn = true

				pushToolResult(formatResponse.unknownMcpToolError(serverName, toolName, availableToolNames))
				return { isValid: false, availableTools: availableToolNames }
			}

			// Check if the tool is disabled (enabledForPrompt is false)
			if (tool.enabledForPrompt === false) {
				// Tool is disabled - only show enabled tools
				const enabledTools = server.tools.filter((t) => t.enabledForPrompt !== false)
				const enabledToolNames = enabledTools.map((t) => t.name)

				task.consecutiveMistakeCount++
				task.recordToolError("use_mcp_tool")
				await task.say(
					"error",
					t("mcp:errors.toolDisabled", {
						toolName,
						serverName,
						availableTools:
							enabledToolNames.length > 0 ? enabledToolNames.join(", ") : "No enabled tools available",
					}),
				)
				task.didToolFailInCurrentTurn = true

				pushToolResult(formatResponse.unknownMcpToolError(serverName, toolName, enabledToolNames))
				return { isValid: false, availableTools: enabledToolNames }
			}

			// Tool exists and is enabled
			return { isValid: true, availableTools: server.tools.map((tool) => tool.name) }
		} catch (error) {
			// If there's an error during validation, log it but don't block the tool execution
			// The actual tool call might still fail with a proper error
			console.error("Error validating MCP tool existence:", error)
			return { isValid: true }
		}
	}

	private async sendExecutionStatus(task: Task, status: McpExecutionStatus): Promise<void> {
		const clineProvider = await task.providerRef.deref()
		clineProvider?.postMessageToWebview({
			type: "mcpExecutionStatus",
			text: JSON.stringify(status),
		})
	}

	private processToolContent(toolResult: any): string {
		if (!toolResult?.content || toolResult.content.length === 0) {
			return ""
		}

		return toolResult.content
			.map((item: any) => {
				if (item.type === "text") {
					return item.text
				}
				if (item.type === "resource") {
					const { blob: _, ...rest } = item.resource
					return JSON.stringify(rest, null, 2)
				}
				return ""
			})
			.filter(Boolean)
			.join("\n\n")
	}

	private async executeToolAndProcessResult(
		task: Task,
		serverName: string,
		toolName: string,
		parsedArguments: Record<string, unknown> | undefined,
		executionId: string,
		pushToolResult: (content: string | Array<any>) => void,
	): Promise<void> {
		await task.say("mcp_server_request_started")

		// Send started status
		await this.sendExecutionStatus(task, {
			executionId,
			status: "started",
			serverName,
			toolName,
		})

		const toolResult = await task.providerRef.deref()?.getMcpHub()?.callTool(serverName, toolName, parsedArguments)

		let toolResultPretty = "(No response)"

		if (toolResult) {
			const outputText = this.processToolContent(toolResult)

			if (outputText) {
				await this.sendExecutionStatus(task, {
					executionId,
					status: "output",
					response: outputText,
				})

				toolResultPretty = (toolResult.isError ? "Error:\n" : "") + outputText
			}

			// Send completion status
			await this.sendExecutionStatus(task, {
				executionId,
				status: toolResult.isError ? "error" : "completed",
				response: toolResultPretty,
				error: toolResult.isError ? "Error executing MCP tool" : undefined,
			})
		} else {
			// Send error status if no result
			await this.sendExecutionStatus(task, {
				executionId,
				status: "error",
				error: "No response from MCP server",
			})
		}

		await task.say("mcp_server_response", toolResultPretty)
		pushToolResult(formatResponse.toolResult(toolResultPretty))
	}
}

export const useMcpToolTool = new UseMcpToolTool()

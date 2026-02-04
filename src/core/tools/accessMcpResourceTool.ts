import type { ClineAskUseMcpServer } from "@roo-code/types"

import type { ToolUse } from "../../shared/tools"
import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"

import { BaseTool, ToolCallbacks } from "./BaseTool"

interface AccessMcpResourceParams {
	server_name: string
	uri: string
}

export class AccessMcpResourceTool extends BaseTool<"access_mcp_resource"> {
	readonly name = "access_mcp_resource" as const

	async execute(params: AccessMcpResourceParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, handleError, pushToolResult } = callbacks
		const { server_name, uri } = params

		try {
			if (!server_name) {
				task.consecutiveMistakeCount++
				task.recordToolError("access_mcp_resource")
				pushToolResult(await task.sayAndCreateMissingParamError("access_mcp_resource", "server_name"))
				return
			}

			if (!uri) {
				task.consecutiveMistakeCount++
				task.recordToolError("access_mcp_resource")
				pushToolResult(await task.sayAndCreateMissingParamError("access_mcp_resource", "uri"))
				return
			}

			task.consecutiveMistakeCount = 0

			const completeMessage = JSON.stringify({
				type: "access_mcp_resource",
				serverName: server_name,
				uri,
			} satisfies ClineAskUseMcpServer)

			const didApprove = await askApproval("use_mcp_server", completeMessage)

			if (!didApprove) {
				pushToolResult(formatResponse.toolDenied())
				return
			}

			// Now execute the tool
			await task.say("mcp_server_request_started")
			const resourceResult = await task.providerRef.deref()?.getMcpHub()?.readResource(server_name, uri)

			const resourceResultPretty =
				resourceResult?.contents
					.map((item) => {
						if (item.text) {
							return item.text
						}
						return ""
					})
					.filter(Boolean)
					.join("\n\n") || "(Empty response)"

			// Handle images (image must contain mimetype and blob)
			let images: string[] = []

			resourceResult?.contents.forEach((item) => {
				if (item.mimeType?.startsWith("image") && item.blob) {
					if (item.blob.startsWith("data:")) {
						images.push(item.blob)
					} else {
						images.push(`data:${item.mimeType};base64,` + item.blob)
					}
				}
			})

			await task.say("mcp_server_response", resourceResultPretty, images)
			pushToolResult(formatResponse.toolResult(resourceResultPretty, images))
		} catch (error) {
			await handleError("accessing MCP resource", error instanceof Error ? error : new Error(String(error)))
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"access_mcp_resource">): Promise<void> {
		const server_name = block.params.server_name ?? ""
		const uri = block.params.uri ?? ""

		const partialMessage = JSON.stringify({
			type: "access_mcp_resource",
			serverName: server_name,
			uri: uri,
		} satisfies ClineAskUseMcpServer)

		await task.ask("use_mcp_server", partialMessage, block.partial).catch(() => {})
	}
}

export const accessMcpResourceTool = new AccessMcpResourceTool()

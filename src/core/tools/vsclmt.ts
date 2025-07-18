import * as vscode from "vscode"
import { formatResponse } from "../prompts/responses"
import { ToolUse, AskApproval, HandleError, PushToolResult, RemoveClosingTag } from "../../shared/tools"
import { Task } from "../task/Task"

export async function useVSCLMT(
	cline: Task,
	toolUse: ToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag,
): Promise<void> {
	const { tool_name, arguments: toolArgs } = toolUse.params

	// Handle partial tool invocation (missing parameters)
	if (toolUse.partial) {
		const partialMessage = JSON.stringify({
			type: "vsclmt_tool",
			toolName: removeClosingTag("tool_name", tool_name),
			arguments: removeClosingTag("arguments", toolArgs),
		})

		await cline.ask("tool", partialMessage, toolUse.partial).catch(() => {})
		return
	}

	// Non-partial: require tool_name
	if (!tool_name) {
		cline.recordToolError("use_vsclmt")
		pushToolResult(await cline.sayAndCreateMissingParamError("use_vsclmt", "tool_name"))
		return
	}

	// Get the vsclmt service from ClineProvider
	const provider = cline.providerRef.deref()
	const vsclmtService = provider?.getVSCLMToolService()

	if (!vsclmtService) {
		pushToolResult(formatResponse.toolError("VS Code LM tool system not available"))
		return
	}

	// Parse arguments if provided
	let parsedArgs: any = {}
	if (toolArgs) {
		try {
			parsedArgs = JSON.parse(toolArgs)
		} catch (error) {
			pushToolResult(formatResponse.toolError(`Invalid JSON arguments: ${error.stack || error.message}`))
			return
		}
	}

	try {
		// Check if tool is selected
		if (!vsclmtService.isToolSelected(tool_name)) {
			pushToolResult(
				formatResponse.toolError(
					`Tool '${tool_name}' is not selected for use. Please select it in the Tool Selection panel.`,
				),
			)
			return
		}

		// Prepare tool invocation to get any user confirmation message
		const prepared = await vsclmtService.prepareToolInvocation(tool_name, parsedArgs)
		if (prepared?.confirmationMessages) {
			// Ask for approval with the tool's custom confirmation message
			const message =
				prepared.confirmationMessages.message instanceof vscode.MarkdownString
					? prepared.confirmationMessages.message.value
					: prepared.confirmationMessages.message

			const confirmText = `${prepared.confirmationMessages.title}\n${message}`
			const approved = await askApproval("tool", confirmText)

			if (!approved) {
				pushToolResult(formatResponse.toolDenied())
				return
			}
		}

		// Invoke the tool with any progress message from preparation
		const result = await vsclmtService.invokeTool(tool_name, parsedArgs)

		// Format the result for display
		const extractText = (obj: unknown): string => {
			if (typeof obj === "string") return obj
			if (!obj || typeof obj !== "object") return ""
			const asRecord = obj as Record<string, unknown>
			if ("text" in asRecord && typeof asRecord.text === "string") return asRecord.text
			if ("value" in asRecord && typeof asRecord.value === "string") return asRecord.value
			// Special handling for PromptTsx node structure
			if ("node" in asRecord && asRecord.node && typeof asRecord.node === "object") {
				const node = asRecord.node as Record<string, unknown>
				if ("children" in node && Array.isArray(node.children)) {
					return node.children.map((child: unknown) => extractText(child)).join("\n")
				}
			}
			if (Array.isArray(obj)) return obj.map((item) => extractText(item)).join("")
			return Object.values(asRecord)
				.map((v) => extractText(v))
				.join(" ")
		}

		const resultText = result.content
			.map((part): string => {
				if (typeof part === "object" && part !== null) {
					// Handle MarkdownString specifically
					if (part instanceof vscode.MarkdownString) {
						return part.value
					}
					// Handle objects with value property
					if ("value" in part) {
						const value = part.value
						if (value instanceof vscode.MarkdownString) {
							return value.value
						}
						if (typeof value === "string") {
							return value
						}
						// Handle LanguageModelPromptTsxPart or complex nested structures
						if (value && typeof value === "object") {
							return extractText(value)
						}
					}
					return JSON.stringify(part, null, 2)
				}
				return String(part)
			})
			.join("\n ---\n")

		pushToolResult(resultText)
	} catch (error) {
		await handleError("VS Code LM tool invocation", error)
		pushToolResult(
			formatResponse.toolError(
				`Failed to invoke VS Code LM tool '${tool_name}': ${error.stack || error.message}`,
			),
		)
	}
}

import cloneDeep from "clone-deep"
import { serializeError } from "serialize-error"
import { Anthropic } from "@anthropic-ai/sdk"

import type { ToolName, ClineAsk, ToolProgressStatus } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { defaultModeSlug, getModeBySlug } from "../../shared/modes"
import type { ToolParamName, ToolResponse, ToolUse, McpToolUse } from "../../shared/tools"
import { Package } from "../../shared/package"
import { t } from "../../i18n"
import { AskIgnoredError } from "../task/AskIgnoredError"

import { fetchInstructionsTool } from "../tools/FetchInstructionsTool"
import { listFilesTool } from "../tools/ListFilesTool"
import { readFileTool } from "../tools/ReadFileTool"
import { getSimpleReadFileToolDescription, simpleReadFileTool } from "../tools/simpleReadFileTool"
import { shouldUseSingleFileRead, TOOL_PROTOCOL } from "@roo-code/types"
import { writeToFileTool } from "../tools/WriteToFileTool"
import { applyDiffTool } from "../tools/MultiApplyDiffTool"
import { searchAndReplaceTool } from "../tools/SearchAndReplaceTool"
import { searchReplaceTool } from "../tools/SearchReplaceTool"
import { applyPatchTool } from "../tools/ApplyPatchTool"
import { searchFilesTool } from "../tools/SearchFilesTool"
import { browserActionTool } from "../tools/BrowserActionTool"
import { executeCommandTool } from "../tools/ExecuteCommandTool"
import { useMcpToolTool } from "../tools/UseMcpToolTool"
import { accessMcpResourceTool } from "../tools/accessMcpResourceTool"
import { askFollowupQuestionTool } from "../tools/AskFollowupQuestionTool"
import { switchModeTool } from "../tools/SwitchModeTool"
import { attemptCompletionTool, AttemptCompletionCallbacks } from "../tools/AttemptCompletionTool"
import { newTaskTool } from "../tools/NewTaskTool"

import { updateTodoListTool } from "../tools/UpdateTodoListTool"
import { runSlashCommandTool } from "../tools/RunSlashCommandTool"
import { generateImageTool } from "../tools/GenerateImageTool"

import { formatResponse } from "../prompts/responses"
import { validateToolUse } from "../tools/validateToolUse"
import { Task } from "../task/Task"
import { codebaseSearchTool } from "../tools/CodebaseSearchTool"
import { experiments, EXPERIMENT_IDS } from "../../shared/experiments"
import { applyDiffTool as applyDiffToolClass } from "../tools/ApplyDiffTool"

import { yieldPromise } from "../kilocode"
import { evaluateGatekeeperApproval } from "./kilocode/gatekeeper"
import { editFileTool, isFastApplyAvailable } from "../tools/kilocode/editFileTool"
import { deleteFileTool } from "../tools/kilocode/deleteFileTool"
import { newRuleTool } from "../tools/kilocode/newRuleTool"
import { reportBugTool } from "../tools/kilocode/reportBugTool"
import { condenseTool } from "../tools/kilocode/condenseTool"
import { captureAskApproval } from "./kilocode/captureAskApprovalEvent"

/**
 * Processes and presents assistant message content to the user interface.
 *
 * This function is the core message handling system that:
 * - Sequentially processes content blocks from the assistant's response.
 * - Displays text content to the user.
 * - Executes tool use requests with appropriate user approval.
 * - Manages the flow of conversation by determining when to proceed to the next content block.
 * - Coordinates file system checkpointing for modified files.
 * - Controls the conversation state to determine when to continue to the next request.
 *
 * The function uses a locking mechanism to prevent concurrent execution and handles
 * partial content blocks during streaming. It's designed to work with the streaming
 * API response pattern, where content arrives incrementally and needs to be processed
 * as it becomes available.
 */

export async function presentAssistantMessage(cline: Task) {
	if (cline.abort) {
		throw new Error(`[Task#presentAssistantMessage] task ${cline.taskId}.${cline.instanceId} aborted`)
	}

	if (cline.presentAssistantMessageLocked) {
		cline.presentAssistantMessageHasPendingUpdates = true
		return
	}

	cline.presentAssistantMessageLocked = true
	cline.presentAssistantMessageHasPendingUpdates = false

	if (cline.currentStreamingContentIndex >= cline.assistantMessageContent.length) {
		// This may happen if the last content block was completed before
		// streaming could finish. If streaming is finished, and we're out of
		// bounds then this means we already  presented/executed the last
		// content block and are ready to continue to next request.
		if (cline.didCompleteReadingStream) {
			cline.userMessageContentReady = true
		}

		cline.presentAssistantMessageLocked = false
		return
	}

	let block: any
	try {
		block = cloneDeep(cline.assistantMessageContent[cline.currentStreamingContentIndex]) // need to create copy bc while stream is updating the array, it could be updating the reference block properties too
	} catch (error) {
		console.error(`ERROR cloning block:`, error)
		console.error(
			`Block content:`,
			JSON.stringify(cline.assistantMessageContent[cline.currentStreamingContentIndex], null, 2),
		)
		cline.presentAssistantMessageLocked = false
		return
	}

	switch (block.type) {
		case "mcp_tool_use": {
			// Handle native MCP tool calls (from mcp_serverName_toolName dynamic tools)
			// These are converted to the same execution path as use_mcp_tool but preserve
			// their original name in API history
			const mcpBlock = block as McpToolUse

			if (cline.didRejectTool) {
				// For native protocol, we must send a tool_result for every tool_use to avoid API errors
				const toolCallId = mcpBlock.id
				const errorMessage = !mcpBlock.partial
					? `Skipping MCP tool ${mcpBlock.name} due to user rejecting a previous tool.`
					: `MCP tool ${mcpBlock.name} was interrupted and not executed due to user rejecting a previous tool.`

				if (toolCallId) {
					cline.userMessageContent.push({
						type: "tool_result",
						tool_use_id: toolCallId,
						content: errorMessage,
						is_error: true,
					} as Anthropic.ToolResultBlockParam)
				}
				break
			}

			if (cline.didAlreadyUseTool) {
				const toolCallId = mcpBlock.id
				const errorMessage = `MCP tool [${mcpBlock.name}] was not executed because a tool has already been used in this message. Only one tool may be used per message.`

				if (toolCallId) {
					cline.userMessageContent.push({
						type: "tool_result",
						tool_use_id: toolCallId,
						content: errorMessage,
						is_error: true,
					} as Anthropic.ToolResultBlockParam)
				}
				break
			}

			// Track if we've already pushed a tool result
			let hasToolResult = false
			const toolCallId = mcpBlock.id
			const toolProtocol = TOOL_PROTOCOL.NATIVE // MCP tools in native mode always use native protocol

			const pushToolResult = (content: ToolResponse) => {
				if (hasToolResult) {
					console.warn(
						`[presentAssistantMessage] Skipping duplicate tool_result for mcp_tool_use: ${toolCallId}`,
					)
					return
				}

				let resultContent: string
				let imageBlocks: Anthropic.ImageBlockParam[] = []

				if (typeof content === "string") {
					resultContent = content || "(tool did not return anything)"
				} else {
					const textBlocks = content.filter((item) => item.type === "text")
					imageBlocks = content.filter((item) => item.type === "image") as Anthropic.ImageBlockParam[]
					resultContent =
						textBlocks.map((item) => (item as Anthropic.TextBlockParam).text).join("\n") ||
						"(tool did not return anything)"
				}

				if (toolCallId) {
					cline.userMessageContent.push({
						type: "tool_result",
						tool_use_id: toolCallId,
						content: resultContent,
					} as Anthropic.ToolResultBlockParam)

					if (imageBlocks.length > 0) {
						cline.userMessageContent.push(...imageBlocks)
					}
				}

				hasToolResult = true
				cline.didAlreadyUseTool = true
			}

			const toolDescription = () => `[mcp_tool: ${mcpBlock.serverName}/${mcpBlock.toolName}]`

			const askApproval = async (
				type: ClineAsk,
				partialMessage?: string,
				progressStatus?: ToolProgressStatus,
				isProtected?: boolean,
			) => {
				const { response, text, images } = await cline.ask(
					type,
					partialMessage,
					false,
					progressStatus,
					isProtected || false,
				)

				if (response !== "yesButtonClicked") {
					if (text) {
						await cline.say("user_feedback", text, images)
						pushToolResult(
							formatResponse.toolResult(
								formatResponse.toolDeniedWithFeedback(text, toolProtocol),
								images,
							),
						)
					} else {
						pushToolResult(formatResponse.toolDenied(toolProtocol))
					}
					cline.didRejectTool = true
					return false
				}

				if (text) {
					await cline.say("user_feedback", text, images)
					pushToolResult(
						formatResponse.toolResult(formatResponse.toolApprovedWithFeedback(text, toolProtocol), images),
					)
				}

				return true
			}

			const handleError = async (action: string, error: Error) => {
				// Silently ignore AskIgnoredError - this is an internal control flow
				// signal, not an actual error. It occurs when a newer ask supersedes an older one.
				if (error instanceof AskIgnoredError) {
					return
				}
				const errorString = `Error ${action}: ${JSON.stringify(serializeError(error))}`
				await cline.say(
					"error",
					`Error ${action}:\n${error.message ?? JSON.stringify(serializeError(error), null, 2)}`,
				)
				pushToolResult(formatResponse.toolError(errorString, toolProtocol))
			}

			if (!mcpBlock.partial) {
				cline.recordToolUsage("use_mcp_tool") // Record as use_mcp_tool for analytics
				TelemetryService.instance.captureToolUsage(cline.taskId, "use_mcp_tool", toolProtocol)
			}

			// Resolve sanitized server name back to original server name
			// The serverName from parsing is sanitized (e.g., "my_server" from "my server")
			// We need the original name to find the actual MCP connection
			const mcpHub = cline.providerRef.deref()?.getMcpHub()
			let resolvedServerName = mcpBlock.serverName
			if (mcpHub) {
				const originalName = mcpHub.findServerNameBySanitizedName(mcpBlock.serverName)
				if (originalName) {
					resolvedServerName = originalName
				}
			}

			// Execute the MCP tool using the same handler as use_mcp_tool
			// Create a synthetic ToolUse block that the useMcpToolTool can handle
			const syntheticToolUse: ToolUse<"use_mcp_tool"> = {
				type: "tool_use",
				id: mcpBlock.id,
				name: "use_mcp_tool",
				params: {
					server_name: resolvedServerName,
					tool_name: mcpBlock.toolName,
					arguments: JSON.stringify(mcpBlock.arguments),
				},
				partial: mcpBlock.partial,
				nativeArgs: {
					server_name: resolvedServerName,
					tool_name: mcpBlock.toolName,
					arguments: mcpBlock.arguments,
				},
			}

			await useMcpToolTool.handle(cline, syntheticToolUse, {
				askApproval,
				handleError,
				pushToolResult,
				removeClosingTag: (tag, text) => text || "",
				toolProtocol,
			})
			break
		}
		case "text": {
			if (cline.didRejectTool || cline.didAlreadyUseTool) {
				break
			}

			let content = block.content

			if (content) {
				// Have to do this for partial and complete since sending
				// content in thinking tags to markdown renderer will
				// automatically be removed.
				// Remove end substrings of <thinking or </thinking (below xml
				// parsing is only for opening tags).
				// Tthis is done with the xml parsing below now, but keeping
				// here for reference.
				// content = content.replace(/<\/?t(?:h(?:i(?:n(?:k(?:i(?:n(?:g)?)?)?$/, "")
				//
				// Remove all instances of <thinking> (with optional line break
				// after) and </thinking> (with optional line break before).
				// - Needs to be separate since we dont want to remove the line
				//   break before the first tag.
				// - Needs to happen before the xml parsing below.
				content = content.replace(/<thinking>\s?/g, "")
				content = content.replace(/\s?<\/thinking>/g, "")

				// Remove partial XML tag at the very end of the content (for
				// tool use and thinking tags), Prevents scrollview from
				// jumping when tags are automatically removed.
				const lastOpenBracketIndex = content.lastIndexOf("<")

				if (lastOpenBracketIndex !== -1) {
					const possibleTag = content.slice(lastOpenBracketIndex)

					// Check if there's a '>' after the last '<' (i.e., if the
					// tag is complete) (complete thinking and tool tags will
					// have been removed by now.)
					const hasCloseBracket = possibleTag.includes(">")

					if (!hasCloseBracket) {
						// Extract the potential tag name.
						let tagContent: string

						if (possibleTag.startsWith("</")) {
							tagContent = possibleTag.slice(2).trim()
						} else {
							tagContent = possibleTag.slice(1).trim()
						}

						// Check if tagContent is likely an incomplete tag name
						// (letters and underscores only).
						const isLikelyTagName = /^[a-zA-Z_]+$/.test(tagContent)

						// Preemptively remove < or </ to keep from these
						// artifacts showing up in chat (also handles closing
						// thinking tags).
						const isOpeningOrClosing = possibleTag === "<" || possibleTag === "</"

						// If the tag is incomplete and at the end, remove it
						// from the content.
						if (isOpeningOrClosing || isLikelyTagName) {
							content = content.slice(0, lastOpenBracketIndex).trim()
						}
					}
				}
			}

			await cline.say("text", content, undefined, block.partial)
			break
		}
		case "tool_use": {
			// Fetch state early so it's available for toolDescription and validation
			const state = await cline.providerRef.deref()?.getState()
			const { mode, customModes, experiments: stateExperiments, apiConfiguration } = state ?? {}

			// kilocode_change start
			// Fast Apply + native tool aliases compatibility:
			// In native protocol parsing, `edit_file` may be treated as an alias for `apply_diff`.
			// When Fast Apply is actually enabled, we need to undo that aliasing so that the
			// real `edit_file` tool handler runs.
			if (
				isFastApplyAvailable(state as any) &&
				block.originalName === "edit_file" &&
				block.name === "apply_diff"
			) {
				block.name = "edit_file"
				block.originalName = undefined
			}
			// kilocode_change end

			const toolDescription = (): string => {
				switch (block.name) {
					case "execute_command":
						return `[${block.name} for '${block.params.command}']`
					case "read_file":
						// Check if this model should use the simplified description
						const modelId = cline.api.getModel().id
						if (shouldUseSingleFileRead(modelId)) {
							return getSimpleReadFileToolDescription(block.name, block.params)
						} else {
							// Prefer native typed args when available; fall back to legacy params
							// Check if nativeArgs exists (native protocol)
							if (block.nativeArgs) {
								return readFileTool.getReadFileToolDescription(block.name, block.nativeArgs)
							}
							return readFileTool.getReadFileToolDescription(block.name, block.params)
						}
					case "fetch_instructions":
						return `[${block.name} for '${block.params.task}']`
					case "write_to_file":
						return `[${block.name} for '${block.params.path}']`
					case "apply_diff":
						// Handle both legacy format and new multi-file format
						if (block.params.path) {
							return `[${block.name} for '${block.params.path}']`
						} else if (block.params.args) {
							// Try to extract first file path from args for display
							const match = block.params.args.match(/<file>.*?<path>([^<]+)<\/path>/s)
							if (match) {
								const firstPath = match[1]
								// Check if there are multiple files
								const fileCount = (block.params.args.match(/<file>/g) || []).length
								if (fileCount > 1) {
									return `[${block.name} for '${firstPath}' and ${fileCount - 1} more file${fileCount > 2 ? "s" : ""}]`
								} else {
									return `[${block.name} for '${firstPath}']`
								}
							}
						}
						return `[${block.name}]`
					case "search_files":
						return `[${block.name} for '${block.params.regex}'${
							block.params.file_pattern ? ` in '${block.params.file_pattern}'` : ""
						}]`
					case "search_and_replace":
						return `[${block.name} for '${block.params.path}']`
					// kilocode_change start
					case "edit_file":
						return `[${block.name} for '${block.params.target_file}']`
					case "delete_file":
						return `[${block.name} for '${block.params.path}']`
					// kilocode_change end
					case "search_replace":
						return `[${block.name} for '${block.params.file_path}']`
					case "apply_patch":
						return `[${block.name}]`
					case "list_files":
						return `[${block.name} for '${block.params.path}']`
					case "browser_action":
						return `[${block.name} for '${block.params.action}']`
					case "use_mcp_tool":
						return `[${block.name} for '${block.params.server_name}']`
					case "access_mcp_resource":
						return `[${block.name} for '${block.params.server_name}']`
					case "ask_followup_question":
						return `[${block.name} for '${block.params.question}']`
					case "attempt_completion":
						return `[${block.name}]`
					case "switch_mode":
						return `[${block.name} to '${block.params.mode_slug}'${block.params.reason ? ` because: ${block.params.reason}` : ""}]`
					case "codebase_search": // Add case for the new tool
						return `[${block.name} for '${block.params.query}']`
					case "update_todo_list":
						return `[${block.name}]`
					case "new_task": {
						const mode = block.params.mode ?? defaultModeSlug
						const message = block.params.message ?? "(no message)"
						const modeName = getModeBySlug(mode, customModes)?.name ?? mode
						return `[${block.name} in ${modeName} mode: '${message}']`
					}
					// kilocode_change start
					case "new_rule":
						return `[${block.name} for '${block.params.path}']`
					case "report_bug":
						return `[${block.name}]`
					case "condense":
						return `[${block.name}]`
					// kilocode_change end
					case "run_slash_command":
						return `[${block.name} for '${block.params.command}'${block.params.args ? ` with args: ${block.params.args}` : ""}]`
					case "generate_image":
						return `[${block.name} for '${block.params.path}']`
					default:
						return `[${block.name}]`
				}
			}

			if (cline.didRejectTool) {
				// Ignore any tool content after user has rejected tool once.
				// For native protocol, we must send a tool_result for every tool_use to avoid API errors
				const toolCallId = block.id
				const errorMessage = !block.partial
					? `Skipping tool ${toolDescription()} due to user rejecting a previous tool.`
					: `Tool ${toolDescription()} was interrupted and not executed due to user rejecting a previous tool.`

				if (toolCallId) {
					// Native protocol: MUST send tool_result for every tool_use
					cline.userMessageContent.push({
						type: "tool_result",
						tool_use_id: toolCallId,
						content: errorMessage,
						is_error: true,
					} as Anthropic.ToolResultBlockParam)
				} else {
					// XML protocol: send as text
					cline.userMessageContent.push({
						type: "text",
						text: errorMessage,
					})
				}

				break
			}

			if (cline.didAlreadyUseTool) {
				// Ignore any content after a tool has already been used.
				// For native protocol, we must send a tool_result for every tool_use to avoid API errors
				const toolCallId = block.id
				const errorMessage = `Tool [${block.name}] was not executed because a tool has already been used in this message. Only one tool may be used per message. You must assess the first tool's result before proceeding to use the next tool.`

				if (toolCallId) {
					// Native protocol: MUST send tool_result for every tool_use
					cline.userMessageContent.push({
						type: "tool_result",
						tool_use_id: toolCallId,
						content: errorMessage,
						is_error: true,
					} as Anthropic.ToolResultBlockParam)
				} else {
					// XML protocol: send as text
					cline.userMessageContent.push({
						type: "text",
						text: errorMessage,
					})
				}

				break
			}

			// Track if we've already pushed a tool result for this tool call (native protocol only)
			let hasToolResult = false

			// Determine protocol by checking if this tool call has an ID.
			// Native protocol tool calls ALWAYS have an ID (set when parsed from tool_call chunks).
			// XML protocol tool calls NEVER have an ID (parsed from XML text).
			const toolCallId = (block as any).id
			const toolProtocol = toolCallId ? TOOL_PROTOCOL.NATIVE : TOOL_PROTOCOL.XML

			// Multiple native tool calls feature is on hold - always disabled
			// Previously resolved from experiments.isEnabled(..., EXPERIMENT_IDS.MULTIPLE_NATIVE_TOOL_CALLS)
			const isMultipleNativeToolCallsEnabled = false

			const pushToolResult = (content: ToolResponse) => {
				if (toolProtocol === TOOL_PROTOCOL.NATIVE) {
					// For native protocol, only allow ONE tool_result per tool call
					if (hasToolResult) {
						console.warn(
							`[presentAssistantMessage] Skipping duplicate tool_result for tool_use_id: ${toolCallId}`,
						)
						return
					}

					// For native protocol, tool_result content must be a string
					// Images are added as separate blocks in the user message
					let resultContent: string
					let imageBlocks: Anthropic.ImageBlockParam[] = []

					if (typeof content === "string") {
						resultContent = content || "(tool did not return anything)"
					} else {
						// Separate text and image blocks
						const textBlocks = content.filter((item) => item.type === "text")
						imageBlocks = content.filter((item) => item.type === "image") as Anthropic.ImageBlockParam[]

						// Convert text blocks to string for tool_result
						resultContent =
							textBlocks.map((item) => (item as Anthropic.TextBlockParam).text).join("\n") ||
							"(tool did not return anything)"
					}

					// Add tool_result with text content only
					cline.userMessageContent.push({
						type: "tool_result",
						tool_use_id: toolCallId,
						content: resultContent,
					} as Anthropic.ToolResultBlockParam)

					// Add image blocks separately after tool_result
					if (imageBlocks.length > 0) {
						cline.userMessageContent.push(...imageBlocks)
					}

					hasToolResult = true
				} else {
					// For XML protocol, add as text blocks (legacy behavior)
					cline.userMessageContent.push({ type: "text", text: `${toolDescription()} Result:` })

					if (typeof content === "string") {
						cline.userMessageContent.push({
							type: "text",
							text: content || "(tool did not return anything)",
						})
					} else {
						cline.userMessageContent.push(...content)
					}
				}

				// For XML protocol: Only one tool per message is allowed
				// For native protocol with experimental flag enabled: Multiple tools can be executed in sequence
				// For native protocol with experimental flag disabled: Single tool per message (default safe behavior)
				if (toolProtocol === TOOL_PROTOCOL.XML) {
					// Once a tool result has been collected, ignore all other tool
					// uses since we should only ever present one tool result per
					// message (XML protocol only).
					cline.didAlreadyUseTool = true
				} else if (toolProtocol === TOOL_PROTOCOL.NATIVE && !isMultipleNativeToolCallsEnabled) {
					// For native protocol with experimental flag disabled, enforce single tool per message
					cline.didAlreadyUseTool = true
				}
				// If toolProtocol is NATIVE and isMultipleNativeToolCallsEnabled is true,
				// allow multiple tool calls in sequence (don't set didAlreadyUseTool)
			}

			const askApproval = async (
				type: ClineAsk,
				partialMessage?: string,
				progressStatus?: ToolProgressStatus,
				isProtected?: boolean,
			) => {
				// kilocode_change start: YOLO mode with AI gatekeeper
				const state = await cline.providerRef.deref()?.getState()
				if (state?.yoloMode) {
					// If gatekeeper is configured, use it to evaluate the approval
					const approved = await evaluateGatekeeperApproval(cline, block.name, block.params)
					if (!approved) {
						// Gatekeeper denied the action
						pushToolResult(formatResponse.toolDenied())
						cline.didRejectTool = true
						captureAskApproval(block.name, false)
						return false
					}
					captureAskApproval(block.name, true)
					return true
				}
				// kilocode_change end

				const { response, text, images } = await cline.ask(
					type,
					partialMessage,
					false,
					progressStatus,
					isProtected || false,
				)

				if (response !== "yesButtonClicked") {
					// Handle both messageResponse and noButtonClicked with text.
					if (text) {
						await cline.say("user_feedback", text, images)
						pushToolResult(
							formatResponse.toolResult(
								formatResponse.toolDeniedWithFeedback(text, toolProtocol),
								images,
							),
						)
					} else {
						pushToolResult(formatResponse.toolDenied(toolProtocol))
					}
					cline.didRejectTool = true
					captureAskApproval(block.name, false) // kilocode_change
					return false
				}

				// Handle yesButtonClicked with text.
				if (text) {
					await cline.say("user_feedback", text, images)
					pushToolResult(
						formatResponse.toolResult(formatResponse.toolApprovedWithFeedback(text, toolProtocol), images),
					)
				}

				captureAskApproval(block.name, true) // kilocode_change
				return true
			}

			const askFinishSubTaskApproval = async () => {
				// Ask the user to approve this task has completed, and he has
				// reviewed it, and we can declare task is finished and return
				// control to the parent task to continue running the rest of
				// the sub-tasks.
				const toolMessage = JSON.stringify({ tool: "finishTask" })
				return await askApproval("tool", toolMessage)
			}

			const handleError = async (action: string, error: Error) => {
				// Silently ignore AskIgnoredError - this is an internal control flow
				// signal, not an actual error. It occurs when a newer ask supersedes an older one.
				if (error instanceof AskIgnoredError) {
					return
				}
				const errorString = `Error ${action}: ${JSON.stringify(serializeError(error))}`

				await cline.say(
					"error",
					`Error ${action}:\n${error.message ?? JSON.stringify(serializeError(error), null, 2)}`,
				)

				pushToolResult(formatResponse.toolError(errorString, toolProtocol))
			}

			// If block is partial, remove partial closing tag so its not
			// presented to user.
			const removeClosingTag = (tag: ToolParamName, text?: string): string => {
				if (!block.partial) {
					return text || ""
				}

				if (!text) {
					return ""
				}

				// This regex dynamically constructs a pattern to match the
				// closing tag:
				// - Optionally matches whitespace before the tag.
				// - Matches '<' or '</' optionally followed by any subset of
				//   characters from the tag name.
				const tagRegex = new RegExp(
					`\\s?<\/?${tag
						.split("")
						.map((char) => `(?:${char})?`)
						.join("")}$`,
					"g",
				)

				return text.replace(tagRegex, "")
			}

			// Keep browser open during an active session so other tools can run.
			// Session is active if we've seen any browser_action_result and the last browser_action is not "close".
			try {
				const messages = cline.clineMessages || []
				const hasStarted = messages.some((m: any) => m.say === "browser_action_result")
				let isClosed = false
				for (let i = messages.length - 1; i >= 0; i--) {
					const m = messages[i]
					if (m.say === "browser_action") {
						try {
							const act = JSON.parse(m.text || "{}")
							isClosed = act.action === "close"
						} catch {}
						break
					}
				}
				const sessionActive = hasStarted && !isClosed
				// Only auto-close when no active browser session is present, and this isn't a browser_action
				if (!sessionActive && block.name !== "browser_action") {
					await cline.browserSession.closeBrowser()
				}
			} catch {
				// On any unexpected error, fall back to conservative behavior
				if (block.name !== "browser_action") {
					await cline.browserSession.closeBrowser()
				}
			}

			if (!block.partial) {
				cline.recordToolUsage(block.name)
				TelemetryService.instance.captureToolUsage(cline.taskId, block.name, toolProtocol)
			}

			// Validate tool use before execution - ONLY for complete (non-partial) blocks.
			// Validating partial blocks would cause validation errors to be thrown repeatedly
			// during streaming, pushing multiple tool_results for the same tool_use_id and
			// potentially causing the stream to appear frozen.
			if (!block.partial) {
				const modelInfo = cline.api.getModel()
				// Resolve aliases in includedTools before validation
				// e.g., "edit_file" should resolve to "apply_diff"
				const rawIncludedTools = modelInfo?.info?.includedTools
				const { resolveToolAlias } = await import("../prompts/tools/filter-tools-for-mode")
				const includedTools = rawIncludedTools?.map((tool) => resolveToolAlias(tool))

				try {
					validateToolUse(
						block.name as ToolName,
						mode ?? defaultModeSlug,
						customModes ?? [],
						{ apply_diff: cline.diffEnabled },
						block.params,
						stateExperiments,
						includedTools,
					)
				} catch (error) {
					cline.consecutiveMistakeCount++
					// For validation errors (unknown tool, tool not allowed for mode), we need to:
					// 1. Send a tool_result with the error (required for native protocol)
					// 2. NOT set didAlreadyUseTool = true (the tool was never executed, just failed validation)
					// This prevents the stream from being interrupted with "Response interrupted by tool use result"
					// which would cause the extension to appear to hang
					const errorContent = formatResponse.toolError(error.message, toolProtocol)
					if (toolProtocol === TOOL_PROTOCOL.NATIVE && toolCallId) {
						// For native protocol, push tool_result directly without setting didAlreadyUseTool
						cline.userMessageContent.push({
							type: "tool_result",
							tool_use_id: toolCallId,
							content: typeof errorContent === "string" ? errorContent : "(validation error)",
							is_error: true,
						} as Anthropic.ToolResultBlockParam)
					} else {
						// For XML protocol, use the standard pushToolResult
						pushToolResult(errorContent)
					}
					break
				}
			}

			// Check for identical consecutive tool calls.
			if (!block.partial) {
				// Use the detector to check for repetition, passing the ToolUse
				// block directly.
				const repetitionCheck = cline.toolRepetitionDetector.check(block)

				// If execution is not allowed, notify user and break.
				if (!repetitionCheck.allowExecution && repetitionCheck.askUser) {
					// Handle repetition similar to mistake_limit_reached pattern.
					const { response, text, images } = await cline.ask(
						repetitionCheck.askUser.messageKey as ClineAsk,
						repetitionCheck.askUser.messageDetail.replace("{toolName}", block.name),
					)

					if (response === "messageResponse") {
						// Add user feedback to userContent.
						cline.userMessageContent.push(
							{
								type: "text" as const,
								text: `Tool repetition limit reached. User feedback: ${text}`,
							},
							...formatResponse.imageBlocks(images),
						)

						// Add user feedback to chat.
						await cline.say("user_feedback", text, images)

						// Track tool repetition in telemetry.
						TelemetryService.instance.captureConsecutiveMistakeError(cline.taskId)
					}

					// Return tool result message about the repetition
					pushToolResult(
						formatResponse.toolError(
							`Tool call repetition limit reached for ${block.name}. Please try a different approach.`,
							toolProtocol,
						),
					)
					break
				}
			}

			await checkpointSaveAndMark(cline) // kilocode_change: moved out of switch
			switch (block.name) {
				case "write_to_file":
					// await checkpointSaveAndMark(cline) // kilocode_change
					await writeToFileTool.handle(cline, block as ToolUse<"write_to_file">, {
						askApproval,
						handleError,
						pushToolResult,
						removeClosingTag,
						toolProtocol,
					})
					break
				case "update_todo_list":
					await updateTodoListTool.handle(cline, block as ToolUse<"update_todo_list">, {
						askApproval,
						handleError,
						pushToolResult,
						removeClosingTag,
						toolProtocol,
					})
					break
				case "apply_diff": {
					await checkpointSaveAndMark(cline)

					// Check if this tool call came from native protocol by checking for ID
					// Native calls always have IDs, XML calls never do
					if (toolProtocol === TOOL_PROTOCOL.NATIVE) {
						await applyDiffToolClass.handle(cline, block as ToolUse<"apply_diff">, {
							askApproval,
							handleError,
							pushToolResult,
							removeClosingTag,
							toolProtocol,
						})
						break
					}

					// Get the provider and state to check experiment settings
					const provider = cline.providerRef.deref()
					let isMultiFileApplyDiffEnabled = false

					if (provider) {
						const state = await provider.getState()
						isMultiFileApplyDiffEnabled = experiments.isEnabled(
							state.experiments ?? {},
							EXPERIMENT_IDS.MULTI_FILE_APPLY_DIFF,
						)
					}

					if (isMultiFileApplyDiffEnabled) {
						await applyDiffTool(cline, block, askApproval, handleError, pushToolResult, removeClosingTag)
					} else {
						await applyDiffToolClass.handle(cline, block as ToolUse<"apply_diff">, {
							askApproval,
							handleError,
							pushToolResult,
							removeClosingTag,
							toolProtocol,
						})
					}
					break
				}
				case "search_and_replace":
					await checkpointSaveAndMark(cline)
					await searchAndReplaceTool.handle(cline, block as ToolUse<"search_and_replace">, {
						askApproval,
						handleError,
						pushToolResult,
						removeClosingTag,
						toolProtocol,
					})
					break
				case "search_replace":
					await checkpointSaveAndMark(cline)
					await searchReplaceTool.handle(cline, block as ToolUse<"search_replace">, {
						askApproval,
						handleError,
						pushToolResult,
						removeClosingTag,
						toolProtocol,
					})
					break
				case "apply_patch":
					await checkpointSaveAndMark(cline)
					await applyPatchTool.handle(cline, block as ToolUse<"apply_patch">, {
						askApproval,
						handleError,
						pushToolResult,
						removeClosingTag,
						toolProtocol,
					})
					break
				// kilocode_change start: Morph fast apply
				case "edit_file":
					await editFileTool(cline, block, askApproval, handleError, pushToolResult, removeClosingTag)
					break
				case "delete_file":
					await deleteFileTool(cline, block, askApproval, handleError, pushToolResult, removeClosingTag)
					break
				// kilocode_change end
				case "read_file":
					// Check if this model should use the simplified single-file read tool
					// Only use simplified tool for XML protocol - native protocol works with standard tool
					const modelId = cline.api.getModel().id
					if (shouldUseSingleFileRead(modelId) && toolProtocol !== TOOL_PROTOCOL.NATIVE) {
						await simpleReadFileTool(
							cline,
							block,
							askApproval,
							handleError,
							pushToolResult,
							removeClosingTag,
							toolProtocol,
						)
					} else {
						// Type assertion is safe here because we're in the "read_file" case
						await readFileTool.handle(cline, block as ToolUse<"read_file">, {
							askApproval,
							handleError,
							pushToolResult,
							removeClosingTag,
							toolProtocol,
						})
					}
					break
				case "fetch_instructions":
					await fetchInstructionsTool.handle(cline, block as ToolUse<"fetch_instructions">, {
						askApproval,
						handleError,
						pushToolResult,
						removeClosingTag,
						toolProtocol,
					})
					break
				case "list_files":
					await listFilesTool.handle(cline, block as ToolUse<"list_files">, {
						askApproval,
						handleError,
						pushToolResult,
						removeClosingTag,
						toolProtocol,
					})
					break
				case "codebase_search":
					await codebaseSearchTool.handle(cline, block as ToolUse<"codebase_search">, {
						askApproval,
						handleError,
						pushToolResult,
						removeClosingTag,
						toolProtocol,
					})
					break
				case "search_files":
					await searchFilesTool.handle(cline, block as ToolUse<"search_files">, {
						askApproval,
						handleError,
						pushToolResult,
						removeClosingTag,
						toolProtocol,
					})
					break
				case "browser_action":
					await browserActionTool(
						cline,
						block as ToolUse<"browser_action">,
						askApproval,
						handleError,
						pushToolResult,
						removeClosingTag,
					)
					break
				case "execute_command":
					await executeCommandTool.handle(cline, block as ToolUse<"execute_command">, {
						askApproval,
						handleError,
						pushToolResult,
						removeClosingTag,
						toolProtocol,
					})
					break
				case "use_mcp_tool":
					await useMcpToolTool.handle(cline, block as ToolUse<"use_mcp_tool">, {
						askApproval,
						handleError,
						pushToolResult,
						removeClosingTag,
						toolProtocol,
					})
					break
				case "access_mcp_resource":
					await accessMcpResourceTool.handle(cline, block as ToolUse<"access_mcp_resource">, {
						askApproval,
						handleError,
						pushToolResult,
						removeClosingTag,
						toolProtocol,
					})
					break
				case "ask_followup_question":
					await askFollowupQuestionTool.handle(cline, block as ToolUse<"ask_followup_question">, {
						askApproval,
						handleError,
						pushToolResult,
						removeClosingTag,
						toolProtocol,
					})
					break
				case "switch_mode":
					await switchModeTool.handle(cline, block as ToolUse<"switch_mode">, {
						askApproval,
						handleError,
						pushToolResult,
						removeClosingTag,
						toolProtocol,
					})
					break
				case "new_task":
					await newTaskTool.handle(cline, block as ToolUse<"new_task">, {
						askApproval,
						handleError,
						pushToolResult,
						removeClosingTag,
						toolProtocol,
						toolCallId: block.id,
					})
					break
				case "attempt_completion": {
					const completionCallbacks: AttemptCompletionCallbacks = {
						askApproval,
						handleError,
						pushToolResult,
						removeClosingTag,
						askFinishSubTaskApproval,
						toolDescription,
						toolProtocol,
					}
					await attemptCompletionTool.handle(
						cline,
						block as ToolUse<"attempt_completion">,
						completionCallbacks,
					)
					break
				}
				// kilocode_change start
				case "new_rule":
					await newRuleTool(cline, block, askApproval, handleError, pushToolResult, removeClosingTag)
					break
				case "report_bug":
					await reportBugTool(cline, block, askApproval, handleError, pushToolResult, removeClosingTag)
					break
				case "condense":
					await condenseTool(cline, block, askApproval, handleError, pushToolResult, removeClosingTag)
					break
				// kilocode_change end

				case "run_slash_command":
					await runSlashCommandTool.handle(cline, block as ToolUse<"run_slash_command">, {
						askApproval,
						handleError,
						pushToolResult,
						removeClosingTag,
						toolProtocol,
					})
					break
				case "generate_image":
					await checkpointSaveAndMark(cline)
					await generateImageTool.handle(cline, block as ToolUse<"generate_image">, {
						askApproval,
						handleError,
						pushToolResult,
						removeClosingTag,
						toolProtocol,
					})
					break
				default: {
					// Handle unknown/invalid tool names
					// This is critical for native protocol where every tool_use MUST have a tool_result
					// Note: This case should rarely be reached since validateToolUse now checks for unknown tools

					// CRITICAL: Don't process partial blocks for unknown tools - just let them stream in.
					// If we try to show errors for partial blocks, we'd show the error on every streaming chunk,
					// creating a loop that appears to freeze the extension. Only handle complete blocks.
					if (block.partial) {
						break
					}

					const errorMessage = `Unknown tool "${block.name}". This tool does not exist. Please use one of the available tools.`
					cline.consecutiveMistakeCount++
					cline.recordToolError(block.name as ToolName, errorMessage)
					await cline.say("error", t("tools:unknownToolError", { toolName: block.name }))
					// Push tool_result directly for native protocol WITHOUT setting didAlreadyUseTool
					// This prevents the stream from being interrupted with "Response interrupted by tool use result"
					if (toolProtocol === TOOL_PROTOCOL.NATIVE && toolCallId) {
						cline.userMessageContent.push({
							type: "tool_result",
							tool_use_id: toolCallId,
							content: formatResponse.toolError(errorMessage, toolProtocol),
							is_error: true,
						} as Anthropic.ToolResultBlockParam)
					} else {
						pushToolResult(formatResponse.toolError(errorMessage, toolProtocol))
					}
					break
				}
			}

			break
		}
	}

	// Seeing out of bounds is fine, it means that the next too call is being
	// built up and ready to add to assistantMessageContent to present.
	// When you see the UI inactive during this, it means that a tool is
	// breaking without presenting any UI. For example the write_to_file tool
	// was breaking when relpath was undefined, and for invalid relpath it never
	// presented UI.
	// This needs to be placed here, if not then calling
	// cline.presentAssistantMessage below would fail (sometimes) since it's
	// locked.
	cline.presentAssistantMessageLocked = false

	// NOTE: When tool is rejected, iterator stream is interrupted and it waits
	// for `userMessageContentReady` to be true. Future calls to present will
	// skip execution since `didRejectTool` and iterate until `contentIndex` is
	// set to message length and it sets userMessageContentReady to true itself
	// (instead of preemptively doing it in iterator).
	if (!block.partial || cline.didRejectTool || cline.didAlreadyUseTool) {
		// Block is finished streaming and executing.
		if (cline.currentStreamingContentIndex === cline.assistantMessageContent.length - 1) {
			// It's okay that we increment if !didCompleteReadingStream, it'll
			// just return because out of bounds and as streaming continues it
			// will call `presentAssitantMessage` if a new block is ready. If
			// streaming is finished then we set `userMessageContentReady` to
			// true when out of bounds. This gracefully allows the stream to
			// continue on and all potential content blocks be presented.
			// Last block is complete and it is finished executing
			cline.userMessageContentReady = true // Will allow `pWaitFor` to continue.
		}

		// Call next block if it exists (if not then read stream will call it
		// when it's ready).
		// Need to increment regardless, so when read stream calls this function
		// again it will be streaming the next block.
		cline.currentStreamingContentIndex++

		if (cline.currentStreamingContentIndex < cline.assistantMessageContent.length) {
			// There are already more content blocks to stream, so we'll call
			// this function ourselves.
			// kilocode_change start: prevent excessive recursion
			await yieldPromise()
			await presentAssistantMessage(cline)
			// kilocode_change end
			return
		} else {
			// CRITICAL FIX: If we're out of bounds and the stream is complete, set userMessageContentReady
			// This handles the case where assistantMessageContent is empty or becomes empty after processing
			if (cline.didCompleteReadingStream) {
				cline.userMessageContentReady = true
			}
		}
	}

	// Block is partial, but the read stream may have finished.
	if (cline.presentAssistantMessageHasPendingUpdates) {
		// kilocode_change start: prevent excessive recursion
		await yieldPromise()
		await presentAssistantMessage(cline)
		// kilocode_change end
	}
}

/**
 * save checkpoint and mark done in the current streaming task.
 * @param task The Task instance to checkpoint save and mark.
 * @returns
 */
async function checkpointSaveAndMark(task: Task) {
	if (task.currentStreamingDidCheckpoint) {
		return
	}
	try {
		// kilocode_change: order changed to prevent second execution while still awaiting the save
		task.currentStreamingDidCheckpoint = true
		await task.checkpointSave(true)
	} catch (error) {
		console.error(`[Task#presentAssistantMessage] Error saving checkpoint: ${error.message}`, error)
	}
}

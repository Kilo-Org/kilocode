import { Anthropic } from "@anthropic-ai/sdk"
import * as path from "path"
import * as diff from "diff"
import * as fs from "fs" // kilocode_change
import { RooIgnoreController, LOCK_TEXT_SYMBOL } from "../ignore/RooIgnoreController"
import { RooProtectedController } from "../protect/RooProtectedController"
import * as vscode from "vscode"
import { ToolProtocol, isNativeProtocol, TOOL_PROTOCOL } from "@roo-code/types"
import { Package } from "../../shared/package"

export const formatResponse = {
	// kilocode_change start
	duplicateFileReadNotice: () =>
		`[[NOTE] This file read has been removed to save space in the context window. Refer to the latest file read for the most up to date version of this file.]`,

	contextTruncationNotice: () =>
		`[NOTE] Some previous conversation history with the user has been removed to maintain optimal context window length. The initial user task and the most recent exchanges have been retained for continuity, while intermediate conversation history has been removed. Please keep this in mind as you continue assisting the user.`,

	condense: () =>
		`The user has accepted the condensed conversation summary you generated. This summary covers important details of the historical conversation with the user which has been truncated.\n<explicit_instructions type="condense_response">It's crucial that you respond by ONLY asking the user what you should work on next. You should NOT take any initiative or make any assumptions about continuing with work. For example you should NOT suggest file changes or attempt to read any files.\nWhen asking the user what you should work on next, you can reference information in the summary which was just generated. However, you should NOT reference information outside of what's contained in the summary for this response. Keep this response CONCISE.</explicit_instructions>`,
	// kilocode_change end
	toolDenied: (protocol?: ToolProtocol) => {
		if (isNativeProtocol(protocol ?? TOOL_PROTOCOL.XML)) {
			return JSON.stringify({
				status: "denied",
				message: "The user denied this operation.",
			})
		}
		return `The user denied this operation.`
	},

	toolDeniedWithFeedback: (feedback?: string, protocol?: ToolProtocol) => {
		if (isNativeProtocol(protocol ?? TOOL_PROTOCOL.XML)) {
			return JSON.stringify({
				status: "denied",
				message: "The user denied this operation and provided the following feedback",
				feedback: feedback,
			})
		}
		return `The user denied this operation and provided the following feedback:\n<feedback>\n${feedback}\n</feedback>`
	},

	toolApprovedWithFeedback: (feedback?: string, protocol?: ToolProtocol) => {
		if (isNativeProtocol(protocol ?? TOOL_PROTOCOL.XML)) {
			return JSON.stringify({
				status: "approved",
				message: "The user approved this operation and provided the following context",
				feedback: feedback,
			})
		}
		return `The user approved this operation and provided the following context:\n<feedback>\n${feedback}\n</feedback>`
	},

	toolError: (error?: string, protocol?: ToolProtocol) => {
		if (isNativeProtocol(protocol ?? TOOL_PROTOCOL.XML)) {
			return JSON.stringify({
				status: "error",
				message: "The tool execution failed",
				error: error,
			})
		}
		return `The tool execution failed with the following error:\n<error>\n${error}\n</error>`
	},

	rooIgnoreError: (path: string, protocol?: ToolProtocol) => {
		if (isNativeProtocol(protocol ?? TOOL_PROTOCOL.XML)) {
			return JSON.stringify({
				status: "error",
				type: "access_denied",
				message: "Access blocked by .kilocodeignore",
				path: path,
				suggestion: "Try to continue without this file, or ask the user to update the .kilocodeignore file",
			})
		}
		return `Access to ${path} is blocked by the .kilocodeignore file settings. You must try to continue in the task without using this file, or ask the user to update the .kilocodeignore file.`
	},

	noToolsUsed: (protocol?: ToolProtocol) => {
		const instructions = getToolInstructionsReminder(protocol)

		return `[ERROR] You did not use a tool in your previous response! Please retry with a tool use.

${instructions}

# Next Steps

If you have completed the user's task, use the attempt_completion tool.
If you require additional information from the user, use the ask_followup_question tool.
Otherwise, if you have not completed the task and do not need additional information, then proceed with the next step of the task.
(This is an automated message, so do not respond to it conversationally.)`
	},

	tooManyMistakes: (feedback?: string, protocol?: ToolProtocol) => {
		if (isNativeProtocol(protocol ?? TOOL_PROTOCOL.XML)) {
			return JSON.stringify({
				status: "guidance",
				message: "You seem to be having trouble proceeding",
				feedback: feedback,
			})
		}
		return `You seem to be having trouble proceeding. The user has provided the following feedback to help guide you:\n<feedback>\n${feedback}\n</feedback>`
	},

	missingToolParameterError: (paramName: string, protocol?: ToolProtocol) => {
		const instructions = getToolInstructionsReminder(protocol)

		return `Missing value for required parameter '${paramName}'. Please retry with complete response.\n\n${instructions}`
	},

	invalidMcpToolArgumentError: (serverName: string, toolName: string, protocol?: ToolProtocol) => {
		if (isNativeProtocol(protocol ?? TOOL_PROTOCOL.XML)) {
			return JSON.stringify({
				status: "error",
				type: "invalid_argument",
				message: "Invalid JSON argument",
				server: serverName,
				tool: toolName,
				suggestion: "Please retry with a properly formatted JSON argument",
			})
		}
		return `Invalid JSON argument used with ${serverName} for ${toolName}. Please retry with a properly formatted JSON argument.`
	},

	unknownMcpToolError: (serverName: string, toolName: string, availableTools: string[], protocol?: ToolProtocol) => {
		if (isNativeProtocol(protocol ?? TOOL_PROTOCOL.XML)) {
			return JSON.stringify({
				status: "error",
				type: "unknown_tool",
				message: "Tool does not exist on server",
				server: serverName,
				tool: toolName,
				available_tools: availableTools.length > 0 ? availableTools : [],
				suggestion: "Please use one of the available tools or check if the server is properly configured",
			})
		}
		const toolsList = availableTools.length > 0 ? availableTools.join(", ") : "No tools available"
		return `Tool '${toolName}' does not exist on server '${serverName}'.\n\nAvailable tools on this server: ${toolsList}\n\nPlease use one of the available tools or check if the server is properly configured.`
	},

	unknownMcpServerError: (serverName: string, availableServers: string[], protocol?: ToolProtocol) => {
		if (isNativeProtocol(protocol ?? TOOL_PROTOCOL.XML)) {
			return JSON.stringify({
				status: "error",
				type: "unknown_server",
				message: "Server is not configured",
				server: serverName,
				available_servers: availableServers.length > 0 ? availableServers : [],
			})
		}
		const serversList = availableServers.length > 0 ? availableServers.join(", ") : "No servers available"
		return `Server '${serverName}' is not configured. Available servers: ${serversList}`
	},

	toolResult: (
		text: string,
		images?: string[],
	): string | Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> => {
		if (images && images.length > 0) {
			const textBlock: Anthropic.TextBlockParam = { type: "text", text }
			const imageBlocks: Anthropic.ImageBlockParam[] = formatImagesIntoBlocks(images)
			// Placing images after text leads to better results
			return [textBlock, ...imageBlocks]
		} else {
			return text
		}
	},

	imageBlocks: (images?: string[]): Anthropic.ImageBlockParam[] => {
		return formatImagesIntoBlocks(images)
	},

	formatFilesList: (
		absolutePath: string,
		files: string[],
		didHitLimit: boolean,
		rooIgnoreController: RooIgnoreController | undefined,
		showRooIgnoredFiles: boolean,
		rooProtectedController?: RooProtectedController,
	): string => {
		const sorted = files
			.map((file) => {
				// convert absolute path to relative path
				const relativePath = path.relative(absolutePath, file).toPosix()
				return file.endsWith("/") ? relativePath + "/" : relativePath
			})
			// Sort so files are listed under their respective directories to make it clear what files are children of what directories. Since we build file list top down, even if file list is truncated it will show directories that cline can then explore further.
			.sort((a, b) => {
				const aParts = a.split("/") // only works if we use toPosix first
				const bParts = b.split("/")
				for (let i = 0; i < Math.min(aParts.length, bParts.length); i++) {
					if (aParts[i] !== bParts[i]) {
						// If one is a directory and the other isn't at this level, sort the directory first
						if (i + 1 === aParts.length && i + 1 < bParts.length) {
							return -1
						}
						if (i + 1 === bParts.length && i + 1 < aParts.length) {
							return 1
						}
						// Otherwise, sort alphabetically
						return aParts[i].localeCompare(bParts[i], undefined, { numeric: true, sensitivity: "base" })
					}
				}
				// If all parts are the same up to the length of the shorter path,
				// the shorter one comes first
				return aParts.length - bParts.length
			})

		let rooIgnoreParsed: string[] = sorted

		if (rooIgnoreController) {
			rooIgnoreParsed = []
			for (const filePath of sorted) {
				// path is relative to absolute path, not cwd
				// validateAccess expects either path relative to cwd or absolute path
				// otherwise, for validating against ignore patterns like "assets/icons", we would end up with just "icons", which would result in the path not being ignored.
				const absoluteFilePath = path.resolve(absolutePath, filePath)
				const isIgnored = !rooIgnoreController.validateAccess(absoluteFilePath)

				if (isIgnored) {
					// If file is ignored and we're not showing ignored files, skip it
					if (!showRooIgnoredFiles) {
						continue
					}
					// Otherwise, mark it with a lock symbol
					rooIgnoreParsed.push(LOCK_TEXT_SYMBOL + " " + filePath)
				} else {
					// Check if file is write-protected (only for non-ignored files)
					const isWriteProtected = rooProtectedController?.isWriteProtected(absoluteFilePath) || false
					if (isWriteProtected) {
						rooIgnoreParsed.push("🛡️ " + filePath)
					} else {
						rooIgnoreParsed.push(filePath)
					}
				}
			}
		}

		// kilocode_change start: Append character count to each file in the list
		rooIgnoreParsed = rooIgnoreParsed.map((entry) => {
			// Extract actual path by removing prefix symbols
			let actualPath = entry
			if (entry.startsWith(LOCK_TEXT_SYMBOL)) {
				actualPath = entry.slice((LOCK_TEXT_SYMBOL + " ").length)
			} else if (entry.startsWith("🛡️")) {
				actualPath = entry.slice("🛡️ ".length)
			}

			// Skip directories (end with /)
			if (actualPath.endsWith("/")) {
				return entry
			}

			// Read file and get character count
			try {
				const absoluteFilePath = path.resolve(absolutePath, actualPath)
				const content = fs.readFileSync(absoluteFilePath, "utf-8")
				return `${entry}  # ${content.length} chars`
			} catch {
				// If reading fails, return original entry
				return entry
			}
		})
		// kilocode_change end

		if (didHitLimit) {
			return `${rooIgnoreParsed.join(
				"\n",
			)}\n\n(File list truncated. Use list_files on specific subdirectories if you need to explore further.)`
		} else if (rooIgnoreParsed.length === 0 || (rooIgnoreParsed.length === 1 && rooIgnoreParsed[0] === "")) {
			return "No files found."
		} else {
			return rooIgnoreParsed.join("\n")
		}
	},

	createPrettyPatch: (filename = "file", oldStr?: string, newStr?: string) => {
		// strings cannot be undefined or diff throws exception
		const patch = diff.createPatch(filename.toPosix(), oldStr || "", newStr || "", undefined, undefined, {
			context: 3,
		})
		const lines = patch.split("\n")
		const prettyPatchLines = lines.slice(4)
		return prettyPatchLines.join("\n")
	},
}

// to avoid circular dependency
const formatImagesIntoBlocks = (images?: string[]): Anthropic.ImageBlockParam[] => {
	return images
		? images.map((dataUrl) => {
				// data:image/png;base64,base64string
				const [rest, base64] = dataUrl.split(",")
				const mimeType = rest.split(":")[1].split(";")[0]
				return {
					type: "image",
					source: { type: "base64", media_type: mimeType, data: base64 },
				} as Anthropic.ImageBlockParam
			})
		: []
}

const toolUseInstructionsReminder = `# Reminder: Instructions for Tool Use

Tool uses are formatted using XML-style tags. The tool name itself becomes the XML tag name. Each parameter is enclosed within its own set of tags. Here's the structure:

<actual_tool_name>
<parameter1_name>value1</parameter1_name>
<parameter2_name>value2</parameter2_name>
...
</actual_tool_name>

For example, to use the attempt_completion tool:

<attempt_completion>
<result>
I have completed the task...
</result>
</attempt_completion>

Always use the actual tool name as the XML tag name for proper parsing and execution.`

const toolUseInstructionsReminderNative = `# Reminder: Instructions for Tool Use

Tools are invoked using the platform's native tool calling mechanism. Each tool requires specific parameters as defined in the tool descriptions. Refer to the tool definitions provided in your system instructions for the correct parameter structure and usage examples.

Always ensure you provide all required parameters for the tool you wish to use.`

/**
 * Gets the appropriate tool use instructions reminder based on the protocol.
 *
 * @param protocol - Optional tool protocol, defaults to XML if not provided
 * @returns The tool use instructions reminder text
 */
function getToolInstructionsReminder(protocol?: ToolProtocol): string {
	const effectiveProtocol = protocol ?? TOOL_PROTOCOL.XML
	return isNativeProtocol(effectiveProtocol) ? toolUseInstructionsReminderNative : toolUseInstructionsReminder
}

import * as fs from "fs"
import { ImageBlockParam, Base64ImageSource } from "@anthropic-ai/sdk/resources/messages"
import * as path from "path"

import { Task } from "../task/Task"
import { ClineSayTool } from "../../shared/ExtensionMessage"
import { getReadablePath, getWorkspacePath } from "../../utils/path"
import { isPathOutsideWorkspace } from "../../utils/pathUtils"
import { ToolUse, AskApproval, HandleError, PushToolResult, RemoveClosingTag } from "../../shared/tools"

/**
 * A map of supported image file extensions to their corresponding MIME types.
 */
const SUPPORTED_MIME_TYPES: { [key: string]: Base64ImageSource["media_type"] } = {
	".png": "image/png",
	".jpeg": "image/jpeg",
	".jpg": "image/jpeg",
	".webp": "image/webp",
	".gif": "image/gif",
}

export async function readMediaTool(
	cline: Task,
	block: ToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag,
) {
	const realPath: string | undefined = block.params.path
	const absolutePath = realPath ? path.resolve(cline.cwd, realPath) : cline.cwd
	const isOutsideWorkspace = isPathOutsideWorkspace(absolutePath)

	const sharedMessageProps: ClineSayTool = {
		tool: "readMedia",
		path: getReadablePath(cline.cwd, removeClosingTag("path", realPath)),
		isOutsideWorkspace,
	}

	try {
		if (!realPath) {
			cline.consecutiveMistakeCount++
			cline.recordToolError("read_media")
			pushToolResult(await cline.sayAndCreateMissingParamError("read_media", "path"))
			return
		}

		const contentForApproval = `Image loaded from:\n${getReadablePath(cline.cwd, realPath)}`
		const completeMessage = JSON.stringify({
			...sharedMessageProps,
			content: contentForApproval,
		} satisfies ClineSayTool)
		const didApprove = await askApproval("tool", completeMessage)
		if (!didApprove) {
			pushToolResult(`<file><path>${realPath}</path><status>Denied by user</status></file>`)
			return
		}

		cline.consecutiveMistakeCount = 0

		if (!fs.existsSync(absolutePath)) {
			throw new Error(`File not found at path: ${absolutePath}`)
		}

		const extension = path.extname(absolutePath).toLowerCase()
		const mediaType = SUPPORTED_MIME_TYPES[extension]

		if (!mediaType) {
			const supportedExtensions = Object.keys(SUPPORTED_MIME_TYPES).join(", ")
			throw new Error(`Unsupported file type. Supported extensions are: ${supportedExtensions}`)
		}

		const fileBuffer = await fs.promises.readFile(absolutePath)
		const base64Data = fileBuffer.toString("base64")

		const imageBlock: ImageBlockParam = {
			type: "image",
			source: {
				type: "base64",
				media_type: mediaType as (typeof SUPPORTED_MIME_TYPES)[string],
				data: base64Data,
			},
		}
		pushToolResult([imageBlock])
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error)
		const errorXml = `<file><path>${realPath}</path><error>Error reading file: ${errorMsg}</error></file>`
		const filesXml = `<files>\n${errorXml}\n</files>`
		pushToolResult(filesXml)
		await handleError("reading media", error)
	}
}

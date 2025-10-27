import { Task } from "../task/Task"

const SIZE_LIMIT_AS_CONTEXT_WINDOW_FRACTION = 0.8

async function allowVeryLargeReads(task: Task) {
	return (await task.providerRef.deref()?.getState())?.allowVeryLargeReads ?? false
}

async function getTokenEstimate(task: Task, outputText: string) {
	return await task.api.countTokens([{ type: "text", text: outputText }])
}

function getTokenLimit(task: Task) {
	return SIZE_LIMIT_AS_CONTEXT_WINDOW_FRACTION * task.api.getModel().info.contextWindow
}

export async function summarizeSuccessfulMcpOutputWhenTooLong(task: Task, outputText: string) {
	if (await allowVeryLargeReads(task)) {
		return outputText
	}
	const tokenLimit = getTokenLimit(task)
	const tokenEstimate = await getTokenEstimate(task, outputText)
	if (tokenEstimate < tokenLimit) {
		return outputText
	}
	return (
		`The MCP tool executed successfully, but the output is unavailable, ` +
		`because it is too long (${tokenEstimate} estimated tokens, limit is ${tokenLimit} tokens). ` +
		`If you need the output, find an alternative way to get it in manageable chunks.`
	)
}

export async function blockFileReadWhenTooLarge(task: Task, relPath: string, content: string) {
	if (await allowVeryLargeReads(task)) {
		return undefined
	}
	const tokenLimit = getTokenLimit(task)
	const tokenEstimate = await getTokenEstimate(task, content)
	if (tokenEstimate < tokenLimit) {
		return undefined
	}
	const linesRangesAreAllowed = ((await task.providerRef.deref()?.getState())?.maxReadFileLine ?? 0) >= 0
	const errorMsg =
		`File content exceeds token limit (${tokenEstimate} estimated tokens, limit is ${tokenLimit} tokens).` +
		(linesRangesAreAllowed ? ` Please use line_range to read smaller sections.` : ``)
	return {
		status: "blocked" as const,
		error: errorMsg,
		xmlContent: `<file><path>${relPath}</path><error>${errorMsg}</error></file>`,
	}
}

type FileEntry = {
	path?: string
	lineRanges?: {
		start: number
		end: number
	}[]
}

export function parseNativeFiles(nativeFiles: { path?: string; line_ranges?: string[] }[]) {
	const fileEntries = new Array<FileEntry>()
	for (const file of nativeFiles) {
		if (!file.path) continue

		const fileEntry: FileEntry = {
			path: file.path,
			lineRanges: [],
		}

		// Handle line_ranges array from native format
		if (file.line_ranges && Array.isArray(file.line_ranges)) {
			for (const range of file.line_ranges) {
				const match = String(range).match(/(\d+)-(\d+)/)
				if (match) {
					const [, start, end] = match.map(Number)
					if (!isNaN(start) && !isNaN(end)) {
						fileEntry.lineRanges?.push({ start, end })
					}
				}
			}
		}
		fileEntries.push(fileEntry)
	}
	return fileEntries
}

export function getNativeReadFileToolDescription(blockName: string, files: FileEntry[]) {
	const paths = files.map((file) => file.path)
	if (paths.length === 0) {
		return `[${blockName} with no valid paths]`
	} else if (paths.length === 1) {
		// Modified part for single file
		return `[${blockName} for '${paths[0]}'. Reading multiple files at once is more efficient for the LLM. If other files are relevant to your current task, please read them simultaneously.]`
	} else if (paths.length <= 3) {
		const pathList = paths.map((p) => `'${p}'`).join(", ")
		return `[${blockName} for ${pathList}]`
	} else {
		return `[${blockName} for ${paths.length} files]`
	}
}

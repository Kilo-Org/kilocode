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

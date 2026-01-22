import { Anthropic } from "@anthropic-ai/sdk"
import { parseMentions, ParseMentionsResult } from "./index"
import { UrlContentFetcher } from "../../services/browser/UrlContentFetcher"
import { FileContextTracker } from "../context-tracking/FileContextTracker"

export interface ProcessUserContentMentionsResult {
	content: Anthropic.Messages.ContentBlockParam[]
	mode?: string // Mode from the first slash command that has one
}

/**
 * Process mentions in user content, specifically within task and feedback tags
 */
export async function processUserContentMentions({
	userContent,
	cwd,
	urlContentFetcher,
	fileContextTracker,
	rooIgnoreController,
	showRooIgnoredFiles = false,
	includeDiagnosticMessages = true,
	maxDiagnosticMessages = 50,
	maxReadFileLine,
}: {
	userContent: Anthropic.Messages.ContentBlockParam[]
	cwd: string
	urlContentFetcher: UrlContentFetcher
	fileContextTracker: FileContextTracker
	rooIgnoreController?: any
	showRooIgnoredFiles?: boolean
	includeDiagnosticMessages?: boolean
	maxDiagnosticMessages?: number
	maxReadFileLine?: number
}): Promise<ProcessUserContentMentionsResult> {
	// Track the first mode found from slash commands
	let commandMode: string | undefined

	// Process userContent array, which contains various block types:
	// TextBlockParam, ImageBlockParam, ToolUseBlockParam, and ToolResultBlockParam.
	// We need to apply parseMentions() to:
	// 1. All TextBlockParam's text (first user message with task)
	// 2. ToolResultBlockParam's content/context text arrays if it contains
	// "<feedback>" (see formatToolDeniedFeedback, attemptCompletion,
	// executeCommand, and consecutiveMistakeCount >= 3) or "<answer>"
	// (see askFollowupQuestion), we place all user generated content in
	// these tags so they can effectively be used as markers for when we
	// should parse mentions).
	const content = await Promise.all(
		userContent.map(async (block) => {
			const shouldProcessMentions = (text: string) =>
				text.includes("<task>") ||
				text.includes("<feedback>") ||
				text.includes("<answer>") ||
				text.includes("<user_message>")

			if (block.type === "text") {
				if (shouldProcessMentions(block.text)) {
					const result = await parseMentions(
						block.text,
						cwd,
						urlContentFetcher,
						fileContextTracker,
						rooIgnoreController,
						showRooIgnoredFiles,
						includeDiagnosticMessages,
						maxDiagnosticMessages,
						maxReadFileLine,
					)
					// Capture the first mode found
					if (!commandMode && result.mode) {
						commandMode = result.mode
					}
					return {
						...block,
						text: result.text,
					}
				}

				return block
			} else if (block.type === "tool_result") {
				if (typeof block.content === "string") {
					if (shouldProcessMentions(block.content)) {
						const result = await parseMentions(
							block.content,
							cwd,
							urlContentFetcher,
							fileContextTracker,
							rooIgnoreController,
							showRooIgnoredFiles,
							includeDiagnosticMessages,
							maxDiagnosticMessages,
							maxReadFileLine,
						)
						// Capture the first mode found
						if (!commandMode && result.mode) {
							commandMode = result.mode
						}
						return {
							...block,
							content: result.text,
						}
					}

					return block
				} else if (Array.isArray(block.content)) {
					const parsedContent = await Promise.all(
						block.content.map(async (contentBlock) => {
							if (contentBlock.type === "text" && shouldProcessMentions(contentBlock.text)) {
								const result = await parseMentions(
									contentBlock.text,
									cwd,
									urlContentFetcher,
									fileContextTracker,
									rooIgnoreController,
									showRooIgnoredFiles,
									includeDiagnosticMessages,
									maxDiagnosticMessages,
									maxReadFileLine,
								)
								// Capture the first mode found
								if (!commandMode && result.mode) {
									commandMode = result.mode
								}
								return {
									...contentBlock,
									text: result.text,
								}
							}

							return contentBlock
						}),
					)

					return { ...block, content: parsedContent }
				}

				return block
			}

			return block
		}),
	)

	return { content, mode: commandMode }
}

import { Anthropic } from "@anthropic-ai/sdk"
import { parseMentions } from "./index"
import { UrlContentFetcher } from "../../services/browser/UrlContentFetcher"
import { FileContextTracker } from "../context-tracking/FileContextTracker"

// kilocode_change begin
import { parseSlashCommands } from "../slash-commands"
// kilocode_change end

/**
 * Process mentions in user content, specifically within task and feedback tags
 */
export async function processUserContentMentions({
	userContent,
	cwd,
	urlContentFetcher,
	fileContextTracker,
	rooIgnoreController,
	showRooIgnoredFiles = true,
}: {
	userContent: Anthropic.Messages.ContentBlockParam[]
	cwd: string
	urlContentFetcher: UrlContentFetcher
	fileContextTracker: FileContextTracker
	rooIgnoreController?: any
	showRooIgnoredFiles?: boolean
}) {
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
	return Promise.all(
		userContent.map(async (block) => {
			const shouldProcessMentions = (text: string) => text.includes("<task>") || text.includes("<feedback>")

			if (block.type === "text") {
				if (shouldProcessMentions(block.text)) {
					// kilocode_change begin: pull slash commands from Cline
					let parsedText = await parseMentions(block.text, cwd, urlContentFetcher, fileContextTracker)

					// when parsing slash commands, we still want to allow the user to provide their desired context
					parsedText = parseSlashCommands(parsedText)

					return {
						...block,
						text: parsedText,
					}
					// kilocode_change end
				}

				return block
			} else if (block.type === "tool_result") {
				if (typeof block.content === "string") {
					if (shouldProcessMentions(block.content)) {
						return {
							...block,
							content: await parseMentions(
								block.content,
								cwd,
								urlContentFetcher,
								fileContextTracker,
								rooIgnoreController,
								showRooIgnoredFiles,
							),
						}
					}

					return block
				} else if (Array.isArray(block.content)) {
					const parsedContent = await Promise.all(
						block.content.map(async (contentBlock) => {
							if (contentBlock.type === "text" && shouldProcessMentions(contentBlock.text)) {
								return {
									...contentBlock,
									text: await parseMentions(
										contentBlock.text,
										cwd,
										urlContentFetcher,
										fileContextTracker,
										rooIgnoreController,
										showRooIgnoredFiles,
									),
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
}

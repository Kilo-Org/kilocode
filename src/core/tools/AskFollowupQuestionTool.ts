import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { parseXml } from "../../utils/xml"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"

interface Suggestion {
	text: string
	mode?: string
}

interface AskFollowupQuestionParams {
	question: string
	follow_up: Suggestion[]
}

export class AskFollowupQuestionTool extends BaseTool<"ask_followup_question"> {
	readonly name = "ask_followup_question" as const

	parseLegacy(params: Partial<Record<string, string>>): AskFollowupQuestionParams {
		const question = params.question || ""
		const follow_up_xml = params.follow_up

		const suggestions: Suggestion[] = []

		if (follow_up_xml) {
			// Define the actual structure returned by the XML parser
			type ParsedSuggestion = string | { "#text": string; "@_mode"?: string }

			try {
				const parsedSuggest = parseXml(follow_up_xml, ["suggest"]) as {
					suggest: ParsedSuggestion[] | ParsedSuggestion
				}

				const rawSuggestions = Array.isArray(parsedSuggest?.suggest)
					? parsedSuggest.suggest
					: [parsedSuggest?.suggest].filter((sug): sug is ParsedSuggestion => sug !== undefined)

				// Transform parsed XML to our Suggest format
				for (const sug of rawSuggestions) {
					if (typeof sug === "string") {
						// Simple string suggestion (no mode attribute)
						suggestions.push({ text: sug })
					} else {
						// XML object with text content and optional mode attribute
						const suggestion: Suggestion = { text: sug["#text"] }
						if (sug["@_mode"]) {
							suggestion.mode = sug["@_mode"]
						}
						suggestions.push(suggestion)
					}
				}
			} catch (error) {
				throw new Error(
					`Failed to parse follow_up XML: ${error instanceof Error ? error.message : String(error)}`,
				)
			}
		}

		return {
			question,
			follow_up: suggestions,
		}
	}

	async execute(params: AskFollowupQuestionParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { question, follow_up } = params
		const { handleError, pushToolResult, toolProtocol } = callbacks

		try {
			if (!question) {
				task.consecutiveMistakeCount++
				task.recordToolError("ask_followup_question")
				task.didToolFailInCurrentTurn = true
				pushToolResult(await task.sayAndCreateMissingParamError("ask_followup_question", "question"))
				return
			}

			// Transform follow_up suggestions to the format expected by task.ask
			const follow_up_json = {
				question,
				suggest: follow_up.map((s) => ({ answer: s.text, mode: s.mode })),
			}

			task.consecutiveMistakeCount = 0
			const { text, images } = await task.ask("followup", JSON.stringify(follow_up_json), false)
			await task.say("user_feedback", text ?? "", images)
			pushToolResult(formatResponse.toolResult(`<answer>\n${text}\n</answer>`, images))
		} catch (error) {
			await handleError("asking question", error as Error)
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"ask_followup_question">): Promise<void> {
		// Get question from params (for XML protocol) or nativeArgs (for native protocol)
		const question: string | undefined = block.params.question ?? block.nativeArgs?.question

		// During partial streaming, only show the question to avoid displaying raw JSON
		// The full JSON with suggestions will be sent when the tool call is complete (!block.partial)
		await task
			.ask("followup", this.removeClosingTag("question", question, block.partial), block.partial)
			.catch(() => {})
	}
}

export const askFollowupQuestionTool = new AskFollowupQuestionTool()

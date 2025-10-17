import { HelperVars } from "../../autocomplete/util/HelperVars.js"
import { NEXT_EDIT_MODELS } from "../../llm/constants.js"
import { MERCURY_SYSTEM_PROMPT, UNIQUE_TOKEN } from "../constants.js"
import {
	currentFileContentBlock,
	editHistoryBlock,
	recentlyViewedCodeSnippetsBlock,
} from "../templating/mercuryCoderNextEdit.js"
import { NEXT_EDIT_MODEL_TEMPLATES } from "../templating/NextEditPromptEngine.js"
import { ModelSpecificContext, Prompt, PromptMetadata } from "../types.js"
import { BaseNextEditModelProvider } from "./BaseNextEditProvider.js"
import { NextEditTemplateRenderer } from "./InstinctNextEditProvider.js"

export class MercuryCoderProvider extends BaseNextEditModelProvider {
	private templateRenderer: NextEditTemplateRenderer

	constructor() {
		super(NEXT_EDIT_MODELS.MERCURY_CODER)

		this.templateRenderer = NEXT_EDIT_MODEL_TEMPLATES[NEXT_EDIT_MODELS.MERCURY_CODER]
	}

	getSystemPrompt(): string {
		return MERCURY_SYSTEM_PROMPT
	}

	getWindowSize() {
		return { topMargin: 0, bottomMargin: 5 }
	}

	override shouldInjectUniqueToken(): boolean {
		return true
	}

	override getUniqueToken(): string {
		return UNIQUE_TOKEN
	}

	extractCompletion(message: string): string {
		// Extract the code between the markdown code blocks.
		return message.slice(message.indexOf("```\n") + "```\n".length, message.lastIndexOf("\n\n```"))
	}

	buildPromptContext(context: ModelSpecificContext) {
		return {
			recentlyViewedCodeSnippets:
				context.snippetPayload.recentlyVisitedRangesSnippets.map((snip) => ({
					filepath: snip.filepath,
					content: snip.content,
				})) ?? [],
			currentFileContent: context.helper.fileContents,
			editableRegionStartLine: context.editableRegionStartLine,
			editableRegionEndLine: context.editableRegionEndLine,
			editDiffHistory: context.diffContext,
			currentFilePath: context.helper.filepath,
			languageShorthand: context.helper.lang.name,
		}
	}

	async generatePrompts(context: ModelSpecificContext): Promise<Prompt[]> {
		const promptCtx = this.buildPromptContext(context)

		const templateVars = {
			recentlyViewedCodeSnippets: recentlyViewedCodeSnippetsBlock(promptCtx.recentlyViewedCodeSnippets),
			currentFileContent: currentFileContentBlock(
				promptCtx.currentFileContent,
				promptCtx.editableRegionStartLine,
				promptCtx.editableRegionEndLine,
				context.helper.pos,
			),
			editDiffHistory: editHistoryBlock(promptCtx.editDiffHistory),
			currentFilePath: promptCtx.currentFilePath,
			languageShorthand: promptCtx.languageShorthand,
		}

		const userPromptContent = this.templateRenderer(templateVars)

		return [
			{
				role: "system",
				content: this.getSystemPrompt(),
			},
			{
				role: "user",
				content: userPromptContent,
			},
		]
	}

	buildPromptMetadata(context: ModelSpecificContext): PromptMetadata {
		const promptCtx = this.buildPromptContext(context)

		const templateVars = {
			recentlyViewedCodeSnippets: recentlyViewedCodeSnippetsBlock(promptCtx.recentlyViewedCodeSnippets),
			currentFileContent: currentFileContentBlock(
				promptCtx.currentFileContent,
				promptCtx.editableRegionStartLine,
				promptCtx.editableRegionEndLine,
				context.helper.pos,
			),
			editDiffHistory: editHistoryBlock(promptCtx.editDiffHistory),
			currentFilePath: promptCtx.currentFilePath,
			languageShorthand: promptCtx.languageShorthand,
		}

		const userPromptContent = this.templateRenderer(templateVars)

		return {
			prompt: {
				role: "user",
				content: userPromptContent,
			},
			userEdits: promptCtx.editDiffHistory.join("\n"),
			userExcerpts: templateVars.currentFileContent,
		}
	}

	calculateEditableRegion(
		helper: HelperVars,
		usingFullFileDiff: boolean,
	): {
		editableRegionStartLine: number
		editableRegionEndLine: number
	} {
		if (usingFullFileDiff) {
			return this.calculateOptimalEditableRegion(helper, 512, "tokenizer")
		} else {
			const { topMargin, bottomMargin } = this.getWindowSize()
			return {
				editableRegionStartLine: Math.max(helper.pos.line - topMargin, 0),
				editableRegionEndLine: Math.min(helper.pos.line + bottomMargin, helper.fileLines.length - 1),
			}
		}
	}
}

import {
	AutocompleteInput,
	AutocompleteContextProvider,
	HoleFillerAutocompletePrompt,
	FillInAtCursorSuggestion,
	ChatCompletionResult,
} from "../types"
import { getProcessedSnippets } from "./getProcessedSnippets"
import { formatSnippets } from "../continuedev/core/autocomplete/templating/formatting"
import { AutocompleteModel } from "../AutocompleteModel"
import { ApiStreamChunk } from "../../../api/transform/stream"

export type { HoleFillerAutocompletePrompt, FillInAtCursorSuggestion, ChatCompletionResult }

/**
 * Parse the response - only handles responses with <COMPLETION> tags
 * Returns a FillInAtCursorSuggestion with the extracted text, or an empty string if nothing found
 */
export function parseAutocompleteResponse(fullResponse: string, prefix: string, suffix: string): FillInAtCursorSuggestion {
	let fimText: string = ""

	// Match content strictly between <COMPLETION> and </COMPLETION> tags
	const completionMatch = fullResponse.match(/<COMPLETION>([\s\S]*?)<\/COMPLETION>/i)

	if (completionMatch) {
		// Extract the captured group (content between tags)
		fimText = completionMatch[1] || ""
	}
	// Remove any accidentally captured tag remnants
	fimText = fimText.replace(/<\/?COMPLETION>/gi, "")

	// Return FillInAtCursorSuggestion with the text (empty string if nothing found)
	return {
		text: fimText,
		prefix,
		suffix,
	}
}

export class HoleFiller {
	constructor(private contextProvider: AutocompleteContextProvider) {}

	async getPrompts(autocompleteInput: AutocompleteInput, languageId: string): Promise<HoleFillerAutocompletePrompt> {
		return {
			strategy: "hole_filler",
			systemPrompt: this.getSystemInstructions(),
			userPrompt: await this.getUserPrompt(autocompleteInput, languageId),
			autocompleteInput,
		}
	}

	getSystemInstructions(): string {
		return `You are a HOLE FILLER. You are provided with a file containing holes, formatted as '{{FILL_HERE}}'. Your TASK is to complete with a string to replace this hole with, inside a <COMPLETION/> XML tag, including context-aware indentation, if needed. All completions MUST be truthful, accurate, well-written and correct.

## CRITICAL RULES
- NEVER repeat or duplicate content that appears immediately before {{FILL_HERE}}
- If {{FILL_HERE}} is at the end of a comment line, start your completion with a newline and new code
- Maintain proper indentation matching the surrounding code

## Context Format
<LANGUAGE>: file language
<QUERY>: contains commented reference code (// Path: file.ts) followed by code with {{FILL_HERE}}
Comments provide context from related files, recent edits, imports, etc.

## EXAMPLE QUERY:

<QUERY>
function sum_evens(lim) {
  var sum = 0;
  for (var i = 0; i < lim; ++i) {
    {{FILL_HERE}}
  }
  return sum;
}
</QUERY>

TASK: Fill the {{FILL_HERE}} hole.

## CORRECT COMPLETION

<COMPLETION>if (i % 2 === 0) {
      sum += i;
    }</COMPLETION>

## EXAMPLE QUERY:

<QUERY>
def sum_list(lst):
  total = 0
  for x in lst:
  {{FILL_HERE}}
  return total

print sum_list([1, 2, 3])
</QUERY>

## CORRECT COMPLETION:

<COMPLETION>  total += x</COMPLETION>

## EXAMPLE QUERY:

<QUERY>
// data Tree a = Node (Tree a) (Tree a) | Leaf a

// sum :: Tree Int -> Int
// sum (Node lft rgt) = sum lft + sum rgt
// sum (Leaf val)     = val

// convert to TypeScript:
{{FILL_HERE}}
</QUERY>

## CORRECT COMPLETION:

<COMPLETION>type Tree<T>
  = {$:"Node", lft: Tree<T>, rgt: Tree<T>}
  | {$:"Leaf", val: T};

function sum(tree: Tree<number>): number {
  switch (tree.$) {
    case "Node":
      return sum(tree.lft) + sum(tree.rgt);
    case "Leaf":
      return tree.val;
  }
}</COMPLETION>

## EXAMPLE QUERY:

The 5th {{FILL_HERE}} is Jupiter.

## CORRECT COMPLETION:

<COMPLETION>planet from the Sun</COMPLETION>

## EXAMPLE QUERY:

function hypothenuse(a, b) {
  return Math.sqrt({{FILL_HERE}}b ** 2);
}

## CORRECT COMPLETION:

<COMPLETION>a ** 2 + </COMPLETION>

Task: Auto-Completion
Provide a subtle, non-intrusive completion after a typing pause.

`
	}

	/**
	 * Build minimal prompt for auto-trigger with optional context
	 */
	async getUserPrompt(autocompleteInput: AutocompleteInput, languageId: string): Promise<string> {
		const { helper, snippetsWithUris, workspaceDirs } = await getProcessedSnippets(
			autocompleteInput,
			autocompleteInput.filepath,
			this.contextProvider.contextService,
			this.contextProvider.model,
			this.contextProvider.ide,
			this.contextProvider.ignoreController,
		)
		const formattedContext = formatSnippets(helper, snippetsWithUris, workspaceDirs)
		// Use pruned prefix/suffix from HelperVars (token-limited based on DEFAULT_AUTOCOMPLETE_OPTS)
		return (
			`<LANGUAGE>${languageId}</LANGUAGE>\n\n` +
			`<QUERY>
${formattedContext}${formattedContext ? "\n" : ""}${helper.prunedPrefix}{{FILL_HERE}}${helper.prunedSuffix}
</QUERY>

TASK: Fill the {{FILL_HERE}} hole. Answer only with the CORRECT completion, and NOTHING ELSE. Do it now.
Return the COMPLETION tags`
		)
	}

	/**
	 * Execute chat-based completion using the model
	 */
	async getFromChat(
		model: AutocompleteModel,
		prompt: HoleFillerAutocompletePrompt,
		processSuggestion: (text: string) => FillInAtCursorSuggestion,
	): Promise<ChatCompletionResult> {
		const { systemPrompt, userPrompt } = prompt
		let response = ""

		const onChunk = (chunk: ApiStreamChunk) => {
			if (chunk.type === "text") {
				response += chunk.text
			}
		}

		console.log("[HoleFiller] userPrompt:", userPrompt)

		const usageInfo = await model.generateResponse(systemPrompt, userPrompt, onChunk)

		console.log("response", response)

		// Extract just the text from the response - prefix/suffix are handled by the caller
		const completionMatch = response.match(/<COMPLETION>([\s\S]*?)<\/COMPLETION>/i)
		const suggestionText = completionMatch ? (completionMatch[1] || "").replace(/<\/?COMPLETION>/gi, "") : ""

		const fillInAtCursorSuggestion = processSuggestion(suggestionText)

		if (fillInAtCursorSuggestion.text) {
			console.info("Final suggestion:", fillInAtCursorSuggestion)
		}

		return {
			suggestion: fillInAtCursorSuggestion,
			cost: usageInfo.cost,
			inputTokens: usageInfo.inputTokens,
			outputTokens: usageInfo.outputTokens,
			cacheWriteTokens: usageInfo.cacheWriteTokens,
			cacheReadTokens: usageInfo.cacheReadTokens,
		}
	}
}

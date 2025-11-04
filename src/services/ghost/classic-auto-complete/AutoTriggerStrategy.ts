import { AutocompleteInput } from "../types"
import { CURSOR_MARKER } from "./ghostConstants"
import type { TextDocument, Range } from "vscode"

export function getBaseSystemInstructions(): string {
	return `You are a HOLE FILLER. You are provided with a file containing holes, formatted as '{{FILL_HERE}}'. Your TASK is to complete with a string to replace this hole with, inside a <COMPLETION/> XML tag, including context-aware indentation, if needed. All completions MUST be truthful, accurate, well-written and correct.

## Context Tags
<LANGUAGE>: file language | <RECENT_EDITS>: recent changes | <QUERY>: code with {{FILL_HERE}}

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

`
}

export function addCursorMarker(document: TextDocument, range?: Range): string {
	if (!range) return document.getText()

	const fullText = document.getText()
	const cursorOffset = document.offsetAt(range.start)
	const beforeCursor = fullText.substring(0, cursorOffset)
	const afterCursor = fullText.substring(cursorOffset)

	return `${beforeCursor}${CURSOR_MARKER}${afterCursor}`
}

export class AutoTriggerStrategy {
	getPrompts(
		autocompleteInput: AutocompleteInput,
		prefix: string,
		suffix: string,
		languageId: string,
	): {
		systemPrompt: string
		userPrompt: string
	} {
		return {
			systemPrompt: this.getSystemInstructions(),
			userPrompt: this.getUserPrompt(autocompleteInput, prefix, suffix, languageId),
		}
	}

	getSystemInstructions(): string {
		return (
			getBaseSystemInstructions() +
			`Task: Auto-Completion
Provide a subtle, non-intrusive completion after a typing pause.

`
		)
	}

	/**
	 * Build minimal prompt for auto-trigger
	 */
	getUserPrompt(autocompleteInput: AutocompleteInput, prefix: string, suffix: string, languageId: string): string {
		let prompt = `<LANGUAGE>${languageId}</LANGUAGE>\n\n`

		if (autocompleteInput.recentlyEditedRanges && autocompleteInput.recentlyEditedRanges.length > 0) {
			prompt += "<RECENT_EDITS>\n"
			autocompleteInput.recentlyEditedRanges.forEach((range, index) => {
				const description = `Edited ${range.filepath} at line ${range.range.start.line}`
				prompt += `${index + 1}. ${description}\n`
			})
			prompt += "</RECENT_EDITS>\n\n"
		}

		prompt += `<QUERY>
${prefix}{{FILL_HERE}}${suffix}
</QUERY>

TASK: Fill the {{FILL_HERE}} hole. Answer only with the CORRECT completion, and NOTHING ELSE. Do it now.
Return the COMPLETION tags`

		return prompt
	}
}

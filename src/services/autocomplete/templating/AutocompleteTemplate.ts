// AIDIFF: Updated to align with continue/core/autocomplete/templating/AutocompleteTemplate.ts
// PLANREF: continue/core/autocomplete/templating/AutocompleteTemplate.ts
// Fill in the middle prompts

import * as vscode from "vscode"
import { CompletionOptions } from "../types"
import { AutocompleteSnippet, AutocompleteSnippetType } from "./snippetTypes"
import { CodeContext, CodeContextDefinition } from "../ContextGatherer"

// AIDIFF: Updated interface to match continue/
export interface AutocompleteTemplate {
	compilePrefixSuffix?: (prefix: string, suffix: string) => [string, string]
	getSystemPrompt: () => string
	template: (
		codeContext: CodeContext,
		document: vscode.TextDocument,
		position: vscode.Position,
		snippets: AutocompleteSnippet[],
	) => string
	completionOptions?: Partial<CompletionOptions>
}

// PLANREF: continue/core/autocomplete/templating/AutocompleteTemplate.ts (gptAutocompleteTemplate)
// const gptAutocompleteTemplate: AutocompleteTemplate = {
// 	template: `\`\`\`
// {{{prefix}}}[BLANK]{{{suffix}}}
// \`\`\`
//
// Fill in the blank to complete the code block. Your response should include only the code to replace [BLANK], without surrounding backticks.`,
// 	completionOptions: { stop: ["\n"] },
// }

// PLANREF: continue/core/autocomplete/templating/AutocompleteTemplate.ts (holeFillerTemplate)
export const holeFillerTemplate: AutocompleteTemplate = {
	getSystemPrompt: () => {
		// From https://github.com/VictorTaelin/AI-scripts
		const SYSTEM_MSG = `You are a HOLE FILLER. You are provided with a file containing holes, formatted as '{{HOLE_NAME}}'.
		Your TASK is to complete with a string to replace this hole with, inside a <COMPLETION/> XML tag, including context-aware indentation, if needed.
		All completions MUST be truthful, accurate, well-written and correct.
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
		return SYSTEM_MSG
	},
	template: (
		codeContext: CodeContext,
		document: vscode.TextDocument,
		position: vscode.Position,
		snippets: AutocompleteSnippet[],
	) => {
		const offset = document.offsetAt(position)
		const fileContent = document.getText()
		const currentFileWithFillPlaceholder =
			fileContent.slice(0, offset) + "{{FILL_HERE}}" + fileContent.slice(offset)

		const queryContextStrings: string[] = []

		const codeContextItems = codeContext.definitions
		if (codeContextItems && codeContextItems.length > 0) {
			// AIDIFF: Ensure item.name is correct, CodeContextDefinition has filepath
			const contextItemStrings = codeContextItems.map(
				(item: CodeContextDefinition) => `// File: ${item.filepath}\n${item.content}`,
			)
			queryContextStrings.push(`// Context from other parts of the project:\n${contextItemStrings.join("\n\n")}`)
		}

		if (snippets && snippets.length > 0) {
			const snippetStrings = snippets.map((snippet) => {
				let header = `// Some context: ${snippet.type})`
				if ("filepath" in snippet && (snippet as any).filepath) {
					header = `// Some context: ${snippet.type}) from: ${(snippet as any).filepath}`
				} else if (
					snippet.type === AutocompleteSnippetType.Clipboard &&
					"copiedAt" in snippet &&
					(snippet as any).copiedAt
				) {
					header = `// Some context: ${snippet.type}, copiedAt: ${(snippet as any).copiedAt})`
				}
				return `${header}\n${snippet.content}`
			})
			queryContextStrings.push(`// Relevant snippets:\n${snippetStrings.join("\n\n")}`)
		}

		// Add the current file with hole last, as it's the primary focus
		queryContextStrings.push(`// Current file content with hole:\n${currentFileWithFillPlaceholder}`)

		const queryContent = queryContextStrings.join("\n\n")

		const userPrompt = `\n\n<QUERY>\n${queryContent}\n</QUERY>\nTASK: Fill the {{FILL_HERE}} hole. Answer only with the CORRECT completion, and NOTHING ELSE. Do it now.\n<COMPLETION>`
		return userPrompt
	},
	completionOptions: {
		stop: ["</COMPLETION>"],
	},
}

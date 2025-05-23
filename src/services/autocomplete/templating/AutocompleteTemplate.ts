// AIDIFF: Updated to align with continue/core/autocomplete/templating/AutocompleteTemplate.ts
// PLANREF: continue/core/autocomplete/templating/AutocompleteTemplate.ts
// Fill in the middle prompts

import { CompletionOptions } from "../types.js"
import { getLastNUriRelativePathParts, getShortestUniqueRelativeUriPaths } from "./uri.js"
import { AutocompleteSnippet, AutocompleteCodeSnippet, AutocompleteSnippetType } from "./snippetTypes.js"

// AIDIFF: Updated interface to match continue/
export interface AutocompleteTemplate {
	compilePrefixSuffix?: (
		prefix: string,
		suffix: string,
		filepath: string,
		reponame: string,
		snippets: AutocompleteSnippet[], // AIDIFF: Added snippets
		workspaceUris: string[],
	) => [string, string]
	template:
		| string
		| ((
				prefix: string,
				suffix: string,
				filepath: string,
				reponame: string,
				language: string,
				snippets: AutocompleteSnippet[], // AIDIFF: Added snippets
				workspaceUris: string[],
		  ) => string)
	completionOptions?: Partial<CompletionOptions>
}

const endOfText = "<|end" + "of" + "text|>" // workaround for https://github.com/Kilo-Org/kilocode/issues/452

// PLANREF: continue/core/autocomplete/templating/AutocompleteTemplate.ts (stableCodeFimTemplate)
const stableCodeFimTemplate: AutocompleteTemplate = {
	template: "<fim_prefix>{{{prefix}}}<fim_suffix>{{{suffix}}}<fim_middle>",
	completionOptions: {
		stop: ["<fim_prefix>", "<fim_suffix>", "<fim_middle>", "<file_sep>", endOfText, "</fim_middle>", "</code>"],
	},
}

// PLANREF: continue/core/autocomplete/templating/AutocompleteTemplate.ts (qwenCoderFimTemplate)
const qwenCoderFimTemplate: AutocompleteTemplate = {
	template: "<|fim_prefix|>{{{prefix}}}<|fim_suffix|>{{{suffix}}}<|fim_middle|>",
	completionOptions: {
		stop: [
			endOfText,
			"<|fim_prefix|>",
			"<|fim_middle|>",
			"<|fim_suffix|>",
			"<|fim_pad|>",
			"<|repo_name|>",
			"<|file_sep|>",
			"<|im_start|>",
			"<|im_end|>",
		],
	},
}

// PLANREF: continue/core/autocomplete/templating/AutocompleteTemplate.ts (seedCoderFimTemplate)
const seedCoderFimTemplate: AutocompleteTemplate = {
	template: "<[fim-prefix]>{{{prefix}}}<[fim-suffix]>{{{suffix}}}<[fim-middle]>",
	completionOptions: {
		stop: [
			"<[end of sentence]>",
			"<[fim-prefix]>",
			"<[fim-middle]>",
			"<[fim-suffix]>",
			"<[PAD TOKEN]>",
			"<[SEP TOKEN]>",
			"<[begin of sentence]>",
		],
	},
}

// PLANREF: continue/core/autocomplete/templating/AutocompleteTemplate.ts (codestralFimTemplate)
// const codestralFimTemplate: AutocompleteTemplate = {
// 	template: "[SUFFIX]{{{suffix}}}[PREFIX]{{{prefix}}}",
// 	completionOptions: {
// 		stop: ["[PREFIX]", "[SUFFIX]"],
// 	},
// }

// PLANREF: continue/core/autocomplete/templating/AutocompleteTemplate.ts (codestralMultifileFimTemplate)
const codestralMultifileFimTemplate: AutocompleteTemplate = {
	compilePrefixSuffix: (
		prefix,
		suffix,
		filepath,
		reponame,
		snippets, // AIDIFF: Added snippets
		workspaceUris,
	): [string, string] => {
		// AIDIFF: Helper function from continue/
		function getFileName(snippet: { uri: string; uniquePath: string }) {
			return snippet.uri.startsWith("file://") ? snippet.uniquePath : snippet.uri
		}

		if (snippets.length === 0) {
			if (suffix.trim().length === 0 && prefix.trim().length === 0) {
				return [`+++++ ${getLastNUriRelativePathParts(workspaceUris, filepath, 2)}\n${prefix}`, suffix]
			}
			return [prefix, suffix]
		}

		// AIDIFF: Logic from continue/ for handling multiple files
		const relativePaths = getShortestUniqueRelativeUriPaths(
			[
				...snippets.map((snippet) =>
					"filepath" in snippet && snippet.filepath ? snippet.filepath : "file:///Untitled.txt",
				),
				filepath,
			],
			workspaceUris,
		)

		const otherFiles = snippets
			.map((snippet, i) => {
				if (snippet.type === AutocompleteSnippetType.Diff) {
					return snippet.content
				}
				return `+++++ ${getFileName(relativePaths[i])} \n${snippet.content}`
			})
			.join("\n\n")

		return [`${otherFiles}\n\n+++++ ${getFileName(relativePaths[relativePaths.length - 1])}\n${prefix}`, suffix]
	},
	template: (prefix: string, suffix: string): string => {
		return `[SUFFIX]${suffix}[PREFIX]${prefix}`
	},
	completionOptions: {
		stop: ["[PREFIX]", "[SUFFIX]", "\n+++++ "],
	},
}

// PLANREF: continue/core/autocomplete/templating/AutocompleteTemplate.ts (mercuryMultifileFimTemplate)
const mercuryMultifileFimTemplate: AutocompleteTemplate = {
	compilePrefixSuffix: (
		prefix,
		suffix,
		filepath,
		reponame,
		snippets, // AIDIFF: Added snippets
		workspaceUris,
	): [string, string] => {
		function getFileName(snippet: { uri: string; uniquePath: string }) {
			return snippet.uri.startsWith("file://") ? snippet.uniquePath : snippet.uri
		}

		// Our current snippet format doesn't work well with mercury. We need to clean this up
		// AIDIFF: Keep snippets for now, but acknowledge continue's comment
		// snippets = []; // Original line from continue/

		if (snippets.length === 0) {
			if (suffix.trim().length === 0 && prefix.trim().length === 0) {
				return [
					`<|file_sep|>${getLastNUriRelativePathParts(workspaceUris, filepath, 2)}\n<|fim_prefix|>${prefix}`,
					suffix,
				]
			}
			return [`<|fim_prefix|>${prefix}`, suffix]
		}

		const relativePaths = getShortestUniqueRelativeUriPaths(
			[
				...snippets.map((snippet) =>
					"filepath" in snippet && snippet.filepath ? snippet.filepath : "file:///Untitled.txt",
				),
				filepath,
			],
			workspaceUris,
		)

		const otherFiles = snippets
			.map((snippet, i) => {
				if (snippet.type === AutocompleteSnippetType.Diff) {
					return snippet.content
				}
				return `<|file_sep|>${getFileName(relativePaths[i])} \n${snippet.content}`
			})
			.join("\n\n")

		return [
			`${otherFiles}${otherFiles ? "\n\n" : ""}<|file_sep|>${getFileName(
				relativePaths[relativePaths.length - 1],
			)}\n<|fim_prefix|>${prefix}`,
			suffix,
		]
	},
	template: (prefix: string, suffix: string): string => {
		return `${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`
	},
	completionOptions: {
		stop: ["<|fim_suffix|>", "<|fim_middle|>", "<|file_sep|>"], // AIDIFF: Added common stop tokens
	},
}

// PLANREF: continue/core/autocomplete/templating/AutocompleteTemplate.ts (codegemmaFimTemplate)
const codegemmaFimTemplate: AutocompleteTemplate = {
	template: "<|fim_prefix|>{{{prefix}}}<|fim_suffix|>{{{suffix}}}<|fim_middle|>",
	completionOptions: {
		stop: ["<|fim_prefix|>", "<|fim_suffix|>", "<|fim_middle|>", "<|file_separator|>", "<end_of_turn>", "<eos>"],
	},
}

// PLANREF: continue/core/autocomplete/templating/AutocompleteTemplate.ts (starcoder2FimTemplate)
const starcoder2FimTemplate: AutocompleteTemplate = {
	template: (
		prefix,
		suffix,
		filename, // AIDIFF: Changed from filepath to filename for consistency with continue/
		reponame,
		language,
		snippets, // AIDIFF: Added snippets
		_workspaceUris, // AIDIFF: Marked as unused to satisfy linter
	): string => {
		const otherFiles =
			snippets.length === 0
				? ""
				: `<file_sep>${snippets
						.map((snippet) => {
							return snippet.content
						})
						.join("<file_sep>")}<file_sep>`

		const prompt = `${otherFiles}<fim_prefix>${prefix}<fim_suffix>${suffix}<fim_middle>`
		return prompt
	},
	completionOptions: {
		stop: ["<fim_prefix>", "<fim_suffix>", "<fim_middle>", "<file_sep>", endOfText],
	},
}

// PLANREF: continue/core/autocomplete/templating/AutocompleteTemplate.ts (codeLlamaFimTemplate)
const codeLlamaFimTemplate: AutocompleteTemplate = {
	template: "<PRE> {{{prefix}}} <SUF>{{{suffix}}} <MID>",
	completionOptions: { stop: ["<PRE>", "<SUF>", "<MID>", "<EOT>"] },
}

// PLANREF: continue/core/autocomplete/templating/AutocompleteTemplate.ts (deepseekFimTemplate)
const deepseekFimTemplate: AutocompleteTemplate = {
	template: "<｜fim begin｜>{{{prefix}}}<｜fim hole｜>{{{suffix}}}<｜fim end｜>",
	completionOptions: {
		stop: ["<｜fim begin｜>", "<｜fim hole｜>", "<｜fim end｜>", "//", "<｜end of sentence｜>"],
	},
}

// PLANREF: continue/core/autocomplete/templating/AutocompleteTemplate.ts (codegeexFimTemplate)
const codegeexFimTemplate: AutocompleteTemplate = {
	template: (
		prefix,
		suffix,
		filepath,
		reponame,
		language,
		allSnippets, // AIDIFF: Added snippets
		workspaceUris,
	): string => {
		const snippets = allSnippets.filter(
			(snippet) => snippet.type === AutocompleteSnippetType.Code,
		) as AutocompleteCodeSnippet[]

		const relativePaths = getShortestUniqueRelativeUriPaths(
			[...snippets.map((snippet) => snippet.filepath), filepath],
			workspaceUris,
		)
		const baseTemplate = `###PATH:${
			relativePaths[relativePaths.length - 1].uniquePath // AIDIFF: Use uniquePath
		}\n###LANGUAGE:${language}\n###MODE:BLOCK\n<|code_suffix|>${suffix}<|code_prefix|>${prefix}<|code_middle|>`
		if (snippets.length === 0) {
			return `<|user|>\n${baseTemplate}<|assistant|>\n`
		}
		const references = `###REFERENCE:\n${snippets
			.map((snippet, i) => `###PATH:${relativePaths[i].uniquePath}\n${snippet.content}\n`) // AIDIFF: Use uniquePath
			.join("###REFERENCE:\n")}`
		const prompt = `<|user|>\n${references}\n${baseTemplate}<|assistant|>\n`
		return prompt
	},
	completionOptions: {
		stop: ["<|user|>", "<|code_suffix|>", "<|code_prefix|>", "<|code_middle|>", "<|assistant|>", endOfText],
	},
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
const holeFillerTemplate: AutocompleteTemplate = {
	template: (prefix: string, suffix: string) => {
		// From https://github.com/VictorTaelin/AI-scripts
		const SYSTEM_MSG = `You are a HOLE FILLER. You are provided with a file containing holes, formatted as '{{HOLE_NAME}}'. Your TASK is to complete with a string to replace this hole with, inside a <COMPLETION/> XML tag, including context-aware indentation, if needed.  All completions MUST be truthful, accurate, well-written and correct.

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

<COMPLETION>a ** 2 + </COMPLETION>`

		const fullPrompt =
			SYSTEM_MSG +
			`\n\n<QUERY>\n${prefix}{{FILL_HERE}}${suffix}\n</QUERY>\nTASK: Fill the {{FILL_HERE}} hole. Answer only with the CORRECT completion, and NOTHING ELSE. Do it now.\n<COMPLETION>`
		return fullPrompt
	},
	completionOptions: {
		stop: ["</COMPLETION>"],
	},
}

// AIDIFF: Updated to match continue/core/autocomplete/templating/AutocompleteTemplate.ts
export function getTemplateForModel(model: string): AutocompleteTemplate {
	const lowerCaseModel = model.toLowerCase()

	// PLANREF: Logic from continue/core/autocomplete/templating/AutocompleteTemplate.ts getTemplateForModel
	// if (lowerCaseModel.includes("starcoder2")) { // AIDIFF: Starcoder2 is handled by the generic starcoder block below in continue's logic, but could be specific if needed
	//   return starcoder2FimTemplate;
	// }
	if (lowerCaseModel.includes("mercury")) {
		return mercuryMultifileFimTemplate
	}

	if (lowerCaseModel.includes("qwen") && lowerCaseModel.includes("coder")) {
		return qwenCoderFimTemplate
	}

	if (lowerCaseModel.includes("seed") && lowerCaseModel.includes("coder")) {
		return seedCoderFimTemplate
	}

	if (
		lowerCaseModel.includes("starcoder") || // AIDIFF: Includes starcoder2 implicitly
		lowerCaseModel.includes("star-coder") ||
		lowerCaseModel.includes("starchat") ||
		lowerCaseModel.includes("octocoder") ||
		lowerCaseModel.includes("stable") || // This was stableCodeFimTemplate
		lowerCaseModel.includes("codeqwen") || // This was also stableCodeFimTemplate
		lowerCaseModel.includes("qwen") // This was also stableCodeFimTemplate (non-coder qwen)
	) {
		// AIDIFF: continue/ uses stableCodeFimTemplate for these.
		// If starcoder2 needs specific handling, it should be added above.
		if (lowerCaseModel.includes("starcoder2")) {
			return starcoder2FimTemplate // AIDIFF: Explicitly use starcoder2 if identified
		}
		return stableCodeFimTemplate
	}

	if (lowerCaseModel.includes("codestral") || lowerCaseModel.includes("gemini")) {
		return codestralMultifileFimTemplate
	}

	if (lowerCaseModel.includes("codegemma")) {
		return codegemmaFimTemplate
	}

	if (lowerCaseModel.includes("codellama")) {
		return codeLlamaFimTemplate
	}

	if (lowerCaseModel.includes("deepseek")) {
		return deepseekFimTemplate
	}

	if (lowerCaseModel.includes("codegeex")) {
		return codegeexFimTemplate
	}

	if (
		lowerCaseModel.includes("gpt") ||
		lowerCaseModel.includes("davinci-002") ||
		lowerCaseModel.includes("claude") ||
		lowerCaseModel.includes("granite3") ||
		lowerCaseModel.includes("granite-3")
	) {
		return holeFillerTemplate
	}

	// AIDIFF: Default to stableCodeFimTemplate as in continue/
	return stableCodeFimTemplate
}

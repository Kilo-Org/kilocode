//PLANREF: continue/core/autocomplete/templating/index.ts
// Fill in the middle prompts

import { CompletionOptions } from "../types.js"
import { getLastNUriRelativePathParts } from "./uri" // Removed .js extension

export interface AutocompleteTemplate {
	compilePrefixSuffix?: (
		prefix: string,
		suffix: string,
		filepath: string,
		reponame: string,
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
				workspaceUris: string[],
		  ) => string)
	completionOptions?: Partial<CompletionOptions>
}

const endOfText = "<|end" + "of" + "text|>" // workaround for https://github.com/Kilo-Org/kilocode/issues/452
// https://huggingface.co/stabilityai/stable-code-3b
const stableCodeFimTemplate: AutocompleteTemplate = {
	template: "<fim_prefix>{{{prefix}}}<fim_suffix>{{{suffix}}}<fim_middle>",
	completionOptions: {
		stop: ["<fim_prefix>", "<fim_suffix>", "<fim_middle>", "<file_sep>", endOfText, "</fim_middle>", "</code>"],
	},
}

// https://github.com/QwenLM/Qwen2.5-Coder?tab=readme-ov-file#3-file-level-code-completion-fill-in-the-middle
// This issue asks about the use of <|repo_name|> and <|file_sep|> together with <|fim_prefix|>, <|fim_suffix|> and <|fim_middle|>
// https://github.com/QwenLM/Qwen2.5-Coder/issues/343
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

const seedCoderFimTemplate: AutocompleteTemplate = {
	template: "<[fim-prefix]>{{{prefix}}}<[fim-suffix]>{{{suffix}}}<[fim-middle]>",
	completionOptions: {
		stop: [
			"<[end▁of▁sentence]>",
			"<[fim-prefix]>",
			"<[fim-middle]>",
			"<[fim-suffix]>",
			"<[PAD▁TOKEN]>",
			"<[SEP▁TOKEN]>",
			"<[begin▁of▁sentence]>",
		],
	},
}

// const codestralFimTemplate: AutocompleteTemplate = {
// 	template: "[SUFFIX]{{{suffix}}}[PREFIX]{{{prefix}}}",
// 	completionOptions: {
// 		stop: ["[PREFIX]", "[SUFFIX]"],
// 	},
// }

const codestralMultifileFimTemplate: AutocompleteTemplate = {
	compilePrefixSuffix: (prefix, suffix, filepath, reponame, workspaceUris): [string, string] => {
		if (suffix.trim().length === 0 && prefix.trim().length === 0) {
			return [`+++++ ${getLastNUriRelativePathParts(workspaceUris, filepath, 2)}\n${prefix}`, suffix]
		}
		return [prefix, suffix]
	},
	template: (prefix: string, suffix: string): string => {
		return `[SUFFIX]${suffix}[PREFIX]${prefix}`
	},
	completionOptions: {
		stop: ["[PREFIX]", "[SUFFIX]", "\n+++++ "],
	},
}

const codegemmaFimTemplate: AutocompleteTemplate = {
	template: "<|fim_prefix|>{{{prefix}}}<|fim_suffix|>{{{suffix}}}<|fim_middle|>",
	completionOptions: {
		stop: ["<|fim_prefix|>", "<|fim_suffix|>", "<|fim_middle|>", "<|file_separator|>", "<end_of_turn>", "<eos>"],
	},
}

// Google Gemini 2.5 Flash FIM template
const googleGeminiFlashFimTemplate: AutocompleteTemplate = {
	template: "<FIM_PREFIX>{{{prefix}}}<FIM_SUFFIX>{{{suffix}}}<FIM_MIDDLE>",
	completionOptions: {
		stop: ["<FIM_PREFIX>", "<FIM_SUFFIX>", "<FIM_MIDDLE>", "<eos>"],
	},
}

const codeLlamaFimTemplate: AutocompleteTemplate = {
	template: "<PRE> {{{prefix}}} <SUF>{{{suffix}}} <MID>",
	completionOptions: { stop: ["<PRE>", "<SUF>", "<MID>", "<EOT>"] },
}

// https://huggingface.co/deepseek-ai/deepseek-coder-1.3b-base
const deepseekFimTemplate: AutocompleteTemplate = {
	template: "<｜fim▁begin｜>{{{prefix}}}<｜fim▁hole｜>{{{suffix}}}<｜fim▁end｜>",
	completionOptions: {
		stop: ["<｜fim▁begin｜>", "<｜fim▁hole｜>", "<｜fim▁end｜>", "//", "<｜end▁of▁sentence｜>"],
	},
}

// const gptAutocompleteTemplate: AutocompleteTemplate = {
// 	template: `\`\`\`
// {{{prefix}}}[BLANK]{{{suffix}}}
// \`\`\`

// Fill in the blank to complete the code block. Your response should include only the code to replace [BLANK], without surrounding backticks.`,
// 	completionOptions: { stop: ["\n"] },
// }

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

export function getTemplateForModel(model: string): AutocompleteTemplate {
	const lowerCaseModel = model.toLowerCase()

	if (lowerCaseModel.includes("qwen") && lowerCaseModel.includes("coder")) {
		return qwenCoderFimTemplate
	}

	if (lowerCaseModel.includes("seed") && lowerCaseModel.includes("coder")) {
		return seedCoderFimTemplate
	}

	if (
		lowerCaseModel.includes("starcoder") ||
		lowerCaseModel.includes("star-coder") ||
		lowerCaseModel.includes("starchat") ||
		lowerCaseModel.includes("octocoder") ||
		lowerCaseModel.includes("stable") ||
		lowerCaseModel.includes("codeqwen") ||
		lowerCaseModel.includes("qwen")
	) {
		return stableCodeFimTemplate
	}

	if (lowerCaseModel.includes("codestral")) {
		return codestralMultifileFimTemplate
	}

	if (lowerCaseModel.includes("codegemma")) {
		return codegemmaFimTemplate
	}

	if (lowerCaseModel.includes("gemini") && (lowerCaseModel.includes("flash") || lowerCaseModel.includes("2.5"))) {
		return googleGeminiFlashFimTemplate
	}

	if (lowerCaseModel.includes("codellama")) {
		return codeLlamaFimTemplate
	}

	if (lowerCaseModel.includes("deepseek")) {
		return deepseekFimTemplate
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

	return stableCodeFimTemplate
}

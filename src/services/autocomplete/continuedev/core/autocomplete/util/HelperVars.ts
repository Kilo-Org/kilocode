import { IDE, TabAutocompleteOptions } from "../.."
import { countTokens, pruneLinesFromBottom, pruneLinesFromTop } from "../../llm/countTokens"
import { AutocompleteLanguageInfo, languageForFilepath } from "../constants/AutocompleteLanguageInfo"
import { constructInitialPrefixSuffix } from "../templating/constructPrefixSuffix"

import { AstPath, getAst, getTreePathAtCursor } from "./ast"
import { AutocompleteInput } from "./types"

/**
 * A collection of variables that are often accessed throughout the autocomplete pipeline
 * It's noisy to re-calculate all the time or inject them into each function
 */
export interface HelperVars {
	lang: AutocompleteLanguageInfo
	treePath: AstPath | undefined
	workspaceUris: string[]
	fileContents: string
	fileLines: string[]
	fullPrefix: string
	fullSuffix: string
	prunedPrefix: string
	prunedSuffix: string
	input: AutocompleteInput
	options: TabAutocompleteOptions
	modelName: string
	filepath: string
	pos: any // Using any to match original getter return type inference, or import Position
	prunedCaretWindow: string
}

export const HelperVars = {
	create: async (
		input: AutocompleteInput,
		options: TabAutocompleteOptions,
		modelName: string,
		ide: IDE,
	): Promise<HelperVars> => {
		const lang = languageForFilepath(input.filepath)
		const workspaceUris = await ide.getWorkspaceDirs()
		const fileContents = input.manuallyPassFileContents ?? (await ide.readFile(input.filepath))
		const fileLines = fileContents.split("\n")

		// Construct full prefix/suffix (a few edge cases handled in here)
		const { prefix: fullPrefix, suffix: fullSuffix } = await constructInitialPrefixSuffix(input, ide)

		// Construct basic prefix
		const maxPrefixTokens = options.maxPromptTokens * options.prefixPercentage
		const prunedPrefix = pruneLinesFromTop(fullPrefix, maxPrefixTokens, modelName)

		// Construct suffix
		const maxSuffixTokens = Math.min(
			options.maxPromptTokens - countTokens(prunedPrefix, modelName),
			options.maxSuffixPercentage * options.maxPromptTokens,
		)
		const prunedSuffix = pruneLinesFromBottom(fullSuffix, maxSuffixTokens, modelName)

		let treePath: AstPath | undefined
		try {
			const ast = await getAst(input.filepath, fullPrefix + fullSuffix)
			if (ast) {
				treePath = await getTreePathAtCursor(ast, fullPrefix.length)
			}
		} catch (e) {
			console.error("Failed to parse AST", e)
		}

		return {
			lang,
			treePath,
			workspaceUris,
			fileContents,
			fileLines,
			fullPrefix,
			fullSuffix,
			prunedPrefix,
			prunedSuffix,
			input,
			options,
			modelName,
			get filepath() {
				return input.filepath
			},
			get pos() {
				return input.pos
			},
			get prunedCaretWindow() {
				return prunedPrefix + prunedSuffix
			},
		}
	},
}

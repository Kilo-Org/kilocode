// AIDIFF: Aligned with continue/core/autocomplete/templating/getStopTokens.ts
// PLANREF: continue/core/autocomplete/templating/getStopTokens.ts
import { AutocompleteLanguageInfo } from "../AutocompleteLanguageInfo" // AIDIFF: Path kept as is, type is compatible
import { CompletionOptions } from "../types" // AIDIFF: Path kept as is, type is compatible

const _DOUBLE_NEWLINE = "\n\n" // AIDIFF: continue/ does not use this, but kept for potential future use.
const _WINDOWS_DOUBLE_NEWLINE = "\r\n\r\n"
// TODO: Do we want to stop completions when reaching a `/src/` string?
const SRC_DIRECTORY = "/src/"
// Starcoder2 tends to output artifacts starting with the letter "t"
const STARCODER2_T_ARTIFACTS = ["t.", "\nt", "<file_sep>"]
const PYTHON_ENCODING = "#- coding: utf-8"
const CODE_BLOCK_END = "```"

// const multilineStops: string[] = [DOUBLE_NEWLINE, WINDOWS_DOUBLE_NEWLINE];
const commonStops = [SRC_DIRECTORY, PYTHON_ENCODING, CODE_BLOCK_END]

export function getStopTokens(
	completionOptions: Partial<CompletionOptions> | undefined,
	lang: AutocompleteLanguageInfo,
	model: string,
): string[] {
	const stopTokens = [
		...(completionOptions?.stop || []),
		// ...multilineStops,
		...commonStops,
		...(model.toLowerCase().includes("starcoder2") ? STARCODER2_T_ARTIFACTS : []),
		// ...lang.topLevelKeywords.map((word) => `\n${word}`),
	]

	return stopTokens
}

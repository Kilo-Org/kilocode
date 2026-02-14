import type { AutocompleteSuggestion } from "../uselessSuggestionFilter"
import { markdownFilter } from "./markdown"

export type LanguageFilter = (params: AutocompleteSuggestion) => string

const languageFilters: Record<string, LanguageFilter> = {
	markdown: markdownFilter,
}

export function applyLanguageFilter(params: AutocompleteSuggestion & { languageId: string }): string {
	const filter = languageFilters[params.languageId]
	if (!filter) {
		return params.suggestion
	}
	return filter(params)
}

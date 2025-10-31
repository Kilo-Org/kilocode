export interface FillInAtCursorSuggestion {
	text: string
	prefix: string
	suffix: string
}

export class GhostSuggestionsState {
	private fillinAtCursorSuggestion: FillInAtCursorSuggestion | undefined = undefined

	constructor() {}

	public setFillInAtCursor(suggestion: FillInAtCursorSuggestion) {
		this.fillinAtCursorSuggestion = suggestion
	}

	public getFillInAtCursor(): FillInAtCursorSuggestion | undefined {
		return this.fillinAtCursorSuggestion
	}

	public hasSuggestions(): boolean {
		return !!this.fillinAtCursorSuggestion
	}

	public clear(): void {
		this.fillinAtCursorSuggestion = undefined
	}
}

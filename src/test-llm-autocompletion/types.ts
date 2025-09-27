export enum UseCaseType {
	AUTO_TRIGGER = "auto_trigger",
	COMMENT_DRIVEN = "comment_driven",
	ERROR_FIX = "error_fix",
	INLINE_COMPLETION = "inline_completion",
	NEW_LINE = "new_line",
	SELECTION_REFACTOR = "selection_refactor",
	USER_REQUEST = "user_request",
}

export interface GhostSuggestionContext {
	document: any
	range: any
	recentOperations?: any[]
	diagnostics?: any[]
	openFiles?: any[]
	userInput?: string
	rangeASTNode?: any
}

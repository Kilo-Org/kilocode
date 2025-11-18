import * as vscode from "vscode"
import { AutocompleteInput } from "../../types"

/**
 * Standardized request structure for all completion strategies
 */
export interface CompletionRequest {
	/** Text before the cursor position */
	prefix: string

	/** Text after the cursor position */
	suffix: string

	/** Language identifier (typescript, javascript, etc.) */
	languageId: string

	/** Standardized autocomplete input data */
	autocompleteInput: AutocompleteInput

	/** VSCode document reference */
	document: vscode.TextDocument

	/** Cursor position in the document */
	position: vscode.Position

	/** Optional: Request metadata for tracking/analytics */
	metadata?: {
		requestId: string
		timestamp: number
		triggerKind: vscode.InlineCompletionTriggerKind
	}
}

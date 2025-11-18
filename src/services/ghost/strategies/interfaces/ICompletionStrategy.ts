import { GhostModel } from "../../GhostModel"
import { GhostContextProvider } from "../../classic-auto-complete/GhostContextProvider"
import { CompletionRequest } from "./CompletionRequest"
import { CompletionResult } from "./CompletionResult"

/**
 * Base interface for all completion strategies
 * Each strategy handles its own prompt creation and server calling
 */
export interface ICompletionStrategy {
	/** Unique identifier for the strategy */
	readonly name: string

	/** Human-readable description of the strategy */
	readonly description: string

	/** Check if this strategy supports the given model */
	supportsModel(model: GhostModel): boolean

	/** Generate completion using this strategy */
	generateCompletion(
		request: CompletionRequest,
		model: GhostModel,
		contextProvider: GhostContextProvider,
	): Promise<CompletionResult>

	/** Priority for strategy selection (higher = more preferred) */
	getPriority(): number

	/** Optional: Strategy-specific configuration validation */
	validateConfig?(config: any): boolean

	/** Optional: Strategy initialization */
	initialize?(): Promise<void>

	/** Optional: Strategy cleanup */
	dispose?(): void
}

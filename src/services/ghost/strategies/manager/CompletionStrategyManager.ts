import { CompletionStrategyRegistry } from "../registry/CompletionStrategyRegistry"
import { ICompletionStrategy } from "../interfaces/ICompletionStrategy"
import { CompletionRequest } from "../interfaces/CompletionRequest"
import { CompletionResult } from "../interfaces/CompletionResult"
import { GhostModel } from "../../GhostModel"
import { GhostContextProvider } from "../../classic-auto-complete/GhostContextProvider"

/**
 * Manages strategy selection and execution
 * Provides fallback mechanisms and error handling
 */
export class CompletionStrategyManager {
	private registry: CompletionStrategyRegistry
	private fallbackStrategy: ICompletionStrategy | null = null

	constructor(registry: CompletionStrategyRegistry, fallbackStrategy?: ICompletionStrategy) {
		this.registry = registry
		if (fallbackStrategy) {
			this.fallbackStrategy = fallbackStrategy
		}
	}

	/**
	 * Set the fallback strategy to use when primary strategy fails
	 */
	setFallbackStrategy(strategy: ICompletionStrategy): void {
		this.fallbackStrategy = strategy
	}

	/**
	 * Execute completion using the best available strategy
	 * Includes fallback mechanism and error handling
	 */
	async executeCompletion(
		request: CompletionRequest,
		model: GhostModel,
		contextProvider: GhostContextProvider,
	): Promise<CompletionResult> {
		const selectedStrategy = this.registry.selectBestStrategy(model) || this.fallbackStrategy

		if (!selectedStrategy) {
			throw new Error("No completion strategy available for the current model")
		}

		try {
			console.debug(`Executing completion with strategy: ${selectedStrategy.name}`)

			const result = await selectedStrategy.generateCompletion(request, model, contextProvider)

			// Add strategy metadata to result
			result.strategyUsed = selectedStrategy.name

			return result
		} catch (error) {
			console.warn(`Strategy ${selectedStrategy.name} failed, attempting fallback`, error)

			// Fallback to fallback strategy if available and different from selected
			if (this.fallbackStrategy && selectedStrategy.name !== this.fallbackStrategy.name) {
				try {
					const fallbackResult = await this.fallbackStrategy.generateCompletion(
						request,
						model,
						contextProvider,
					)
					fallbackResult.strategyUsed = `${selectedStrategy.name}->${this.fallbackStrategy.name} (fallback)`
					return fallbackResult
				} catch (fallbackError) {
					console.error("Fallback strategy also failed", fallbackError)
					throw fallbackError
				}
			}

			throw error
		}
	}

	/**
	 * Execute completion with a specific strategy (for testing or overrides)
	 */
	async executeCompletionWithStrategy(
		strategyName: string,
		request: CompletionRequest,
		model: GhostModel,
		contextProvider: GhostContextProvider,
	): Promise<CompletionResult> {
		const strategy = this.registry.getStrategy(strategyName)

		if (!strategy) {
			throw new Error(`Strategy ${strategyName} not found in registry`)
		}

		if (!strategy.supportsModel(model)) {
			throw new Error(`Strategy ${strategyName} does not support the current model`)
		}

		const result = await strategy.generateCompletion(request, model, contextProvider)
		result.strategyUsed = strategy.name
		return result
	}

	/**
	 * Get information about available strategies
	 */
	getStrategyInfo(model?: GhostModel): Array<{
		name: string
		description: string
		priority: number
		supportsCurrentModel: boolean
	}> {
		return this.registry.getStrategies().map((strategy) => ({
			name: strategy.name,
			description: strategy.description,
			priority: strategy.getPriority(),
			supportsCurrentModel: model ? strategy.supportsModel(model) : false,
		}))
	}
}

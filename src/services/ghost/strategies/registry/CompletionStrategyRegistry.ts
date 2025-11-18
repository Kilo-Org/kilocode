import { ICompletionStrategy } from "../interfaces/ICompletionStrategy"
import { GhostModel } from "../../GhostModel"

/**
 * Registry for managing completion strategies
 * Handles registration, selection, and lifecycle management
 */
export class CompletionStrategyRegistry {
	private strategies: Map<string, ICompletionStrategy> = new Map()
	private strategyCache: WeakMap<GhostModel, ICompletionStrategy | null> = new WeakMap()

	/**
	 * Register a new completion strategy
	 */
	register(strategy: ICompletionStrategy): void {
		if (this.strategies.has(strategy.name)) {
			console.warn(`Strategy ${strategy.name} is already registered, overwriting`)
		}

		this.strategies.set(strategy.name, strategy)
		console.info(`Registered completion strategy: ${strategy.name}`)

		// Clear cache when strategies change
		this.strategyCache = new WeakMap()
	}

	/**
	 * Unregister a completion strategy
	 */
	unregister(strategyName: string): boolean {
		const removed = this.strategies.delete(strategyName)
		if (removed) {
			console.info(`Unregistered completion strategy: ${strategyName}`)
			this.strategyCache = new WeakMap()
		}
		return removed
	}

	/**
	 * Get all registered strategies
	 */
	getStrategies(): ICompletionStrategy[] {
		return Array.from(this.strategies.values())
	}

	/**
	 * Get strategy by name
	 */
	getStrategy(name: string): ICompletionStrategy | undefined {
		return this.strategies.get(name)
	}

	/**
	 * Select the best strategy for the given model
	 * Uses caching to avoid repeated selection logic
	 */
	selectBestStrategy(model: GhostModel): ICompletionStrategy | null {
		// Check cache first
		if (this.strategyCache.has(model)) {
			return this.strategyCache.get(model) || null
		}

		// Find all strategies that support this model
		const supportedStrategies = this.getStrategies().filter((strategy) => strategy.supportsModel(model))

		if (supportedStrategies.length === 0) {
			console.warn("No strategies support the current model")
			this.strategyCache.set(model, null)
			return null
		}

		// Select strategy with highest priority
		const bestStrategy = supportedStrategies.reduce((best, current) => {
			return current.getPriority() > best.getPriority() ? current : best
		})

		console.info(`Selected strategy ${bestStrategy.name} for model ${model.getModelName()}`)

		// Cache the result
		this.strategyCache.set(model, bestStrategy)
		return bestStrategy
	}

	/**
	 * Initialize all strategies that support initialization
	 */
	async initializeStrategies(): Promise<void> {
		const initPromises = this.getStrategies()
			.filter((strategy) => strategy.initialize)
			.map((strategy) => {
				console.info(`Initializing strategy: ${strategy.name}`)
				return strategy.initialize!()
			})

		await Promise.allSettled(initPromises)
	}

	/**
	 * Dispose all strategies that support cleanup
	 */
	async disposeStrategies(): Promise<void> {
		const disposePromises = this.getStrategies()
			.filter((strategy) => strategy.dispose)
			.map((strategy) => {
				console.info(`Disposing strategy: ${strategy.name}`)
				return strategy.dispose!()
			})

		await Promise.allSettled(disposePromises)
		this.strategies.clear()
	}
}

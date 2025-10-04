import { GhostXmlStrategy } from "./GhostXmlStrategy"
import { AVAILABLE_GHOST_STRATEGIES, DEFAULT_GHOST_STRATEGY_ID } from "../../shared/ghost-strategies"

// Static map of strategy classes by Ghost Strategy ID
const STRATEGY_CLASS_MAP: Record<string, new (options?: { debug: boolean }) => GhostXmlStrategy> = {
	"xml-default": GhostXmlStrategy,
	// Future strategies will be added here
	// "completion-based": GhostCompletionStrategy,
}

/**
 * Create a strategy instance for the given Ghost Strategy ID
 */
export function createStrategyInstance(strategyId: string): GhostXmlStrategy {
	const StrategyClass = STRATEGY_CLASS_MAP[strategyId]
	if (StrategyClass) {
		return new StrategyClass({ debug: true })
	}

	// Fallback to default strategy
	console.warn(`Unknown Ghost Strategy ID: ${strategyId}, falling back to default`)
	const DefaultStrategyClass = STRATEGY_CLASS_MAP[DEFAULT_GHOST_STRATEGY_ID]
	return new DefaultStrategyClass({ debug: true })
}

// Re-export shared constants for convenience
export { AVAILABLE_GHOST_STRATEGIES, DEFAULT_GHOST_STRATEGY_ID } from "../../shared/ghost-strategies"

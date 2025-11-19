import { GhostModel } from "../../GhostModel"
import { GhostContextProvider } from "../GhostContextProvider"
import { ICompletionStrategy } from "./ICompletionStrategy"
import { HoleFillerStrategy } from "./HoleFillerStrategy"
import { FimStrategy } from "./FimStrategy"

/**
 * Factory for creating the appropriate completion strategy based on model capabilities
 */
export class StrategyFactory {
	/**
	 * Create a completion strategy based on whether the model supports FIM
	 */
	static createStrategy(model: GhostModel, contextProvider: GhostContextProvider): ICompletionStrategy {
		if (model.supportsFim()) {
			return new FimStrategy(contextProvider)
		}
		return new HoleFillerStrategy(contextProvider)
	}
}

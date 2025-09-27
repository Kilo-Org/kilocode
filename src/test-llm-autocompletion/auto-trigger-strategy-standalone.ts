/**
 * Thin adapter that re-exports the real strategy for tests.
 * Avoids duplication; mock VSCode deps in tests if needed.
 */
import { AutoTriggerStrategy } from "../services/ghost/strategies/AutoTriggerStrategy"

export { AutoTriggerStrategy }
export default AutoTriggerStrategy

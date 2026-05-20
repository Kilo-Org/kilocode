/**
 * Cost tracker — re-exported from @kilo-code/boxes
 * Original 4-file module (types + state + format + index) → single atom
 */
export { formatCost, formatTotalCost } from "@kilo-code/boxes/cost-tracker"
export type { TokenUsage, ModelUsage } from "@kilo-code/boxes/cost-tracker"

// Namespace wrapper for backward compatibility
import * as CT from "@kilo-code/boxes/cost-tracker"
export const State = {
  reset: CT.reset,
  getTotalCost: CT.getTotalCost,
  getDuration: CT.getDuration,
  getAPIDuration: CT.getAPIDuration,
  getLines: CT.getLines,
  getModelUsage: CT.getModelUsage,
  getUsageForModel: CT.getUsageForModel,
  addSessionCost: CT.addSessionCost,
  addLines: CT.addLines,
  addAPIDuration: CT.addAPIDuration,
  addToolDuration: CT.addToolDuration,
}

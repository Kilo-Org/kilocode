// Re-export the new incremental token-based file reader
export { readFileWithTokenBudget } from "../../../integrations/misc/read-file-with-budget"
export type { ReadWithBudgetResult, ReadWithBudgetOptions } from "../../../integrations/misc/read-file-with-budget"

/**
 * Percentage of available context to reserve for file reading.
 * The remaining percentage is reserved for the model's response and overhead.
 */
export const FILE_READ_BUDGET_PERCENT = 0.6 // 60% for file, 40% for response

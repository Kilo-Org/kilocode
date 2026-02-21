/**
 * Format a cost breakdown string for display.
 * This mirrors the backend formatCostBreakdown function but uses the webview's i18n.
 *
 * @param ownCost - The task's own cost
 * @param childrenCost - The sum of subtask costs
 * @param labels - Labels for "Own" and "Subtasks" (from i18n)
 * @returns Formatted breakdown string like "Own: $1.00 + Subtasks: $0.50"
 */
export function formatCostBreakdown(
	ownCost: number,
	childrenCost: number,
	labels: { own: string; subtasks: string },
): string {
	return `${labels.own}: $${ownCost.toFixed(2)} + ${labels.subtasks}: $${childrenCost.toFixed(2)}`
}

/**
 * Get cost breakdown string if the task has children with costs.
 *
 * @param costs - Object containing ownCost and childrenCost
 * @param labels - Labels for "Own" and "Subtasks" (from i18n)
 * @returns Formatted breakdown string or undefined if no children costs
 */
export function getCostBreakdownIfNeeded(
	costs: { ownCost: number; childrenCost: number } | undefined,
	labels: { own: string; subtasks: string },
): string | undefined {
	if (!costs || costs.childrenCost <= 0) {
		return undefined
	}
	return formatCostBreakdown(costs.ownCost, costs.childrenCost, labels)
}

/**
 * Formats a cost value: 2 decimal places if above $0.05, otherwise 4 decimal places.
 * If cost value is zero it will stay at 2 decimal places.
 * @param cost - The cost in USD
 * @returns Formatted string like "0.0234" or "1.23"
 */
export function formatCost(cost: number): string {
	return cost === 0 || cost > 0.05 ? cost.toFixed(2) : cost.toFixed(4)
}

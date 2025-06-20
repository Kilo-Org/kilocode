/**
 * Formats cost with special handling for small amounts
 * @param cost The cost value to format
 * @returns A formatted cost string
 */
export function formatCost(cost: number): string {
	if (cost === 0) return "$0.00"
	if (cost > 0 && cost < 0.01) return "<$0.01" // Less than one cent
	return `$${cost.toFixed(2)}`
}

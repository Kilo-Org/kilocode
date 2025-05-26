/**
 * Moved price formatting functions
 */

// Helper functions
function roundToDecimal(value: number, decimals: number = 2): number {
	const factor = Math.pow(10, decimals)
	return Math.round(value * factor) / factor
}

function formatNumber(value: number, decimals: number = 2): string {
	return value.toFixed(decimals)
}

// Main function that depends on helpers
export function formatPrice(price: number, currency: string = "USD"): string {
	const rounded = roundToDecimal(price)
	return `${currency} ${formatNumber(rounded)}`
}

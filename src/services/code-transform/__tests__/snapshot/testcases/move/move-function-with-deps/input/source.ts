/**
 * Price formatting utilities
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

// Another function
export function calculateDiscount(price: number, discountPercent: number): number {
	return price * (1 - discountPercent / 100)
}

// Function that uses other exported functions
export function formatDiscountedPrice(price: number, discountPercent: number, currency: string = "USD"): string {
	const discounted = calculateDiscount(price, discountPercent)
	return formatPrice(discounted, currency)
}

/**
 * Collection of pricing utilities
 */

// Some existing functions in the target file
export function applyPromoCode(total: number, promoCode: string): number {
	if (promoCode === "SAVE10") {
		return total * 0.9 // 10% discount
	} else if (promoCode === "SAVE20") {
		return total * 0.8 // 20% discount
	}
	return total // No valid promo code
}

export function calculateShipping(total: number, distance: number): number {
	const baseShipping = 5.99
	const distanceFactor = Math.ceil(distance / 100) * 2
	return baseShipping + distanceFactor
}

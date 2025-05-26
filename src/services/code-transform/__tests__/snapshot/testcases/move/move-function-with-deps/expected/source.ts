/**
 * Price formatting utilities
 */

import { formatPrice } from "./target"

// Another function
export function calculateDiscount(price: number, discountPercent: number): number {
	return price * (1 - discountPercent / 100)
}

// Function that uses other exported functions
export function formatDiscountedPrice(price: number, discountPercent: number, currency: string = "USD"): string {
	const discounted = calculateDiscount(price, discountPercent)
	return formatPrice(discounted, currency)
}

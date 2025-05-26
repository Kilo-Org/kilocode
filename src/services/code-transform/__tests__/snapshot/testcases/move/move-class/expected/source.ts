/**
 * Price calculations module
 */

import { PriceCalculator } from "./target"

// Utility functions
export function formatCurrency(amount: number, currency: string = "USD"): string {
	return `${currency} ${amount.toFixed(2)}`
}

// Discount calculator
export function calculateDiscount(amount: number, discountPercent: number): number {
	return amount * (discountPercent / 100)
}

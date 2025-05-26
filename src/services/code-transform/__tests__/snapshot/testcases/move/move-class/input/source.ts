/**
 * Price calculations module
 */

// Utility functions
export function formatCurrency(amount: number, currency: string = "USD"): string {
	return `${currency} ${amount.toFixed(2)}`
}

// Price calculator class
export class PriceCalculator {
	private taxRate: number

	constructor(taxRate: number = 0.1) {
		this.taxRate = taxRate
	}

	calculateTax(amount: number): number {
		return amount * this.taxRate
	}

	calculateTotal(basePrice: number): number {
		const tax = this.calculateTax(basePrice)
		return basePrice + tax
	}
}

// Discount calculator
export function calculateDiscount(amount: number, discountPercent: number): number {
	return amount * (discountPercent / 100)
}

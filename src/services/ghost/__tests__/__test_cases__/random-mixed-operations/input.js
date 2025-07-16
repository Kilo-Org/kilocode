function formatCurrency(amount) {
	return `$${amount.toFixed(2)}`
}

function calculateTax(amount, rate) {
	return amount * rate
}

function generateInvoice(items, taxRate) {
	const subtotal = items.reduce((sum, item) => sum + item.price, 0)
	const tax = calculateTax(subtotal, taxRate)
	const total = subtotal + tax

	return {
		subtotal: formatCurrency(subtotal),
		tax: formatCurrency(tax),
		total: formatCurrency(total),
	}
}

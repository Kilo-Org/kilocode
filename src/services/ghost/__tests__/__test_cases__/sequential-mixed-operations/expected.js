function calculateTotal(items) {
	let total = 0
	// Add tax calculation
	for (const item of items) {
		total += item.price * 1.1 // Apply 10% tax
	}
	return total
}

function processOrder(order) {
	// Validate order first
	if (!order || !order.items) {
		throw new Error("Invalid order")
	}
	const total = calculateTotal(order.items)
	return {
		id: order.id,
		total: total,
		status: "completed",
	}
}

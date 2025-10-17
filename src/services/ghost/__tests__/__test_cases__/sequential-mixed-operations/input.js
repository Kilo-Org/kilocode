function calculateTotal(items) {
	let total = 0
	for (const item of items) {
		total += item.price
	}
	return total
}

function processOrder(order) {
	const total = calculateTotal(order.items)
	return {
		id: order.id,
		total: total,
		status: "processed",
	}
}

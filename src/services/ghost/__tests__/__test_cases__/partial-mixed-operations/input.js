function calculateDiscount(price, discountRate) {
	return price * discountRate
}

function applyDiscount(item) {
	const discount = calculateDiscount(item.price, 0.1)
	return {
		...item,
		discountedPrice: item.price - discount,
	}
}

function processItems(items) {
	return items.map(applyDiscount)
}

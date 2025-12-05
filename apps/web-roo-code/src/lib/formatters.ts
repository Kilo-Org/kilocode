const formatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
})

export const formatCurrency = (amount: number) => formatter.format(amount)

export const formatTokens = (tokens: number) => {
	if (tokens < 1000) {
		return tokens.toString()
	}

	if (tokens < 1000000) {
		return `${(tokens / 1000).toFixed(1)}K`
	}

	if (tokens < 1000000000) {
		return `${(tokens / 1000000).toFixed(1)}M`
	}

	return `${(tokens / 1000000000).toFixed(1)}B`
}

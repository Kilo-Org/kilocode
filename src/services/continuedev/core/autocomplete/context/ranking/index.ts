const rx = /[\s.,/#!$%^&*;:{}=\-_`~()[\]]/g
export function getSymbolsForSnippet(snippet: string): Set<string> {
	const symbols = snippet
		.split(rx)
		.map((s) => s.trim())
		.filter((s) => s !== "")
	return new Set(symbols)
}

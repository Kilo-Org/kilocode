export function removePrefixOverlap(completion: string, prefix: string): string {
	const prefixEnd = prefix.split("\n").pop()
	if (prefixEnd) {
		if (completion.startsWith(prefixEnd)) {
			completion = completion.slice(prefixEnd.length)
		} else {
			const trimmedPrefix = prefixEnd.trim()
			const lastWord = trimmedPrefix.split(/\s+/).pop()
			if (lastWord && completion.startsWith(lastWord)) {
				completion = completion.slice(lastWord.length)
			} else if (completion.startsWith(trimmedPrefix)) {
				completion = completion.slice(trimmedPrefix.length)
			}
		}
	}
	return completion
}

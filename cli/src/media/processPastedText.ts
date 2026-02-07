// Regex to match pasted text references: [Pasted text #N +X lines]
export const PASTED_TEXT_REFERENCE_REGEX = /\[Pasted text #(\d+) \+(\d+) lines\]/g

export function extractPastedTextReferences(text: string): number[] {
	const refs: number[] = []
	let match
	PASTED_TEXT_REFERENCE_REGEX.lastIndex = 0
	while ((match = PASTED_TEXT_REFERENCE_REGEX.exec(text)) !== null) {
		const ref = match[1]
		if (ref !== undefined) {
			refs.push(parseInt(ref, 10))
		}
	}
	return refs
}

export function removePastedTextReferences(text: string): string {
	return text.replace(PASTED_TEXT_REFERENCE_REGEX, "")
}

export function expandPastedTextReferences(text: string, pastedTextReferences: Record<number, string>): string {
	return text.replace(PASTED_TEXT_REFERENCE_REGEX, (match, refNum) => {
		const content = pastedTextReferences[parseInt(refNum, 10)]
		if (content === undefined) return match
		// Normalize tabs to spaces when expanding
		return content.replace(/\t/g, "  ")
	})
}

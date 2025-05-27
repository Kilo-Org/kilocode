export function getI18nNestedKey(obj: any, path: string): any {
	if (!path) return obj

	const parts = path.split(".")
	let current = obj

	for (const part of parts) {
		if (current === undefined || current === null || typeof current !== "object") {
			return undefined
		}
		current = current[part]
	}

	return current
}

export function setI18nNestedKey(obj: any, path: string, value: any): void {
	const parts = path.split(".")
	let current = obj

	for (let i = 0; i < parts.length - 1; i++) {
		const part = parts[i]
		if (!(part in current) || current[part] === null || typeof current[part] !== "object") {
			current[part] = {}
		}
		current = current[part]
	}

	current[parts[parts.length - 1]] = value
}

export function deleteI18nNestedKey(obj: any, path: string): boolean {
	const parts = path.split(".")
	let current = obj

	for (let i = 0; i < parts.length - 1; i++) {
		const part = parts[i]
		if (!(part in current) || current[part] === null || typeof current[part] !== "object") {
			return false
		}
		current = current[part]
	}

	const lastPart = parts[parts.length - 1]
	if (lastPart in current) {
		delete current[lastPart]
		return true
	}

	return false
}

export function cleanupEmptyI18nObjects(obj: any): boolean {
	if (typeof obj !== "object" || obj === null) {
		return false
	}

	if (Array.isArray(obj)) {
		for (let i = obj.length - 1; i >= 0; i--) {
			if (cleanupEmptyI18nObjects(obj[i])) {
				obj.splice(i, 1)
			}
		}
		return obj.length === 0
	}

	let isEmpty = true
	for (const key in obj) {
		if (Object.prototype.hasOwnProperty.call(obj, key)) {
			const value = obj[key]

			if (typeof value === "object" && value !== null) {
				const propertyIsEmpty = cleanupEmptyI18nObjects(value)
				if (propertyIsEmpty) {
					delete obj[key]
				} else {
					isEmpty = false
				}
			} else {
				isEmpty = false
			}
		}
	}

	return isEmpty
}

export function detectIndentation(content: string): { char: string; size: number } {
	const defaultIndentation = { char: " ", size: 2 }
	const lines = content.split("\n")
	const indentations = []

	for (const line of lines) {
		const match = line.match(/^(\s+)/)
		if (match) {
			indentations.push(match[1])
		}
	}

	if (indentations.length === 0) {
		return defaultIndentation
	}

	const counts: Record<string, number> = {}
	let maxCount = 0
	let mostCommon = ""

	for (const indent of indentations) {
		counts[indent] = (counts[indent] || 0) + 1
		if (counts[indent] > maxCount) {
			maxCount = counts[indent]
			mostCommon = indent
		}
	}

	const char = mostCommon.includes("\t") ? "\t" : " "
	const size = mostCommon.length

	return { char, size }
}

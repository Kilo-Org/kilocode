export function reorderJsonToMatchSource(
	target: Record<string, any>,
	source: Record<string, any>,
): Record<string, any> {
	const result: Record<string, any> = {}

	for (const key of Object.keys(source)) {
		if (key in target) {
			if (
				typeof source[key] === "object" &&
				source[key] !== null &&
				!Array.isArray(source[key]) &&
				typeof target[key] === "object" &&
				target[key] !== null &&
				!Array.isArray(target[key])
			) {
				result[key] = reorderJsonToMatchSource(target[key], source[key])
			} else {
				result[key] = target[key]
			}
		}
	}

	for (const key of Object.keys(target)) {
		if (!(key in result)) {
			result[key] = target[key]
		}
	}

	return result
}

export function isPlainObject(value: any): boolean {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.getPrototypeOf(value) === Object.prototype
	)
}

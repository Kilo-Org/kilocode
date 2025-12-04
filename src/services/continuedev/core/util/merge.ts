import { ConfigMergeType } from "../index.js"

// Allow any JSON-compatible value, including complex objects
export function mergeJson<T = Record<string, unknown>>(
	first: T,
	second: Partial<T>,
	mergeBehavior?: ConfigMergeType,
	mergeKeys?: { [key: string]: (a: unknown, b: unknown) => boolean },
): T {
	const copyOfFirst = JSON.parse(JSON.stringify(first))

	try {
		for (const key in second) {
			const secondValue = second[key]

			if (!(key in copyOfFirst) || mergeBehavior === "overwrite") {
				// New value
				copyOfFirst[key] = secondValue
				continue
			}

			const firstValue = copyOfFirst[key]
			if (Array.isArray(secondValue) && Array.isArray(firstValue)) {
				// Array
				if (mergeKeys?.[key]) {
					// Merge keys are used to determine whether an item form the second object should override one from the first
					const keptFromFirst: unknown[] = []
					firstValue.forEach((item: unknown) => {
						if (!secondValue.some((item2: unknown) => mergeKeys[key](item, item2))) {
							keptFromFirst.push(item)
						}
					})
					copyOfFirst[key] = [...keptFromFirst, ...secondValue]
				} else {
					copyOfFirst[key] = [...firstValue, ...secondValue]
				}
			} else if (
				typeof secondValue === "object" &&
				secondValue !== null &&
				typeof firstValue === "object" &&
				firstValue !== null
			) {
				// Object
				copyOfFirst[key] = mergeJson(firstValue, secondValue, mergeBehavior)
			} else {
				// Other (boolean, number, string)
				copyOfFirst[key] = secondValue
			}
		}
		return copyOfFirst
	} catch (e) {
		console.error("Error merging JSON", e, copyOfFirst, second)
		return {
			...copyOfFirst,
			...second,
		}
	}
}

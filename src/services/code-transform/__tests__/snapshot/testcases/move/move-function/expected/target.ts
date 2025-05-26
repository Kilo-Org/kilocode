/**
 * Moved from source file
 */
export function formatString(value: string, maxLength: number = 100): string {
	if (value.length <= maxLength) {
		return value
	}
	return value.substring(0, maxLength - 3) + "..."
}

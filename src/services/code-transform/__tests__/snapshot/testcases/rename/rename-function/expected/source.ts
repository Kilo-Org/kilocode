/**
 * Test file for renaming a function
 */

export function renamedFunction(value: string): string {
	return `Processed: ${value}`
}

export function anotherFunction(value: string): string {
	// This function calls functionToRename
	return `Result: ${renamedFunction(value)}`
}

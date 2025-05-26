/**
 * Test file for renaming a function
 */

export function functionToRename(value: string): string {
	return `Processed: ${value}`
}

export function anotherFunction(value: string): string {
	// This function calls functionToRename
	return `Result: ${functionToRename(value)}`
}

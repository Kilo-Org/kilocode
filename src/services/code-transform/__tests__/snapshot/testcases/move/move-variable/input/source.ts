/**
 * Test file for moving a variable to another file
 */

export const anotherVariableToMove = "This variable will be moved"
export const keepThisVariable = "This variable should remain"

export function useVariables(): string {
	return `Variables: ${keepThisVariable}, ${anotherVariableToMove}`
}

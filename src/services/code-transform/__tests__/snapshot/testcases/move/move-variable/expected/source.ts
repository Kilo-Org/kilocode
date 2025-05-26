/**
 * Test file for moving a variable to another file
 */

import { anotherVariableToMove } from "./target"
export const keepThisVariable = "This variable should remain"

export function useVariables(): string {
	return `Variables: ${keepThisVariable}, ${anotherVariableToMove}`
}

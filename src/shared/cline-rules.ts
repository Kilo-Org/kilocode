// kilocode_change whole file
export type ClineRulesToggles = Record<string, boolean> // filepath -> enabled/disabled

export interface RuleMetadata {
	path: string
	name: string
	description: string // First ~200 chars of rule content, extended to whitespace, max 250
	isGlobal: boolean
}

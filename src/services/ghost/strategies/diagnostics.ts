/**
 * Shared diagnostic severity constants for VSCode diagnostics
 * These are used when working with type-only imports of vscode.Diagnostic
 */

export const DiagnosticSeverityValues = {
	Error: 0,
	Warning: 1,
	Information: 2,
	Hint: 3,
} as const

export const DiagnosticSeverityNames: Record<number, string> = {
	0: "Error",
	1: "Warning",
	2: "Information",
	3: "Hint",
}

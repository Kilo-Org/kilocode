import type { ExtensionContext } from "vscode"

export function getUserAgent(context?: ExtensionContext): string {
	return `Kilo-Code ${context?.extension?.packageJSON?.version || "unknown"}`
}

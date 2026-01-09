import type { ExtensionStateContextType } from "../../../../webview-ui/src/context/ExtensionStateContext"

/**
 * Creates a smart Proxy-based mock for ExtensionState in Storybook
 *
 * Only defines properties actually used in Storybook stories.
 * If you access an undefined property, you get a helpful error message.
 *
 * This approach minimizes maintenance - we only add properties when needed,
 * not every time ExtensionStateContextType changes.
 *
 * @param overrides - Story-specific overrides for extension state properties
 * @returns Proxied ExtensionStateContextType that provides smart defaults and helpful errors
 */
export const createExtensionStateMock = (
	overrides: Partial<ExtensionStateContextType> = {},
): ExtensionStateContextType => {
	// Only define properties that Storybook stories actually use
	const knownProperties: Partial<ExtensionStateContextType> = {
		kilocodeDefaultModel: "claude-sonnet-4",
	}

	// Merge with overrides
	const base = { ...knownProperties, ...overrides }

	return new Proxy(base as ExtensionStateContextType, {
		get(target, prop: string | symbol) {
			const propName = String(prop)

			// Return value if it exists
			if (propName in target) {
				return (target as any)[propName]
			}

			// Provide smart defaults for common patterns

			// Functions: return no-ops
			if (propName.startsWith("set") || propName.startsWith("toggle") || propName.startsWith("on")) {
				return () => {}
			}

			// Booleans: default to false
			if (
				propName.startsWith("is") ||
				propName.startsWith("has") ||
				propName.startsWith("show") ||
				propName.endsWith("Enabled") ||
				propName.endsWith("Disabled")
			) {
				return false
			}

			// Arrays: default to empty
			if (propName.endsWith("s") || propName.includes("List") || propName.includes("Array")) {
				return []
			}

			// Objects: default to empty
			if (propName.includes("Config") || propName.includes("Settings") || propName === "theme") {
				return {}
			}

			// Strings: default to empty
			if (
				propName.endsWith("Id") ||
				propName.endsWith("Name") ||
				propName.endsWith("Url") ||
				propName === "language"
			) {
				return ""
			}

			// Numbers: default to 0
			if (propName.endsWith("Count") || propName.endsWith("Limit") || propName.endsWith("Index")) {
				return 0
			}

			// Everything else: provide helpful error
			console.warn(
				`\n⚠️  Storybook Extension State Mock: Accessed undefined property "${propName}"\n\n` +
					`If this property is needed for your story, add it to createExtensionStateMock:\n\n` +
					`  1. Open: apps/storybook/src/utils/createExtensionStateMock.ts\n` +
					`  2. Add to knownProperties: ${propName}: <value>\n` +
					`  3. Or pass as override in your story\n`,
			)

			return undefined
		},
	}) as ExtensionStateContextType
}

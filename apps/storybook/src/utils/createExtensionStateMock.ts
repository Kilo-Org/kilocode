import { ExtensionStateContextType } from "../../../../webview-ui/src/context/ExtensionStateContext"

/**
 * Zero-maintenance mock for ExtensionState in Storybook
 *
 * Uses a Proxy to automatically return sensible defaults for any property.
 * No need to maintain a list of properties - it just works.
 */
export const createExtensionStateMock = (
	overrides: Partial<ExtensionStateContextType> = {},
): ExtensionStateContextType => {
	return new Proxy(overrides, {
		get(target: any, prop: string | symbol) {
			const propName = String(prop)

			// Return override if provided
			if (propName in target) {
				return target[propName]
			}

			// Functions return no-ops
			if (propName.startsWith("set") || propName.startsWith("toggle")) {
				return () => {}
			}

			// Booleans default to false
			if (
				propName.startsWith("is") ||
				propName.startsWith("has") ||
				propName.startsWith("show") ||
				propName.endsWith("Enabled")
			) {
				return false
			}

			// Arrays default to empty
			if (propName.endsWith("s") || propName.includes("List") || propName.includes("Array")) {
				return []
			}

			// Objects default to empty
			if (propName.includes("Config") || propName.includes("Settings") || propName === "theme") {
				return {}
			}

			// Strings default to empty
			if (
				propName.endsWith("Id") ||
				propName.endsWith("Name") ||
				propName.endsWith("Url") ||
				propName === "language"
			) {
				return ""
			}

			// Numbers default to 0
			if (propName.endsWith("Count") || propName.endsWith("Limit")) {
				return 0
			}

			// Everything else is undefined (which is fine for optional properties)
			return undefined
		},
	}) as ExtensionStateContextType
}

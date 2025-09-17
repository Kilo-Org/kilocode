// kilocode_change - new file
import packageJson from "../package.json"
import { readUserConfigFile } from "./vscode-config"

export type KeybindingEntry = {
	key?: string
	command?: string
	when?: string
	args?: unknown
	mac?: string
}

const MAC_MODIFIERS: Record<string, string> = {
	cmd: "Cmd",
	meta: "Cmd",
	ctrl: "Ctrl",
	alt: "Option",
	option: "Option",
	shift: "Shift",
}

const WIN_LINUX_MODIFIERS: Record<string, string> = {
	cmd: "Win",
	meta: "Win",
	ctrl: "Ctrl",
	alt: "Alt",
	shift: "Shift",
}

const SPECIAL_KEYS: Record<string, string> = {
	left: "Left",
	right: "Right",
	up: "Up",
	down: "Down",
	home: "Home",
	end: "End",
	pageup: "PageUp",
	pagedown: "PageDown",
	insert: "Insert",
	delete: "Delete",
	backspace: "Backspace",
	tab: "Tab",
	enter: "Enter",
	escape: "Escape",
	space: "Space",
}

/**
 * Gets the current keybinding for a list of commands, reading from user's keybindings.json
 * and falling back to the extension's default keybinding from package.json
 */
export async function getKeybindingsForCommands(commandIds: string[]): Promise<Record<string, string>> {
	const keybindings: Record<string, string> = {}

	for (const commandId of commandIds) {
		const keybinding = await getKeybindingForCommand(commandId)
		if (keybinding) {
			keybindings[commandId] = keybinding
		}
	}

	return keybindings
}

export async function getKeybindingForCommand(commandId: string): Promise<string | undefined> {
	try {
		const userKeybindings = await readUserConfigFile("keybindings.json")
		const userBinding = findAnyBindingForCommand(userKeybindings as KeybindingEntry[], commandId)

		// User has explicitly defined this keybinding
		if (userBinding) {
			if (userBinding.key) {
				const rawKey = userBinding.key.trim()
				if (rawKey) return prettyPrintKey(rawKey, process.platform)
			} else {
				// User explicitly unbound this key (key is empty/falsy) - return undefined to indicate no binding
				return undefined
			}
		}

		// No user binding found at all - fall back to default
		return getDefaultKeybindingForCommand(commandId)
	} catch (error) {
		// Cannot read keybindings file - throw error for UI to handle
		throw new Error(`Unable to read keybindings file: ${error instanceof Error ? error.message : "Unknown error"}`)
	}
}

/**
 * Gets the default keybinding for a command from package.json
 * @param commandId The command ID to look up
 * @returns The platform-specific keybinding string (guaranteed to exist for valid commands)
 * @throws Error if the command is not found in package.json keybindings
 */
export function getDefaultKeybindingForCommand(commandId: string): string {
	const keybindings = packageJson.contributes?.keybindings as KeybindingEntry[] | undefined
	const binding = keybindings?.find((kb) => kb.command === commandId)
	if (!binding) {
		throw new Error(`Command '${commandId}' not found in package.json keybindings`)
	}

	// Use platform-specific key if available, otherwise fall back to generic key
	const rawKey = process.platform === "darwin" ? binding.mac || binding.key : binding.key
	if (!rawKey) {
		throw new Error(`No keybinding defined for command '${commandId}' on platform '${process.platform}'`)
	}

	const pretty = prettyPrintKey(rawKey, process.platform)
	return pretty
}

function findAnyBindingForCommand(entries: KeybindingEntry[], commandId: string): KeybindingEntry | undefined {
	return entries.find((entry) => entry.command === commandId)
}

function prettyPrintKey(rawKey: string, platform: NodeJS.Platform): string {
	const chords = rawKey.split(" ").filter(Boolean)

	const formattedChords = chords.map((chord) => {
		const parts = chord.split("+")
		return parts.map((part) => normalizeKeyToken(part, platform)).join("+")
	})

	return formattedChords.join(", ")
}

/**
 * Maps a modifier key to its platform-specific display format
 */
function mapModifierKey(key: string, platform: NodeJS.Platform): string | null {
	const modifierMap = platform === "darwin" ? MAC_MODIFIERS : WIN_LINUX_MODIFIERS
	return modifierMap[key] || null
}

/**
 * Maps a special key to its display format
 */
function mapSpecialKey(key: string): string | null {
	return SPECIAL_KEYS[key] || null
}

/**
 * Capitalizes a regular key for display
 */
function capitalizeKey(key: string): string {
	// Function keys (F1, F2, etc.)
	if (/^f\d{1,2}$/.test(key)) {
		return key.toUpperCase()
	}

	// Single character keys
	if (key.length === 1) {
		return key.toUpperCase()
	}

	// Multi-character keys (capitalize first letter)
	return key.charAt(0).toUpperCase() + key.slice(1)
}

/**
 * Normalizes a single key token to its display format
 */
function normalizeKeyToken(token: string, platform: NodeJS.Platform): string {
	const normalized = token.toLowerCase()

	// Try modifier keys first
	const modifier = mapModifierKey(normalized, platform)
	if (modifier) return modifier

	// Try special keys
	const special = mapSpecialKey(normalized)
	if (special) return special

	// Fallback to capitalization
	return capitalizeKey(normalized)
}

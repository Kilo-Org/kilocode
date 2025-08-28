import * as vscode from "vscode"
import packageJson from "../package.json"
import { readUserKeybindings } from "./vscode-config"

type KeybindingEntry = {
	key?: string
	command?: string
	when?: string
	args?: unknown
	mac?: string
}

/**
 * Gets the current keybinding for a list of commands, reading from user's keybindings.json
 * and falling back to the extension's default keybinding from package.json
 */
export async function getKeybindingLabels(commandIds: string[]): Promise<Record<string, string>> {
	const maybeKeybindings: Record<string, string | undefined> = {}

	try {
		for (const commandId of commandIds) {
			maybeKeybindings[commandId] = await getCurrentKeybindingLabel(commandId)
		}
	} catch (error) {
		console.error("Failed to get keybindings:", error)
	}

	const keybindings: Record<string, string> = {}
	for (const [key, value] of Object.entries(maybeKeybindings)) {
		if (value !== undefined) {
			keybindings[key] = value
		}
	}

	return keybindings
}

/**
 * Gets the current keybinding label for a command, reading from user's keybindings.json
 * and falling back to the extension's default keybinding from package.json
 */
export async function getCurrentKeybindingLabel(commandId: string): Promise<string | undefined> {
	try {
		const userKeybindings = await readUserKeybindings()
		const userBinding = findFirstBindingForCommand(userKeybindings as KeybindingEntry[], commandId)

		// Try user binding first, then fall back to default
		if (userBinding?.key) {
			const rawKey = userBinding.key.trim()
			if (rawKey) return prettyPrintKey(rawKey, process.platform)
		}

		// Fall back to default keybinding from package.json
		try {
			return getDefaultKeybindingForCommand(commandId)
		} catch {
			return undefined
		}
	} catch (error) {
		console.warn(`Failed to get keybinding for command ${commandId}:`, error)
		return undefined
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

	return prettyPrintKey(rawKey, process.platform)
}

function findFirstBindingForCommand(entries: KeybindingEntry[], commandId: string): KeybindingEntry | undefined {
	return entries.find((entry) => entry.command === commandId && entry.key && entry.key.trim())
}

function prettyPrintKey(rawKey: string, platform: NodeJS.Platform): string {
	const chords = rawKey.split(" ").filter(Boolean)

	const formattedChords = chords.map((chord) => {
		const parts = chord.split("+")
		return parts.map((part) => normalizeKeyToken(part, platform)).join("+")
	})

	if (formattedChords.length > 1) {
		return formattedChords.join(", ")
	}

	return formattedChords[0] || ""
}

function normalizeKeyToken(token: string, platform: NodeJS.Platform): string {
	const normalized = token.toLowerCase()
	const isMac = platform === "darwin"

	const macModifiers: Record<string, string> = {
		cmd: "Cmd",
		meta: "Cmd",
		ctrl: "Ctrl",
		alt: "Option",
		option: "Option",
		shift: "Shift",
	}

	const winLinuxModifiers: Record<string, string> = {
		cmd: "Ctrl",
		meta: "Win",
		ctrl: "Ctrl",
		alt: "Alt",
		shift: "Shift",
	}

	const modifierMap = isMac ? macModifiers : winLinuxModifiers

	if (normalized in modifierMap) {
		return modifierMap[normalized]
	}

	const specialKeys: Record<string, string> = {
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

	if (normalized in specialKeys) {
		return specialKeys[normalized]
	}

	if (/^f\d{1,2}$/.test(normalized)) {
		return normalized.toUpperCase()
	}

	if (normalized.length === 1) {
		return normalized.toUpperCase()
	}

	return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

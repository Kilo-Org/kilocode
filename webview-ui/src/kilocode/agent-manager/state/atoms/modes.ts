import { atom } from "jotai"
import { DEFAULT_MODE_SLUG } from "@roo-code/types"

const STORAGE_KEY = "agentManager.selectedModeSlug"

/**
 * Mode information returned from extension
 */
export interface AvailableMode {
	slug: string
	name: string
	description?: string
	iconName?: string
	source?: "global" | "project" | "organization"
}

/**
 * Available modes fetched from extension.
 * This is workspace-level state (not session-specific) because modes
 * are shared across all sessions.
 */
export const availableModesAtom = atom<AvailableMode[]>([])

/**
 * Helper to get persisted mode slug from localStorage
 */
function getPersistedModeSlug(): string | null {
	try {
		return localStorage.getItem(STORAGE_KEY)
	} catch (error) {
		console.error("[AgentManager] Failed to read mode selection from localStorage:", error)
		return null
	}
}

/**
 * Helper to persist mode slug to localStorage
 */
function persistModeSlug(modeSlug: string | null): void {
	try {
		if (modeSlug) {
			localStorage.setItem(STORAGE_KEY, modeSlug)
		} else {
			localStorage.removeItem(STORAGE_KEY)
		}
	} catch (error) {
		console.error("[AgentManager] Failed to persist mode selection to localStorage:", error)
	}
}

/**
 * Currently selected mode slug for new sessions.
 * Initialized from localStorage if available.
 * Defaults to "code" if not explicitly set.
 */
export const selectedModeSlugAtom = atom<string | null>(getPersistedModeSlug())

/**
 * Derived atom: the effective mode slug to use for new sessions.
 * Returns selectedModeSlugAtom if set and valid, otherwise defaults to "code".
 */
export const effectiveModeSlugAtom = atom((get) => {
	const selected = get(selectedModeSlugAtom)
	const modes = get(availableModesAtom)

	// If selected mode exists in available modes, use it
	if (selected && modes.some((m) => m.slug === selected)) {
		return selected
	}

	// Default to "code" if available, otherwise first mode
	if (modes.some((m) => m.slug === DEFAULT_MODE_SLUG)) {
		return DEFAULT_MODE_SLUG
	}

	return modes[0]?.slug ?? DEFAULT_MODE_SLUG
})

/**
 * Derived atom: the effective mode object (slug + name) for display
 */
export const effectiveModeAtom = atom((get) => {
	const effectiveSlug = get(effectiveModeSlugAtom)
	const modes = get(availableModesAtom)

	return modes.find((m) => m.slug === effectiveSlug) ?? { slug: effectiveSlug, name: effectiveSlug }
})

/**
 * Action atom to update the available modes from extension message.
 * Validates persisted mode selection against available modes.
 */
export const updateAvailableModesAtom = atom(null, (get, set, modes: AvailableMode[]) => {
	set(availableModesAtom, modes)

	// Validate persisted selection - clear if mode no longer exists
	const currentSelection = get(selectedModeSlugAtom)
	if (currentSelection) {
		const modeExists = modes.some((m) => m.slug === currentSelection)
		if (!modeExists) {
			// Clear invalid persisted selection
			set(selectedModeSlugAtom, null)
			persistModeSlug(null)
		}
	}
})

/**
 * Action atom to set selected mode slug with localStorage persistence
 */
export const setSelectedModeSlugAtom = atom(null, (_get, set, modeSlug: string | null) => {
	set(selectedModeSlugAtom, modeSlug)
	persistModeSlug(modeSlug)
})

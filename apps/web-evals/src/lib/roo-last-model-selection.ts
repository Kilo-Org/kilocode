import { z } from "zod"

export const ROO_LAST_MODEL_SELECTION_KEY = "evals-roo-last-model-selection"

const modelIdListSchema = z.array(z.string())

function hasLocalStorage(): boolean {
	try {
		return typeof localStorage !== "undefined"
	} catch {
		return false
	}
}

function safeGetItem(key: string): string | null {
	try {
		return localStorage.getItem(key)
	} catch {
		return null
	}
}

function safeSetItem(key: string, value: string): void {
	try {
		localStorage.setItem(key, value)
	} catch {
		// ignore
	}
}

function safeRemoveItem(key: string): void {
	try {
		localStorage.removeItem(key)
	} catch {
		// ignore
	}
}

function tryParseJson(raw: string | null): unknown {
	if (raw === null) return undefined
	try {
		return JSON.parse(raw)
	} catch {
		return undefined
	}
}

function normalizeModelIds(modelIds: string[]): string[] {
	const unique = new Set<string>()
	for (const id of modelIds) {
		const trimmed = id.trim()
		if (trimmed) unique.add(trimmed)
	}
	return Array.from(unique)
}

export function loadRooLastModelSelection(): string[] {
	if (!hasLocalStorage()) return []

	const parsed = modelIdListSchema.safeParse(tryParseJson(safeGetItem(ROO_LAST_MODEL_SELECTION_KEY)))
	if (!parsed.success) return []

	return normalizeModelIds(parsed.data)
}

export function saveRooLastModelSelection(modelIds: string[]): void {
	if (!hasLocalStorage()) return

	const normalized = normalizeModelIds(modelIds)
	if (normalized.length === 0) {
		safeRemoveItem(ROO_LAST_MODEL_SELECTION_KEY)
		return
	}

	safeSetItem(ROO_LAST_MODEL_SELECTION_KEY, JSON.stringify(normalized))
}

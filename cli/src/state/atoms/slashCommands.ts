import { atom } from "jotai"
import type { SlashCommandPolicy, PendingModelOverride } from "../../commands/core/types.js"

/**
 * Active slash command policy (used to gate tool approvals).
 */
export const activeSlashCommandPolicyAtom = atom<SlashCommandPolicy | null>(null)

export const setActiveSlashCommandPolicyAtom = atom(null, (_get, set, policy: SlashCommandPolicy | null) => {
	set(activeSlashCommandPolicyAtom, policy)
})

export const clearActiveSlashCommandPolicyAtom = atom(null, (_get, set) => {
	set(activeSlashCommandPolicyAtom, null)
})

/**
 * Pending model override (restored on completion_result).
 */
export const pendingModelOverrideAtom = atom<PendingModelOverride | null>(null)

export const setPendingModelOverrideAtom = atom(null, (_get, set, override: PendingModelOverride | null) => {
	set(pendingModelOverrideAtom, override)
})

export const clearPendingModelOverrideAtom = atom(null, (_get, set) => {
	set(pendingModelOverrideAtom, null)
})

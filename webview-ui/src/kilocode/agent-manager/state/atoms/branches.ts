import { atom } from "jotai"

/**
 * List of local branches available in the workspace repository.
 * This is workspace-level state (not session-specific) because all sessions
 * share the same git repository and have access to the same branches.
 */
export const branchesAtom = atom<string[]>([])

/**
 * Current branch name in the workspace (not session-specific)
 */
export const currentBranchAtom = atom<string | undefined>(undefined)

/**
 * Action atom to update the branches list and current branch
 */
export const updateBranchesAtom = atom(null, (_get, set, payload: { branches: string[]; currentBranch?: string }) => {
	const { branches, currentBranch } = payload
	set(branchesAtom, branches)
	set(currentBranchAtom, currentBranch)
})

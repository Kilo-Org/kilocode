/**
 * LRU Cache for Previous Edit Management
 * Based on Continue's prevEditLruCache.ts for sophisticated edit history tracking
 */

import { LruCache } from "../utils/LruCache"

interface PrevEdit {
	unidiff: string
	fileUri: string
	workspaceUri: string
	timestamp: number
}

const maxPrevEdits = 5

export const prevEditLruCache = new LruCache<string, PrevEdit>(maxPrevEdits)

export const setPrevEdit = (edit: PrevEdit): void => {
	const uniqueSuffix = Math.random().toString(36).substring(2, 8)
	const key = `${edit.fileUri}:${edit.timestamp}:${uniqueSuffix}`
	prevEditLruCache.set(key, edit)
}

export const getPrevEditsDescending = (): PrevEdit[] => {
	const edits: PrevEdit[] = []
	for (const [_, edit] of prevEditLruCache.entriesDescending()) {
		if (edits.length >= maxPrevEdits) {
			break
		}
		edits.push(edit)
	}
	return edits
}

export type { PrevEdit }

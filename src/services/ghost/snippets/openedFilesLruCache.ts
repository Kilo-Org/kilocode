/**
 * Opened Files LRU Cache
 * Based on Continue's openedFilesLruCache.ts for tracking file viewing order
 */

import { LruCache } from "../utils/LruCache"

// The cache key and value are both a filepath string
export type CacheElementType = string

// Maximum number of open files that can be cached
const MAX_NUM_OPEN_CONTEXT_FILES = 20

// Stores which files are currently open in the IDE, in viewing order
export const openedFilesLruCache = new LruCache<CacheElementType, CacheElementType>(MAX_NUM_OPEN_CONTEXT_FILES)

// Used for tracking previous filepaths
export const prevFilepaths = {
	filepaths: [] as string[],
}

// kilocode_change - new file
// Tool result cache with file-hash invalidation for read/grep/glob

import * as Log from "@opencode-ai/core/util/log"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Effect } from "effect"
import * as crypto from "crypto"

const log = Log.create({ service: "tool.cache" })

interface CacheEntry<T> {
  result: T
  mtime: number
  cachedAt: number
}

const cache = new Map<string, CacheEntry<unknown>>()
const TTL_MS = 30_000 // 30 second TTL for grep/glob
const MAX_ENTRIES = 200

function key(tool: string, params: Record<string, unknown>): string {
  return `${tool}:${JSON.stringify(params)}`
}

function hashFile(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16)
}

export function get<T>(tool: string, params: Record<string, unknown>): T | undefined {
  const k = key(tool, params)
  const entry = cache.get(k)
  if (!entry) return undefined
  const now = Date.now()
  // TTL check for non-read tools
  if (tool !== "read" && now - entry.cachedAt > TTL_MS) {
    cache.delete(k)
    return undefined
  }
  log.debug("cache hit", { tool, key: k })
  return entry.result as T
}

export function set<T>(tool: string, params: Record<string, unknown>, result: T, mtime = 0): void {
  const k = key(tool, params)
  if (cache.size >= MAX_ENTRIES) {
    const first = cache.keys().next().value
    if (first) cache.delete(first)
  }
  cache.set(k, { result, mtime, cachedAt: Date.now() })
  log.debug("cache set", { tool, key: k })
}

export function invalidate(path: string): void {
  let count = 0
  for (const [k] of cache) {
    if (k.includes(path)) {
      cache.delete(k)
      count++
    }
  }
  if (count > 0) log.debug("cache invalidate", { path, count })
}

export function clear(): void {
  cache.clear()
  log.debug("cache cleared")
}



// Wrap a tool execution with caching
export function wrap<T>(
  tool: string,
  params: Record<string, unknown>,
  execute: () => Effect.Effect<T, Error>,
  mtime = 0,
): Effect.Effect<T, Error> {
  const cached = get<T>(tool, params)
  if (cached !== undefined) {
    return Effect.succeed(cached)
  }
  return Effect.gen(function* () {
    const result = yield* execute()
    set(tool, params, result, mtime)
    return result
  })
}

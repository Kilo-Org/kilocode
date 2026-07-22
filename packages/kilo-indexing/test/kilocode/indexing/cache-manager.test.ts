import { describe, expect, test } from "bun:test"
import { createHash } from "crypto"
import { mkdtemp, rm } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { CacheManager } from "../../../src/indexing/cache-manager"

describe("CacheManager", () => {
  test("loads legacy hashes without metadata", async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), "index-cache-"))

    try {
      const workspace = path.join(cacheDir, "workspace")
      const id = createHash("sha256").update(workspace).digest("hex")
      const file = path.join(cacheDir, `roo-index-cache-${id}.json`)
      const source = path.join(workspace, "main.ts")
      await Bun.write(file, JSON.stringify({ [source]: "legacy-hash" }))

      const cache = new CacheManager(cacheDir, workspace)
      await cache.initialize()

      expect(cache.getHash(source)).toBe("legacy-hash")
      expect(cache.getMetadata(source)).toBeUndefined()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  test("persists metadata without changing the hash signature", async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), "index-cache-"))

    try {
      const workspace = path.join(cacheDir, "workspace")
      const source = path.join(workspace, "main.ts")
      const metadata = { size: 42, mtimeMs: 1000.25, ctimeMs: 1001.5 }
      const first = new CacheManager(cacheDir, workspace)
      await first.initialize()
      first.updateHash(source, "hash", metadata)
      const signature = first.signature()

      first.updateHash(source, "hash", { ...metadata, size: 43 })
      expect(first.signature()).toBe(signature)

      first.updateHash(source, "changed", metadata)
      expect(first.signature()).not.toBe(signature)

      first.updateHash(source, "hash", metadata)
      await first.flush()

      const second = new CacheManager(cacheDir, workspace)
      await second.initialize()
      expect(second.getHash(source)).toBe("hash")
      expect(second.getMetadata(source)).toEqual(metadata)

      second.updateHash(source, "hash-without-metadata")
      expect(second.getMetadata(source)).toBeUndefined()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  test("defensively decodes cache data", async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), "index-cache-"))

    try {
      const workspace = path.join(cacheDir, "workspace")
      const id = createHash("sha256").update(workspace).digest("hex")
      const file = path.join(cacheDir, `roo-index-cache-${id}.json`)
      const source = path.join(workspace, "main.ts")

      await Bun.write(file, "{")
      const malformed = new CacheManager(cacheDir, workspace)
      await malformed.initialize()
      expect(malformed.getHash(source)).toBeUndefined()

      await Bun.write(file, JSON.stringify({ version: 999, files: { [source]: { hash: "unsafe" } } }))
      const unsupported = new CacheManager(cacheDir, workspace)
      await unsupported.initialize()
      expect(unsupported.getHash(source)).toBeUndefined()

      await Bun.write(
        file,
        JSON.stringify({ version: 2, files: { [source]: { hash: "safe", size: 42 } } }),
      )
      const incomplete = new CacheManager(cacheDir, workspace)
      await incomplete.initialize()
      expect(incomplete.getHash(source)).toBe("safe")
      expect(incomplete.getMetadata(source)).toBeUndefined()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  test("flushes a stable signature used to detect baseline changes", async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), "index-cache-"))

    try {
      const workspace = path.join(cacheDir, "workspace")
      const first = new CacheManager(cacheDir, workspace)
      await first.initialize()
      first.seedHashes({
        [path.join(workspace, "b.ts")]: "b",
        [path.join(workspace, "a.ts")]: "a",
      })
      await first.flush()

      const second = new CacheManager(cacheDir, workspace)
      await second.initialize()
      expect(second.signature()).toBe(first.signature())

      second.updateHash(path.join(workspace, "a.ts"), "changed")
      expect(second.signature()).not.toBe(first.signature())
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })
})

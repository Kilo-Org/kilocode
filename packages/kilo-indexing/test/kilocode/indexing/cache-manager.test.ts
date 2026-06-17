import { describe, expect, test } from "bun:test"
import { mkdtemp } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { CacheManager } from "../../../src/indexing/cache-manager"

describe("CacheManager", () => {
  test("flushes a stable signature used to detect baseline changes", async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), "index-cache-"))
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
  })
})

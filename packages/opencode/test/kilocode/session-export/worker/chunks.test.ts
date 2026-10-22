import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Storage } from "@/kilocode/session-export/worker/storage"
import { Chunker } from "@/kilocode/session-export/worker/chunks"

describe("Chunker", () => {
  let dir: string
  let storage: Storage
  let chunker: Chunker

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "session-export-"))
    storage = new Storage(join(dir, "session-export.db"))
    storage.migrate()
    chunker = new Chunker(storage, { chunkBytes: 1024 })
  })

  afterEach(() => {
    storage.close()
    rmSync(dir, { recursive: true, force: true })
  })

  test("splits a large buffer into multiple chunks", async () => {
    const big = new Uint8Array(2_500)
    for (let i = 0; i < big.length; i++) big[i] = i & 0xff
    const ids = await chunker.write(big)
    expect(ids.length).toBeGreaterThanOrEqual(3)
  })

  test("identical content deduplicates", async () => {
    const buf = new Uint8Array(2_000).fill(7)
    const a = await chunker.write(buf)
    const b = await chunker.write(buf)
    expect(a).toEqual(b)
  })

  test("decoded chunks roundtrip", async () => {
    const text = Buffer.from("alpha beta gamma ".repeat(200))
    const ids = await chunker.write(text)
    const out = await chunker.read(ids)
    expect(Buffer.from(out)).toEqual(text)
  })
})

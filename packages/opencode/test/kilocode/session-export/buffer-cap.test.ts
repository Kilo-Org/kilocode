import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Storage } from "@/kilocode/session-export/worker/storage"
import { checkBufferCap } from "@/kilocode/session-export/worker/buffer-cap"

describe("buffer cap", () => {
  let dir: string
  let storage: Storage

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "session-export-"))
    storage = new Storage(join(dir, "session-export.db"))
    storage.migrate()
  })

  afterEach(() => {
    storage.close()
    rmSync(dir, { recursive: true, force: true })
  })

  test("reports trip when DB size exceeds capacity", () => {
    const result = checkBufferCap(storage, { capacityBytes: 1 })
    expect(result.tripped).toBe(true)
  })

  test("does not trip when DB is well under capacity", () => {
    const result = checkBufferCap(storage, { capacityBytes: 1024 * 1024 * 1024 })
    expect(result.tripped).toBe(false)
  })
})

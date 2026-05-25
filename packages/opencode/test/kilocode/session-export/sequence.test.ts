import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createSequencer } from "@/kilocode/session-export/sequence"

describe("session export sequencer", () => {
  test("persists the next event sequence by session", () => {
    const dir = mkdtempSync(join(tmpdir(), "session-export-seq-"))
    const db = join(dir, "session-export.db")
    try {
      const first = createSequencer(db)
      expect(first.next("s1")).toBe(0)
      expect(first.next("s1")).toBe(1)
      expect(first.next("s2")).toBe(0)
      first.close()

      const second = createSequencer(db)
      expect(second.next("s1")).toBe(2)
      expect(second.next("s2")).toBe(1)
      second.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

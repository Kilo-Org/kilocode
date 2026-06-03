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

  test("waits for worker sqlite writes instead of failing on a transient lock", async () => {
    const dir = mkdtempSync(join(tmpdir(), "session-export-seq-lock-"))
    const db = join(dir, "session-export.db")
    const worker = locker()
    try {
      const first = createSequencer(db)
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("lock worker timeout")), 1_000)
        worker.onmessage = (event: MessageEvent) => {
          if ((event.data as { kind?: string }).kind !== "locked") return
          clearTimeout(timer)
          resolve()
        }
        worker.onerror = (event) => {
          clearTimeout(timer)
          reject(event.error)
        }
        worker.postMessage(db)
      })
      expect(first.next("s1")).toBe(0)
      first.close()
    } finally {
      worker.terminate()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

function locker() {
  const code = `
    import { Database } from "bun:sqlite"
    self.onmessage = async (event) => {
      const sqlite = new Database(event.data, { create: true })
      sqlite.exec("PRAGMA journal_mode = WAL")
      sqlite.exec("CREATE TABLE IF NOT EXISTS hold (id INTEGER PRIMARY KEY)")
      sqlite.exec("BEGIN IMMEDIATE")
      self.postMessage({ kind: "locked" })
      await new Promise((resolve) => setTimeout(resolve, 100))
      sqlite.exec("COMMIT")
      sqlite.close()
    }
  `
  return new Worker(URL.createObjectURL(new Blob([code], { type: "text/javascript" })))
}

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import {
  loadTrustStore,
  saveTrustStore,
  addTrustedPublisher,
  removeTrustedPublisher,
  getTrustedPublisher,
  listTrustedPublishers,
} from "@/devilcode/team/registry/trust-store"

// Use a temp directory for all tests to avoid touching the real trust store
let tempDir: string

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-trust-store-test-"))
})

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true })
})

function storePath(): string {
  return path.join(tempDir, "trusted-publishers.json")
}

describe("loadTrustStore", () => {
  it("returns an empty store when file does not exist", async () => {
    const store = await loadTrustStore(storePath())
    expect(store.version).toBe("1.0")
    expect(store.publishers).toEqual({})
  })

  it("recovers to empty store on malformed JSON", async () => {
    await fs.writeFile(storePath(), "{ not valid json }", "utf-8")
    const store = await loadTrustStore(storePath())
    expect(store.version).toBe("1.0")
    expect(store.publishers).toEqual({})
  })

  it("loads a valid persisted store", async () => {
    const written = {
      version: "1.0",
      publishers: {
        "pub-1": { publicKey: "-----BEGIN PUBLIC KEY-----\nABC\n-----END PUBLIC KEY-----", addedAt: new Date().toISOString() },
      },
    }
    await fs.writeFile(storePath(), JSON.stringify(written), "utf-8")
    const store = await loadTrustStore(storePath())
    expect(store.publishers["pub-1"]!.publicKey).toContain("BEGIN PUBLIC KEY")
  })
})

describe("saveTrustStore", () => {
  it("persists store and creates parent dirs", async () => {
    const nestedPath = path.join(tempDir, "nested", "dir", "store.json")
    const store = { version: "1.0" as const, publishers: {} }
    await saveTrustStore(store, nestedPath)

    const raw = await fs.readFile(nestedPath, "utf-8")
    const parsed = JSON.parse(raw)
    expect(parsed.version).toBe("1.0")
  })
})

describe("addTrustedPublisher", () => {
  it("adds a publisher and persists it", async () => {
    await addTrustedPublisher("pub-abc", "-----BEGIN PUBLIC KEY-----\nX\n-----END PUBLIC KEY-----", undefined, storePath())
    const store = await loadTrustStore(storePath())
    expect(store.publishers["pub-abc"]).toBeDefined()
    expect(store.publishers["pub-abc"]!.publicKey).toContain("BEGIN PUBLIC KEY")
  })

  it("persists optional comment", async () => {
    await addTrustedPublisher("pub-xyz", "pk-value", "my trusted publisher", storePath())
    const store = await loadTrustStore(storePath())
    expect(store.publishers["pub-xyz"]!.comment).toBe("my trusted publisher")
  })

  it("updates an existing publisher", async () => {
    await addTrustedPublisher("pub-1", "old-key", undefined, storePath())
    await addTrustedPublisher("pub-1", "new-key", "updated", storePath())
    const store = await loadTrustStore(storePath())
    expect(store.publishers["pub-1"]!.publicKey).toBe("new-key")
    expect(store.publishers["pub-1"]!.comment).toBe("updated")
  })

  it("sets addedAt as an ISO datetime string", async () => {
    await addTrustedPublisher("pub-ts", "pk", undefined, storePath())
    const store = await loadTrustStore(storePath())
    const addedAt = store.publishers["pub-ts"]!.addedAt
    expect(() => new Date(addedAt)).not.toThrow()
    expect(new Date(addedAt).toISOString()).toBe(addedAt)
  })
})

describe("removeTrustedPublisher", () => {
  it("returns true and removes publisher when found", async () => {
    await addTrustedPublisher("pub-del", "pk", undefined, storePath())
    const removed = await removeTrustedPublisher("pub-del", storePath())
    expect(removed).toBe(true)

    const store = await loadTrustStore(storePath())
    expect(store.publishers["pub-del"]).toBeUndefined()
  })

  it("returns false when publisher not found", async () => {
    const removed = await removeTrustedPublisher("nonexistent-pub", storePath())
    expect(removed).toBe(false)
  })

  it("does not disturb other publishers when removing one", async () => {
    await addTrustedPublisher("pub-keep", "pk-keep", undefined, storePath())
    await addTrustedPublisher("pub-del", "pk-del", undefined, storePath())
    await removeTrustedPublisher("pub-del", storePath())

    const store = await loadTrustStore(storePath())
    expect(store.publishers["pub-keep"]).toBeDefined()
    expect(store.publishers["pub-del"]).toBeUndefined()
  })
})

describe("getTrustedPublisher", () => {
  it("returns undefined for unknown publisher", async () => {
    const pub = await getTrustedPublisher("nobody", storePath())
    expect(pub).toBeUndefined()
  })

  it("returns the publisher when found", async () => {
    await addTrustedPublisher("pub-found", "my-public-key", "comment here", storePath())
    const pub = await getTrustedPublisher("pub-found", storePath())
    expect(pub).toBeDefined()
    expect(pub!.publicKey).toBe("my-public-key")
    expect(pub!.comment).toBe("comment here")
  })
})

describe("listTrustedPublishers", () => {
  it("returns empty array when no publishers are trusted", async () => {
    const list = await listTrustedPublishers(storePath())
    expect(list).toEqual([])
  })

  it("returns all publishers with id field added", async () => {
    await addTrustedPublisher("pub-1", "pk-1", undefined, storePath())
    await addTrustedPublisher("pub-2", "pk-2", "second", storePath())
    const list = await listTrustedPublishers(storePath())

    expect(list).toHaveLength(2)
    const ids = list.map((p) => p.id).sort()
    expect(ids).toEqual(["pub-1", "pub-2"])

    const p1 = list.find((p) => p.id === "pub-1")!
    expect(p1.publicKey).toBe("pk-1")

    const p2 = list.find((p) => p.id === "pub-2")!
    expect(p2.comment).toBe("second")
  })
})

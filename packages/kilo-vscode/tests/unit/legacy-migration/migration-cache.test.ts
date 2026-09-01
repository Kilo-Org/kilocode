import { describe, expect, it } from "bun:test"
import {
  getMigrationCache,
  handleRequestMigrationData,
  handleStartMigration,
  type MigrationCache,
  type MigrationCacheEntry,
  type MigrationContext,
} from "../../../src/kilo-provider/handlers/migration"

function makeContext(cache: MigrationCache, sent: unknown[] = []): MigrationContext {
  return {
    client: null,
    extensionContext: {
      globalStorageUri: { fsPath: "/storage/kilocode.kilo-code" },
      get secrets() {
        throw new Error("Roo import must not access SecretStorage")
      },
    },
    postMessage: (message) => sent.push(message),
    refreshSessions: () => {},
    migrationCache: cache,
  } as unknown as MigrationContext
}

describe("migration cache", () => {
  it("isolates Roo entries by operation", () => {
    const cache: MigrationCache = new Map()
    const entry: MigrationCacheEntry = { operationId: "new", source: "roo", data: null }
    cache.set("new", entry)

    expect(getMigrationCache(cache, "roo", "new")).toBe(entry)
    expect(getMigrationCache(cache, "roo", "stale")).toBeUndefined()
  })

  it("retains an empty Roo discovery for its operation", () => {
    const cache: MigrationCache = new Map()
    const entry: MigrationCacheEntry = { operationId: "empty", source: "roo", data: null }
    cache.set("empty", entry)

    expect(getMigrationCache(cache, "roo", "empty")).toBe(entry)
    expect(getMigrationCache(cache, "roo", "empty")?.data).toBeNull()
  })

  it("discovers Roo sessions without accessing secrets and drops abandoned operations", async () => {
    const cache: MigrationCache = new Map()
    const sent: unknown[] = []
    cache.set("abandoned", { operationId: "abandoned", source: "roo", data: null })

    await handleRequestMigrationData(makeContext(cache, sent), "roo", "fresh")

    expect(cache.has("abandoned")).toBe(false)
    expect(getMigrationCache(cache, "roo", "fresh")).toBeDefined()
    expect(sent).toEqual([{ type: "migrationData", source: "roo", operationId: "fresh", data: { sessions: [] } }])
  })

  it("ignores obsolete migration requests without accessing extension storage", async () => {
    const cache: MigrationCache = new Map()
    const sent: unknown[] = []
    const ctx = makeContext(cache, sent)
    Object.defineProperty(ctx, "extensionContext", {
      get() {
        throw new Error("Unsupported migrations must not access extension storage")
      },
    })

    await handleRequestMigrationData(ctx, "legacy" as never, "old")
    await handleStartMigration(ctx, "legacy" as never, "old", { sessions: [] })

    expect(cache.size).toBe(0)
    expect(sent).toEqual([])
  })

  it("evicts an operation's entry once the migration completes", async () => {
    const cache: MigrationCache = new Map()
    cache.set("op", { operationId: "op", source: "roo", data: null })

    await handleStartMigration(makeContext(cache), "roo", "op", { sessions: [] })

    expect(cache.has("op")).toBe(false)
  })
})

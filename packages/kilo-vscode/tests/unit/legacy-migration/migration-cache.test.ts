import { describe, expect, it } from "bun:test"
import {
  getMigrationCache,
  handleRequestMigrationData,
  handleStartMigration,
  type MigrationCache,
  type MigrationCacheEntry,
  type MigrationContext,
} from "../../../src/kilo-provider/handlers/migration"

const legacy = {
  hasData: false,
  providers: [],
  mcpServers: [],
  customModes: [],
}

function makeContext(cache: MigrationCache): MigrationContext {
  return {
    client: null,
    extensionContext: { globalStorageUri: { fsPath: "/storage/kilocode.kilo-code" } },
    postMessage: () => {},
    refreshSessions: () => {},
    migrationCache: cache,
    migrationCheckInFlight: false,
    disposeGlobal: async () => {},
    broadcastComplete: () => {},
  } as unknown as MigrationContext
}

describe("migration cache", () => {
  it("isolates entries by operation and source", () => {
    const cache: MigrationCache = new Map()
    const entry: MigrationCacheEntry = { operationId: "new", source: "legacy", data: legacy }
    cache.set("new", entry)

    expect(getMigrationCache(cache, "legacy", "new")).toBe(entry)
    expect(getMigrationCache(cache, "roo", "new")).toBeUndefined()
    expect(getMigrationCache(cache, "legacy", "stale")).toBeUndefined()
  })

  it("retains an empty Roo discovery for its operation", () => {
    const cache: MigrationCache = new Map()
    const entry: MigrationCacheEntry = { operationId: "empty", source: "roo", data: null }
    cache.set("empty", entry)

    expect(getMigrationCache(cache, "roo", "empty")).toBe(entry)
    expect(getMigrationCache(cache, "roo", "empty")?.data).toBeNull()
  })

  it("drops entries from abandoned operations when a new request arrives", async () => {
    const cache: MigrationCache = new Map()
    cache.set("abandoned", { operationId: "abandoned", source: "roo", data: null })

    await handleRequestMigrationData(makeContext(cache), "roo", "fresh")

    expect(cache.has("abandoned")).toBe(false)
    expect(getMigrationCache(cache, "roo", "fresh")).toBeDefined()
  })

  it("evicts an operation's entry once the migration completes", async () => {
    const cache: MigrationCache = new Map()
    cache.set("op", { operationId: "op", source: "roo", data: null })

    await handleStartMigration(makeContext(cache), "roo", "op", {
      providers: [],
      mcpServers: [],
      customModes: [],
      sessions: [],
      defaultModel: false,
      settings: {
        autoApproval: {
          commandRules: false,
          readPermission: false,
          writePermission: false,
          executePermission: false,
          mcpPermission: false,
          taskPermission: false,
        },
        language: false,
        autocomplete: false,
      },
    })

    expect(cache.has("op")).toBe(false)
  })
})

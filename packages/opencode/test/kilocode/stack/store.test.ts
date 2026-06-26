import path from "node:path"
import { createHash } from "node:crypto"
import { symlink } from "node:fs/promises"
import { describe, expect } from "bun:test"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Effect, Layer, Schema } from "effect"
import { Stack } from "@/kilocode/stack/schema"
import { StackStore } from "@/kilocode/stack/store"
import { TestInstance } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const it = testEffect(Layer.mergeAll(StackStore.defaultLayer, AppFileSystem.defaultLayer))
const digest = Schema.decodeUnknownSync(Stack.Digest)(`sha256:${"0".repeat(64)}`)

function config(technology: string) {
  return Schema.decodeUnknownSync(Stack.Config)({
    version: 1,
    catalog_revision: "2026-06-22.1",
    verticals: { data: { technologies: [technology] } },
    resources: {},
    managed: {},
  })
}

function indent(value: unknown) {
  return JSON.stringify(value, null, 2).replaceAll("\n", "\n  ")
}

describe("StackStore", () => {
  it.instance(
    "targets only worktree .kilo/kilo.jsonc and preserves unrelated JSONC",
    () =>
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const test = yield* TestInstance
        const store = yield* StackStore.Service
        const file = path.join(test.directory, ".kilo", "kilo.jsonc")
        const root = path.join(test.directory, "kilo.jsonc")
        const legacy = path.join(test.directory, ".kilo", "kilo.json")
        const opencode = path.join(test.directory, ".opencode", "kilo.jsonc")
        const before = `{
  // keep root comment
  "$schema": "https://app.kilo.ai/config.json",
  "theme": "solarized",
  "stack": ${indent(config("dbt"))},
  "mcp": {
    // stack-owned entry
    "managed": { "type": "local", "command": ["old"], "enabled": false },
    "remove-me": { "type": "remote", "url": "https://remove.example.com", "enabled": false },
    // keep user MCP exactly
    "user-owned": { "type": "remote", "url": "https://user.example.com", "headers": { "Authorization": "{env:USER_TOKEN}" } }
  },
  "permission": {
    // unrelated nested comment
    "bash": "ask"
  }
}
`
        yield* fs.writeWithDirs(file, before)
        yield* fs.writeWithDirs(root, "root distractor\n")
        yield* fs.writeWithDirs(legacy, "legacy distractor\n")
        yield* fs.writeWithDirs(opencode, "opencode distractor\n")

        expect(yield* store.path()).toBe(file)
        const current = yield* store.read()
        expect(current.raw).toBe(before)
        expect(String(current.revision)).toBe(`sha256:${createHash("sha256").update(before).digest("hex")}`)
        expect(Object.values(current.stack?.verticals ?? {})[0]?.technologies.map(String)).toEqual(["dbt"])
        expect(current.mcp["user-owned"]).toEqual({
          type: "remote",
          url: "https://user.example.com",
          headers: { Authorization: "{env:USER_TOKEN}" },
        })

        const prepared = yield* store.prepare({
          revision: current.revision,
          stack: config("apache-airflow"),
          mcp: {
            managed: { type: "local", command: ["new"], environment: { TOKEN: "{env:STACK_TOKEN}" }, enabled: false },
            "remove-me": undefined,
            added: { type: "remote", url: "https://added.example.com", enabled: false },
          },
        })
        const staged = yield* fs.readDirectoryEntries(path.dirname(file))
        expect(staged.some((entry) => entry.type === "directory" && entry.name.startsWith(".kilo-stack-"))).toBe(true)
        expect(staged.some((entry) => entry.type === "directory" && entry.name.startsWith(".kilo-stack-backup-"))).toBe(
          true,
        )
        yield* store.commit(prepared)

        const after = yield* fs.readFileString(file)
        expect(after).toContain("// keep root comment")
        expect(after).toContain('"theme": "solarized"')
        expect(after).toContain("// keep user MCP exactly")
        expect(after).toContain('"Authorization": "{env:USER_TOKEN}"')
        expect(after).toContain("// unrelated nested comment")
        expect(after).not.toContain('"remove-me"')
        expect(yield* fs.readFileString(root)).toBe("root distractor\n")
        expect(yield* fs.readFileString(legacy)).toBe("legacy distractor\n")
        expect(yield* fs.readFileString(opencode)).toBe("opencode distractor\n")

        const updated = yield* store.read()
        expect(Object.values(updated.stack?.verticals ?? {})[0]?.technologies.map(String)).toEqual(["apache-airflow"])
        expect(updated.mcp.managed).toEqual({
          type: "local",
          command: ["new"],
          environment: { TOKEN: "{env:STACK_TOKEN}" },
          enabled: false,
        })
        expect(updated.mcp["user-owned"]).toEqual(current.mcp["user-owned"])
        expect(updated.mcp.added).toEqual({ type: "remote", url: "https://added.example.com", enabled: false })
      }),
    { git: true },
  )

  it.instance(
    "rejects malformed JSONC with a typed error",
    () =>
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const test = yield* TestInstance
        const store = yield* StackStore.Service
        const file = path.join(test.directory, ".kilo", "kilo.jsonc")
        yield* fs.writeWithDirs(file, '{\n  "stack":,\n}\n')

        const error = yield* Effect.flip(store.read())
        expect(error._tag).toBe("StackStoreInvalidJsoncError")
        if (error._tag === "StackStoreInvalidJsoncError") {
          expect(error.path).toBe(file)
          expect(error.detail).toContain("at line")
        }
      }),
    { git: true },
  )

  it.instance(
    "rejects an invalid stack with a typed error",
    () =>
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const test = yield* TestInstance
        const store = yield* StackStore.Service
        const file = path.join(test.directory, ".kilo", "kilo.jsonc")
        yield* fs.writeWithDirs(file, '{ "stack": { "version": 2 }, "mcp": {} }\n')

        const error = yield* Effect.flip(store.read())
        expect(error._tag).toBe("StackStoreInvalidStackError")
      }),
    { git: true },
  )

  it.instance(
    "detects a revision conflict between prepare and commit",
    () =>
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const test = yield* TestInstance
        const store = yield* StackStore.Service
        const file = path.join(test.directory, ".kilo", "kilo.jsonc")
        const before = `{
  "stack": ${indent(config("dbt"))},
  "mcp": {}
}
`
        yield* fs.writeWithDirs(file, before)
        const current = yield* store.read()
        const prepared = yield* store.prepare({
          revision: current.revision,
          stack: config("apache-airflow"),
          mcp: {},
        })
        const changed = before.replace('"mcp": {}', '"mcp": {},\n  "theme": "changed concurrently"')
        yield* fs.writeFileString(file, changed)

        const error = yield* Effect.flip(store.commit(prepared))
        expect(error._tag).toBe("StackStoreRevisionConflictError")
        if (error._tag === "StackStoreRevisionConflictError") {
          expect(error.expected).toBe(current.revision)
          expect(error.actual).toBe(StackStore.revision(changed))
        }
        expect(yield* fs.readFileString(file)).toBe(changed)
      }),
    { git: true },
  )

  it.instance(
    "restores the exact previous file on rollback",
    () =>
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const test = yield* TestInstance
        const store = yield* StackStore.Service
        const file = path.join(test.directory, ".kilo", "kilo.jsonc")
        const before = `{
  // exact backup content
  "stack": ${indent(config("dbt"))},
  "mcp": {
    "managed": { "type": "local", "command": ["old"] }
  }
}
`
        yield* fs.writeWithDirs(file, before)
        const current = yield* store.read()
        const prepared = yield* store.prepare({
          revision: current.revision,
          stack: config("apache-airflow"),
          mcp: { managed: { type: "local", command: ["new"], enabled: false } },
        })
        const committed = yield* store.commit(prepared)
        expect(yield* fs.readFileString(file)).not.toBe(before)

        yield* store.rollback(committed)
        expect(yield* fs.readFileString(file)).toBe(before)
      }),
    { git: true },
  )

  it.instance(
    "hashes the missing sentinel and rolls a new file back to absence",
    () =>
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const test = yield* TestInstance
        const store = yield* StackStore.Service
        const file = path.join(test.directory, ".kilo", "kilo.jsonc")
        const current = yield* store.read()
        expect(current.raw).toBeUndefined()
        expect(String(current.revision)).toBe(
          `sha256:${createHash("sha256").update(StackStore.MISSING_SENTINEL).digest("hex")}`,
        )
        expect(current.revision).not.toBe(StackStore.revision(""))

        const prepared = yield* store.prepare({ revision: current.revision, stack: config("dbt"), mcp: {} })
        const committed = yield* store.commit(prepared)
        expect(yield* fs.existsSafe(file)).toBe(true)
        yield* store.rollback(committed)
        expect(yield* fs.existsSafe(file)).toBe(false)
      }),
    { git: true },
  )

  it.instance(
    "rejects a symlinked .kilo root before config reads or writes",
    () =>
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const test = yield* TestInstance
        const outside = yield* fs.makeTempDirectoryScoped()
        const external = path.join(outside, "kilo.jsonc")
        yield* fs.writeFileString(external, '{ "theme": "outside" }\n')
        yield* Effect.promise(() => symlink(outside, path.join(test.directory, ".kilo"), "dir"))
        const store = yield* StackStore.Service

        const read = yield* Effect.flip(store.read())
        expect(read._tag).toBe("StackStoreFileError")
        const prepare = yield* Effect.flip(
          Effect.scoped(store.prepare({ revision: StackStore.revision(undefined), stack: config("dbt"), mcp: {} })),
        )
        expect(prepare._tag).toBe("StackStoreFileError")
        expect(yield* fs.readFileString(external)).toBe('{ "theme": "outside" }\n')
      }),
    { git: true },
  )

  it.instance(
    "rejects a symlinked exact config target",
    () =>
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const test = yield* TestInstance
        const outside = yield* fs.makeTempDirectoryScoped()
        const external = path.join(outside, "config.jsonc")
        const kilo = path.join(test.directory, ".kilo")
        yield* fs.ensureDir(kilo)
        yield* fs.writeFileString(external, '{ "theme": "outside" }\n')
        yield* Effect.promise(() => symlink(external, path.join(kilo, "kilo.jsonc"), "file"))

        const error = yield* StackStore.Service.use((store) => Effect.flip(store.read()))
        expect(error._tag).toBe("StackStoreFileError")
        expect(yield* fs.readFileString(external)).toBe('{ "theme": "outside" }\n')
      }),
    { git: true },
  )

  it.instance(
    "accepts management receipts without changing their digest text",
    () =>
      Effect.gen(function* () {
        const store = yield* StackStore.Service
        const current = yield* store.read()
        const value = config("dbt")
        const stack = Schema.decodeUnknownSync(Stack.Config)({
          ...value,
          managed: {
            "mcp:dbt": {
              marketplace_id: "dbt",
              version: "1.0.0",
              digest,
              fingerprint: digest,
            },
          },
        })
        const prepared = yield* store.prepare({ revision: current.revision, stack, mcp: {} })
        yield* store.commit(prepared)
        expect(Object.values((yield* store.read()).stack?.managed ?? {})[0]?.digest).toBe(digest)
      }),
    { git: true },
  )
})

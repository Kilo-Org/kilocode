import { describe, expect } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import fs from "fs/promises"
import path from "path"
import { Auth } from "../../src/auth"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Global } from "@opencode-ai/core/global"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const node = CrossSpawnSpawner.defaultLayer

const it = testEffect(Layer.mergeAll(Auth.defaultLayer, node))

describe("Auth", () => {
  it.live("set normalizes trailing slashes in keys", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        yield* auth.set("https://example.com/", {
          type: "wellknown",
          key: "TOKEN",
          token: "abc",
        })
        const data = yield* auth.all()
        expect(data["https://example.com"]).toBeDefined()
        expect(data["https://example.com/"]).toBeUndefined()
      }),
    ),
  )

  it.live("set cleans up pre-existing trailing-slash entry", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        yield* auth.set("https://example.com/", {
          type: "wellknown",
          key: "TOKEN",
          token: "old",
        })
        yield* auth.set("https://example.com", {
          type: "wellknown",
          key: "TOKEN",
          token: "new",
        })
        const data = yield* auth.all()
        const keys = Object.keys(data).filter((key) => key.includes("example.com"))
        expect(keys).toEqual(["https://example.com"])
        const entry = data["https://example.com"]!
        expect(entry.type).toBe("wellknown")
        if (entry.type === "wellknown") expect(entry.token).toBe("new")
      }),
    ),
  )

  it.live("remove deletes both trailing-slash and normalized keys", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        yield* auth.set("https://example.com", {
          type: "wellknown",
          key: "TOKEN",
          token: "abc",
        })
        yield* auth.remove("https://example.com/")
        const data = yield* auth.all()
        expect(data["https://example.com"]).toBeUndefined()
        expect(data["https://example.com/"]).toBeUndefined()
      }),
    ),
  )

  it.live("set and remove are no-ops on keys without trailing slashes", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        yield* auth.set("anthropic", {
          type: "api",
          key: "sk-test",
        })
        const data = yield* auth.all()
        expect(data["anthropic"]).toBeDefined()
        yield* auth.remove("anthropic")
        const after = yield* auth.all()
        expect(after["anthropic"]).toBeUndefined()
      }),
    ),
  )

  // kilocode_change start - guard against the "accidental logout" class of bugs.
  // Before the fix, Auth.all() silently swallowed read/parse errors and returned
  // {}, so a subsequent Auth.set for any provider would rewrite the file with
  // only the new entry — effectively logging every existing provider out.
  it.live("set fails loudly on a corrupted auth.json instead of wiping state", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        yield* auth.set("kilo", { type: "api", key: "kilo-token" })
        yield* auth.set("anthropic", { type: "api", key: "sk-test" })

        const file = path.join(Global.Path.data, "auth.json")
        const corrupt = '{"kilo": {"type": "api", "key": "kilo-tok'
        yield* Effect.promise(() => fs.writeFile(file, corrupt))

        const result = yield* Effect.exit(auth.set("openai", { type: "api", key: "sk-new" }))
        expect(Exit.isFailure(result)).toBe(true)

        const contents = yield* Effect.promise(() => fs.readFile(file, "utf-8"))
        expect(contents).toBe(corrupt)
      }),
    ),
  )

  it.live("missing auth.json is still treated as empty", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        const file = path.join(Global.Path.data, "auth.json")
        yield* Effect.promise(() => fs.rm(file, { force: true }))
        const data = yield* auth.all()
        expect(Object.keys(data).length).toBe(0)
        yield* auth.set("kilo", { type: "api", key: "kilo-token" })
        const after = yield* auth.all()
        expect(after["kilo"]?.type).toBe("api")
      }),
    ),
  )
  // kilocode_change end
})

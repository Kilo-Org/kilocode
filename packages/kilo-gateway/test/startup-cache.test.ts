import { expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { clearSnapshot, readSnapshot, scopeIdentity, snapshotLifetime, writeSnapshot } from "../src/startup-cache.js"

// Exercise the actual storage codec and identity matching used during plugin activation.
test("startup snapshots expire, reject corrupt data, and distinguish each account scope", async () => {
  const values = new Map<string, Schema.Json>()
  const storage = {
    get: (key: string) => Effect.sync(() => values.get(key)),
    set: (key: string, value: Schema.Json) =>
      Effect.sync(() => {
        values.set(key, value)
      }),
    remove: (key: string) =>
      Effect.sync(() => {
        values.delete(key)
      }),
  }
  await Effect.runPromise(
    Effect.gen(function* () {
      const identity = scopeIdentity("https://api.kilo.ai", "private", "connection", "team")
      const snapshot = {
        identity,
        created: Date.now(),
        organizationID: "team",
        catalog: { data: [{ id: "model", name: "Model", context_length: 128000 }] },
      }
      yield* writeSnapshot(storage, snapshot)
      expect(yield* readSnapshot(storage, identity)).toMatchObject({ identity, organizationID: "team" })
      for (const different of [
        scopeIdentity("https://other.example", "private", "connection", "team"),
        scopeIdentity("https://api.kilo.ai", "rotated", "connection", "team"),
        scopeIdentity("https://api.kilo.ai", "private", "other-connection", "team"),
        scopeIdentity("https://api.kilo.ai", "private", "connection", null),
        scopeIdentity("https://api.kilo.ai", "private", "connection"),
        scopeIdentity("https://api.kilo.ai"),
      ])
        expect(yield* readSnapshot(storage, different)).toBeUndefined()
      expect(scopeIdentity("https://api.kilo.ai", "private", "connection", null)).not.toBe(
        scopeIdentity("https://api.kilo.ai", "private", "connection"),
      )
      expect(JSON.stringify([...values])).not.toContain("private")
      yield* writeSnapshot(storage, { ...snapshot, created: Date.now() - snapshotLifetime })
      expect(yield* readSnapshot(storage, identity)).toBeUndefined()
      yield* writeSnapshot(storage, { ...snapshot, created: Date.now() + snapshotLifetime })
      expect(yield* readSnapshot(storage, identity)).toBeUndefined()
      values.set([...values.keys()][0]!, { ...snapshot, catalog: { data: [{ id: "malformed" }] } })
      expect(yield* readSnapshot(storage, identity)).toBeUndefined()
      yield* clearSnapshot(storage, scopeIdentity("http://127.0.0.1", "other"))
      expect(values.size).toBe(1)
      yield* clearSnapshot(storage, identity)
      expect(values.size).toBe(0)
    }),
  )
})

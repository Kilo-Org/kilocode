import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { expect } from "bun:test"
import { Effect } from "effect"
import { Continuation } from "../../../src/kilocode/session-hosting/continuation"
import { testEffect } from "../../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([Database.node])))

const OPERATION = "11111111-1111-4111-8111-111111111111"
const OTHER = "22222222-2222-4222-8222-222222222222"
const DAY = 24 * 60 * 60 * 1000

function base(overrides: Partial<Parameters<ReturnType<typeof Continuation.store>["insert"]>[0]> = {}) {
  return {
    accountID: "user-1",
    operationKey: OPERATION,
    selectionJSON: '{"directory":"/repo"}',
    cloudOrigin: "https://cloud.example",
    provider: "kilo-cloud",
    now: 1_000,
    ...overrides,
  }
}

it.effect("writes the prepared body once and never replaces it", () =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const intents = Continuation.store(db)

    const first = yield* intents.insert({ ...base(), preparedJSON: '{"body":"one"}' })
    expect(first).toEqual({ ok: true, preparedJSON: '{"body":"one"}' })

    // A retry with a recomputed body must still read the original.
    const second = yield* intents.insert({ ...base(), preparedJSON: '{"body":"two"}' })
    expect(second).toEqual({ ok: true, preparedJSON: '{"body":"one"}' })

    const rows = yield* intents.read(OPERATION)
    expect(rows.at(0)?.prepared_json).toBe('{"body":"one"}')
    // Only the intent columns are stored; no credential, token, or hash column exists.
    expect(Object.keys(rows.at(0) ?? {}).sort()).toEqual([
      "account_id",
      "cloud_origin",
      "created_at",
      "expires_at",
      "operation_key",
      "prepared_json",
      "provider",
      "selection_json",
    ])
  }),
)

it.effect("rejects a different selection under the same key", () =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const intents = Continuation.store(db)

    yield* intents.insert({ ...base(), preparedJSON: '{"body":"one"}' })
    const conflict = yield* intents.insert({ ...base({ selectionJSON: '{"directory":"/other"}' }), preparedJSON: "{}" })
    expect(conflict).toEqual({ ok: false, reason: "mismatch" })
  }),
)

it.effect("reports an account switch when another principal holds the key", () =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const intents = Continuation.store(db)

    yield* intents.insert({ ...base(), preparedJSON: "{}" })
    const other = yield* intents.insert({ ...base({ accountID: "user-2" }), preparedJSON: "{}" })
    expect(other).toEqual({ ok: false, reason: "account_switch" })
  }),
)

it.effect("touch extends retention without replacing the body", () =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const intents = Continuation.store(db)

    yield* intents.insert({ ...base(), preparedJSON: '{"body":"one"}' })
    const before = (yield* intents.read(OPERATION)).at(0)
    const touched = yield* intents.touch({ ...base({ now: 2_000 }) })
    expect(touched).toEqual({ ok: true, preparedJSON: '{"body":"one"}' })
    const after = (yield* intents.read(OPERATION)).at(0)
    expect(after?.prepared_json).toBe('{"body":"one"}')
    expect(after?.expires_at ?? 0).toBeGreaterThan(before?.expires_at ?? 0)
  }),
)

it.effect("sweeps expired other intents but keeps the current one", () =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const intents = Continuation.store(db)

    yield* intents.insert({ ...base({ operationKey: OPERATION }), preparedJSON: "{}" })
    yield* intents.insert({ ...base({ operationKey: OTHER }), preparedJSON: "{}" })

    // Prepare a third intent long after the first two expired.
    const later = 1_000 + 31 * DAY
    const fresh = "33333333-3333-4333-8333-333333333333"
    yield* intents.insert({ ...base({ operationKey: fresh, now: later }), preparedJSON: "{}" })

    expect((yield* intents.read(OPERATION)).length).toBe(0)
    expect((yield* intents.read(OTHER)).length).toBe(0)
    expect((yield* intents.read(fresh)).length).toBe(1)
  }),
)

it.effect("renews an unswept expired retry without replacing its immutable request", () =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const intents = Continuation.store(db)
    yield* intents.insert({ ...base(), preparedJSON: '{"body":"original"}' })
    const now = 1_000 + 31 * DAY
    const result = yield* intents.touch(base({ now }))
    expect(result).toEqual({ ok: true, preparedJSON: '{"body":"original"}' })
    expect((yield* intents.read(OPERATION)).at(0)?.expires_at).toBeGreaterThan(now)
  }),
)

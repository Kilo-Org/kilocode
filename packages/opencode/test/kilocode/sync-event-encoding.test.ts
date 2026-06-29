import { afterEach, describe, expect, test } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { SessionEvent } from "@opencode-ai/core/session-event"
import { DateTime, Effect, Layer, Schema } from "effect"
import { Bus } from "../../src/bus"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import * as EventWire from "../../src/kilocode/event-wire"
import { SessionID } from "../../src/session/schema"
import { Database, eq } from "../../src/storage/db"
import { SyncEvent } from "../../src/sync"
import { EventTable } from "../../src/sync/event.sql"
import { resetDatabase } from "../fixture/db"
import { provideTmpdirInstance } from "../fixture/fixture"
import { awaitWithTimeout, testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(
    SyncEvent.layer.pipe(
      Layer.provide(RuntimeFlags.layer({ experimentalWorkspaces: true })),
      Layer.provideMerge(Bus.layer),
    ),
    CrossSpawnSpawner.defaultLayer,
  ),
)

afterEach(resetDatabase)

describe("SyncEvent encoding", () => {
  test("preserves JSON values nested under unknown schemas", () => {
    const schema = Schema.Struct({ value: Schema.Unknown })

    expect(EventWire.encode(schema, { value: new Date(0) })).toEqual({ value: "1970-01-01T00:00:00.000Z" })
    expect(EventWire.encode(schema, { value: new URL("https://kilo.ai/docs") })).toEqual({
      value: "https://kilo.ai/docs",
    })
  })

  test("legacy timestamp decoding leaves unknown payload fields unchanged", () => {
    const schema = Schema.Struct({ timestamp: Schema.DateTimeUtcFromMillis, input: Schema.Unknown })
    const timestamp = "1970-01-01T00:00:01.234Z"
    const decoded = EventWire.decode(schema, { timestamp, input: { created: timestamp, released: timestamp } })

    expect(DateTime.toEpochMillis(decoded.timestamp)).toBe(1_234)
    expect(decoded.input).toEqual({ created: timestamp, released: timestamp })
  })

  it.live(
    "publishes encoded session data on the legacy bus",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const bus = yield* Bus.Service
        const sync = yield* SyncEvent.Service
        const def = EventV2Bridge.toSyncDefinition(SessionEvent.Text.Delta)
        const sessionID = SessionID.make("ses_event_bus")
        const events = new Array<{ type: string; properties: unknown }>()
        const received = Promise.withResolvers<void>()
        const dispose = yield* bus.subscribeAllCallback((event) => {
          if (event.type !== def.type) return
          events.push(event)
          received.resolve()
        })

        try {
          yield* sync.run(def, { sessionID, timestamp: DateTime.makeUnsafe(1_234), delta: "hello" })
          yield* awaitWithTimeout(
            Effect.promise(() => received.promise),
            "legacy bus did not receive the session event",
          )
          expect((events[0]?.properties as { timestamp?: unknown }).timestamp).toBe(1_234)
        } finally {
          dispose()
        }
      }),
    ),
  )

  it.live(
    "persists encoded session data and decodes it during replay",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sync = yield* SyncEvent.Service
        const def = EventV2Bridge.toSyncDefinition(SessionEvent.Text.Delta)
        const sessionID = SessionID.make("ses_event_replay")
        const timestamp = DateTime.makeUnsafe(1_234)

        yield* sync.run(def, { sessionID, timestamp, delta: "hello" }, { publish: false })
        const row = Database.use((db) =>
          db.select().from(EventTable).where(eq(EventTable.aggregate_id, sessionID)).get(),
        )
        if (!row) throw new Error("missing persisted event")
        expect((row.data as { timestamp?: unknown }).timestamp).toBe(1_234)

        yield* sync.remove(sessionID)
        yield* sync.replay({
          id: row.id,
          type: row.type,
          seq: row.seq,
          aggregateID: row.aggregate_id,
          data: { ...row.data, timestamp: "1970-01-01T00:00:01.234Z" },
        })

        const replayed = Database.use((db) =>
          db.select().from(EventTable).where(eq(EventTable.aggregate_id, sessionID)).get(),
        )
        expect((replayed?.data as { timestamp?: unknown }).timestamp).toBe(1_234)
      }),
    ),
  )
})

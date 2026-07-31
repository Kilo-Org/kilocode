import { afterEach, describe, expect, test } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Database as CoreDatabase } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { EventTable } from "@opencode-ai/core/event/sql"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessageID } from "@opencode-ai/core/session/message-id"
import { DateTime, Deferred, Effect, Layer, Schema } from "effect"
import { GlobalBus } from "../../src/bus/global"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import * as EventWire from "../../src/kilocode/event-wire"
import { SessionID } from "../../src/session/schema"
import { eq } from "drizzle-orm"
import { resetDatabase } from "../fixture/db"
import { provideTmpdirInstance } from "../fixture/fixture"
import { awaitWithTimeout, testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(EventV2Bridge.defaultLayer, CoreDatabase.defaultLayer, CrossSpawnSpawner.defaultLayer),
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
    "publishes encoded session data on the legacy global bus",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const events = yield* EventV2Bridge.Service
        const sessionID = SessionID.make("ses_event_bus")
        const received = yield* Deferred.make<{ properties: unknown }>()
        const listener = (event: { payload: { type?: string; properties?: unknown } }) => {
          if (event.payload.type !== SessionEvent.Text.Ended.type) return
          Deferred.doneUnsafe(received, Effect.succeed({ properties: event.payload.properties }))
        }
        GlobalBus.on("event", listener)

        try {
          yield* events.publish(SessionEvent.Text.Ended, {
            sessionID,
            timestamp: DateTime.makeUnsafe(1_234),
            assistantMessageID: SessionMessageID.ID.create(),
            textID: "text_event_bus",
            text: "hello",
          })
          const event = yield* awaitWithTimeout(
            Deferred.await(received),
            "legacy bus did not receive the session event",
          )
          expect((event.properties as { timestamp?: unknown }).timestamp).toBe(1_234)
        } finally {
          GlobalBus.off("event", listener)
        }
      }),
    ),
  )

  it.live(
    "persists encoded session data and decodes it during EventV2 replay",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const events = yield* EventV2Bridge.Service
        const { db } = yield* CoreDatabase.Service
        const sessionID = SessionID.make("ses_event_replay")
        const timestamp = DateTime.makeUnsafe(1_234)

        yield* events.publish(SessionEvent.Text.Ended, {
          sessionID,
          timestamp,
          assistantMessageID: SessionMessageID.ID.create(),
          textID: "text_event_replay",
          text: "hello",
        })
        const row = yield* db
          .select()
          .from(EventTable)
          .where(eq(EventTable.aggregate_id, sessionID))
          .get()
          .pipe(Effect.orDie)
        if (!row) throw new Error("missing persisted event")
        expect((row.data as { timestamp?: unknown }).timestamp).toBe(1_234)

        yield* events.remove(sessionID)
        const received = yield* Deferred.make<typeof SessionEvent.Text.Ended.data.Type>()
        const unsubscribe = yield* events.listen((event) => {
          if (event.id === row.id)
            Deferred.doneUnsafe(received, Effect.succeed(event.data as typeof SessionEvent.Text.Ended.data.Type))
          return Effect.void
        })
        yield* Effect.addFinalizer(() => unsubscribe)
        yield* events.replay(
          {
            id: EventV2.ID.make(row.id),
            type: row.type,
            seq: row.seq,
            aggregateID: row.aggregate_id,
            data: row.data,
          },
          { publish: true },
        )

        const data = yield* awaitWithTimeout(Deferred.await(received), "replayed EventV2 event was not observed")
        expect(DateTime.toEpochMillis(data.timestamp)).toBe(1_234)
        const replayed = yield* db
          .select()
          .from(EventTable)
          .where(eq(EventTable.aggregate_id, sessionID))
          .get()
          .pipe(Effect.orDie)
        expect((replayed?.data as { timestamp?: unknown }).timestamp).toBe(1_234)
      }),
    ),
  )
})
